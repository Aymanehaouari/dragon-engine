import { DurableObject } from "cloudflare:workers";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

function isVideoId(value) {
  return /^[A-Za-z0-9_-]{11}$/.test(String(value || ""));
}

function normalizeFormat(value) {
  const format = String(value || "").toLowerCase();
  return format === "mp3" || format === "mp4" ? format : null;
}

function safeFilename(value, fallback) {
  const cleaned = String(value || fallback || "dragon-media")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);

  return cleaned || fallback || "dragon-media";
}

function parseVideoId(input) {
  const value = String(input || "").trim();
  if (isVideoId(value)) return value;

  try {
    const url = new URL(value);
    if (url.hostname === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0] || "";
      return isVideoId(id) ? id : null;
    }

    if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)) {
      const id = url.searchParams.get("v") || "";
      return isVideoId(id) ? id : null;
    }
  } catch {}

  return null;
}

function decodeEntities(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function adminAuthError(request, env) {
  const token = String(env.ADMIN_TOKEN || "");
  if (!token) return json({ error: "ADMIN_TOKEN is not configured." }, 503);

  const auth = request.headers.get("authorization") || "";
  if (auth !== "Bearer " + token) {
    return json({ error: "Unauthorized." }, 401);
  }

  return null;
}

function registryStub(env) {
  if (!env.MEDIA_REGISTRY) return null;
  const id = env.MEDIA_REGISTRY.idFromName("dragon-media-library");
  return env.MEDIA_REGISTRY.get(id);
}

async function registryRequest(env, path, init = {}) {
  const stub = registryStub(env);
  if (!stub) return json({ error: "MEDIA_REGISTRY binding is missing." }, 503);

  return stub.fetch(
    new Request("https://media-registry.internal" + path, init)
  );
}

async function getMediaEntry(env, videoId) {
  const response = await registryRequest(
    env,
    "/media/" + encodeURIComponent(videoId)
  );

  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Media registry lookup failed.");
  return response.json();
}

async function listMediaEntries(env) {
  const response = await registryRequest(env, "/media");
  if (!response.ok) throw new Error("Media registry lookup failed.");
  const data = await response.json();
  return Array.isArray(data.items) ? data.items : [];
}

async function saveMediaFormat(env, videoId, format, record) {
  const response = await registryRequest(
    env,
    "/media/" + encodeURIComponent(videoId) + "/" + format,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(record)
    }
  );

  if (!response.ok) throw new Error("Could not save media mapping.");
  return response.json();
}

async function deleteMediaFormat(env, videoId, format) {
  const response = await registryRequest(
    env,
    "/media/" + encodeURIComponent(videoId) + "/" + format,
    { method: "DELETE" }
  );

  if (!response.ok && response.status !== 404) {
    throw new Error("Could not remove media mapping.");
  }

  return response.status === 404 ? null : response.json();
}

async function searchYouTube(env, query) {
  const u = new URL("https://www.googleapis.com/youtube/v3/search");
  u.searchParams.set("part", "snippet");
  u.searchParams.set("type", "video");
  u.searchParams.set("videoCategoryId", "10");
  u.searchParams.set("maxResults", "30");
  u.searchParams.set("order", "relevance");
  u.searchParams.set("q", query);
  u.searchParams.set("key", env.YOUTUBE_API_KEY);

  const response = await fetch(u);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || "YouTube search failed.");
  }

  const raw = Array.isArray(data.items) ? data.items : [];
  const ids = raw.map((x) => x?.id?.videoId).filter(Boolean);
  const statusMap = new Map();
  const mediaMap = new Map();

  await Promise.all(
    ids.map(async (videoId) => {
      try {
        const entry = await getMediaEntry(env, videoId);
        if (entry) mediaMap.set(videoId, entry);
      } catch (error) {
        console.error("Media lookup failed for", videoId, error);
      }
    })
  );

  if (ids.length) {
    const details = new URL("https://www.googleapis.com/youtube/v3/videos");
    details.searchParams.set("part", "status");
    details.searchParams.set("id", ids.join(","));
    details.searchParams.set("key", env.YOUTUBE_API_KEY);

    const detailResponse = await fetch(details);
    if (detailResponse.ok) {
      const detailData = await detailResponse.json();
      for (const item of detailData.items || []) {
        statusMap.set(item.id, item.status || {});
      }
    }
  }

  return raw.map((item) => {
    const videoId = item?.id?.videoId || "";
    const snippet = item?.snippet || {};
    const thumbs = snippet.thumbnails || {};
    const status = statusMap.get(videoId) || {};
    const media = mediaMap.get(videoId) || null;
    const formats = [];

    if (media?.formats?.mp3) formats.push("mp3");
    if (media?.formats?.mp4) formats.push("mp4");

    return {
      videoId,
      title: decodeEntities(snippet.title || "Untitled"),
      channel: decodeEntities(snippet.channelTitle || "YouTube"),
      channelId: snippet.channelId || "",
      thumbnail:
        thumbs.high?.url ||
        thumbs.medium?.url ||
        thumbs.default?.url ||
        "",
      embeddable: status.embeddable !== false,
      downloadFormats: formats
    };
  });
}

async function serveDownload(env, videoId, format) {
  if (!env.MEDIA) {
    return json({ error: "R2 binding MEDIA is missing." }, 503);
  }

  const entry = await getMediaEntry(env, videoId);
  const record = entry?.formats?.[format];

  if (!record?.key) {
    return json(
      {
        error:
          "This format is not in your DRAGON media library. Upload or map your own file in Admin."
      },
      404
    );
  }

  const object = await env.MEDIA.get(record.key);
  if (!object) {
    return json(
      { error: "The mapped file no longer exists in R2 storage." },
      404
    );
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);

  const fallbackName = videoId + "." + format;
  const filename = safeFilename(
    record.filename || object.customMetadata?.filename,
    fallbackName
  );

  headers.set(
    "content-type",
    headers.get("content-type") ||
      (format === "mp3" ? "audio/mpeg" : "video/mp4")
  );
  headers.set(
    "content-disposition",
    'attachment; filename="' + filename.replaceAll('"', "") + '"'
  );
  headers.set("cache-control", "private, no-store");
  headers.set("etag", object.httpEtag);

  return new Response(object.body, { headers });
}

async function handleAdmin(request, env, url) {
  const authError = adminAuthError(request, env);
  if (authError) return authError;

  if (!env.MEDIA) {
    return json({ error: "R2 binding MEDIA is missing." }, 503);
  }

  if (url.pathname === "/api/admin/media" && request.method === "GET") {
    const items = await listMediaEntries(env);
    return json({ items });
  }

  if (url.pathname === "/api/admin/media/upload" && request.method === "POST") {
    const videoId = parseVideoId(url.searchParams.get("videoId"));
    const format = normalizeFormat(url.searchParams.get("format"));
    const filenameHeader = request.headers.get("x-file-name") || "";
    const contentLength = Number(request.headers.get("content-length") || 0);

    if (!videoId) return json({ error: "Invalid YouTube video ID or URL." }, 400);
    if (!format) return json({ error: "Format must be mp3 or mp4." }, 400);
    if (!request.body) return json({ error: "Missing file body." }, 400);

    const extension = format === "mp3" ? ".mp3" : ".mp4";
    const filename = safeFilename(
      decodeURIComponent(filenameHeader || ""),
      videoId + extension
    );

    if (!filename.toLowerCase().endsWith(extension)) {
      return json({ error: "Selected file extension does not match format." }, 400);
    }

    const key =
      "media/" +
      videoId +
      "/" +
      format +
      "/" +
      Date.now() +
      "-" +
      filename.replace(/[^A-Za-z0-9._-]+/g, "_");

    const contentType =
      request.headers.get("content-type") ||
      (format === "mp3" ? "audio/mpeg" : "video/mp4");

    const object = await env.MEDIA.put(key, request.body, {
      httpMetadata: {
        contentType
      },
      customMetadata: {
        videoId,
        format,
        filename
      }
    });

    const oldEntry = await getMediaEntry(env, videoId);
    const oldRecord = oldEntry?.formats?.[format];

    const record = {
      key,
      filename,
      size: contentLength || null,
      contentType,
      uploadedAt: new Date().toISOString(),
      source: "upload"
    };

    const saved = await saveMediaFormat(env, videoId, format, record);

    if (oldRecord?.key && oldRecord.key !== key) {
      try {
        await env.MEDIA.delete(oldRecord.key);
      } catch (error) {
        console.error("Old object cleanup failed:", error);
      }
    }

    return json(
      {
        ok: true,
        etag: object?.etag || null,
        item: saved
      },
      201
    );
  }

  if (url.pathname === "/api/admin/media/map" && request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body." }, 400);
    }

    const videoId = parseVideoId(body?.videoId || body?.youtube);
    const format = normalizeFormat(body?.format);
    const key = String(body?.key || "").trim();

    if (!videoId) return json({ error: "Invalid YouTube video ID or URL." }, 400);
    if (!format) return json({ error: "Format must be mp3 or mp4." }, 400);
    if (!key) return json({ error: "R2 object key is required." }, 400);

    const object = await env.MEDIA.head(key);
    if (!object) {
      return json({ error: "That R2 object key does not exist." }, 404);
    }

    const extension = format === "mp3" ? ".mp3" : ".mp4";
    const filename = safeFilename(
      body?.filename || object.customMetadata?.filename,
      videoId + extension
    );

    const record = {
      key,
      filename,
      size: object.size || null,
      contentType:
        object.httpMetadata?.contentType ||
        (format === "mp3" ? "audio/mpeg" : "video/mp4"),
      uploadedAt: new Date().toISOString(),
      source: "mapped"
    };

    const saved = await saveMediaFormat(env, videoId, format, record);
    return json({ ok: true, item: saved }, 201);
  }

  if (
    url.pathname.startsWith("/api/admin/media/") &&
    request.method === "DELETE"
  ) {
    const parts = url.pathname.split("/").filter(Boolean);
    const videoId = parts[3] || "";
    const format = normalizeFormat(parts[4]);

    if (!isVideoId(videoId) || !format) {
      return json({ error: "Invalid media mapping." }, 400);
    }

    const entry = await getMediaEntry(env, videoId);
    const record = entry?.formats?.[format];
    const deleteObject = url.searchParams.get("deleteObject") !== "false";

    await deleteMediaFormat(env, videoId, format);

    if (deleteObject && record?.key) {
      try {
        await env.MEDIA.delete(record.key);
      } catch (error) {
        console.error("R2 delete failed:", error);
      }
    }

    return json({ ok: true, videoId, format });
  }

  return json({ error: "Admin route not found." }, 404);
}

export class MediaRegistry extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    const key = "media";

    const all = (await this.ctx.storage.get(key)) || {};

    if (url.pathname === "/media" && request.method === "GET") {
      return json({
        items: Object.values(all).sort((a, b) =>
          String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
        )
      });
    }

    if (url.pathname.startsWith("/media/")) {
      const parts = url.pathname.split("/").filter(Boolean);
      const videoId = parts[1] || "";
      const format = parts[2] || "";

      if (!isVideoId(videoId)) {
        return json({ error: "Invalid video ID." }, 400);
      }

      if (parts.length === 2 && request.method === "GET") {
        const item = all[videoId];
        return item ? json(item) : json({ error: "Not found." }, 404);
      }

      if (parts.length === 3 && request.method === "PUT") {
        const normalized = normalizeFormat(format);
        if (!normalized) return json({ error: "Invalid format." }, 400);

        const record = await request.json();
        const item = all[videoId] || {
          videoId,
          formats: {},
          createdAt: new Date().toISOString()
        };

        item.formats[normalized] = record;
        item.updatedAt = new Date().toISOString();
        all[videoId] = item;
        await this.ctx.storage.put(key, all);

        return json(item);
      }

      if (parts.length === 3 && request.method === "DELETE") {
        const normalized = normalizeFormat(format);
        if (!normalized) return json({ error: "Invalid format." }, 400);

        const item = all[videoId];
        if (!item?.formats?.[normalized]) {
          return json({ error: "Not found." }, 404);
        }

        delete item.formats[normalized];
        item.updatedAt = new Date().toISOString();

        if (!item.formats.mp3 && !item.formats.mp4) {
          delete all[videoId];
        } else {
          all[videoId] = item;
        }

        await this.ctx.storage.put(key, all);
        return json({ ok: true, videoId, format: normalized });
      }
    }

    return json({ error: "Registry route not found." }, 404);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith("/api/admin/")) {
        return handleAdmin(request, env, url);
      }

      if (url.pathname === "/api/search") {
        if (!env.YOUTUBE_API_KEY) {
          return json({ error: "YOUTUBE_API_KEY is missing." }, 500);
        }

        const q = String(url.searchParams.get("q") || "").trim();
        if (!q) return json({ error: "Missing search query." }, 400);

        const tracks = await searchYouTube(env, q);
        return json({ query: q, count: tracks.length, tracks });
      }

      if (url.pathname === "/api/download") {
        const videoId = String(url.searchParams.get("videoId") || "");
        const format = normalizeFormat(url.searchParams.get("format"));

        if (!isVideoId(videoId)) {
          return json({ error: "Invalid YouTube video ID." }, 400);
        }

        if (!format) {
          return json({ error: "Format must be mp3 or mp4." }, 400);
        }

        return serveDownload(env, videoId, format);
      }

      if (url.pathname === "/api/health") {
        return json({
          worker: true,
          storage: Boolean(env.MEDIA),
          registry: Boolean(env.MEDIA_REGISTRY),
          youtubeSearch: Boolean(env.YOUTUBE_API_KEY),
          downloadPath: "Cloudflare R2"
        });
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json({ error: error?.message || "DRAGON internal error." }, 500);
    }
  }
};
