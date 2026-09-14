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

function csvSet(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
  );
}

function isVideoId(value) {
  return /^[A-Za-z0-9_-]{11}$/.test(String(value || ""));
}

function isChannelId(value) {
  return /^UC[A-Za-z0-9_-]{22}$/.test(String(value || ""));
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

function registryStub(env) {
  if (!env.CHANNEL_REGISTRY) return null;
  const id = env.CHANNEL_REGISTRY.idFromName("authorized-channels");
  return env.CHANNEL_REGISTRY.get(id);
}

async function registryRequest(env, path, init = {}) {
  const stub = registryStub(env);
  if (!stub) {
    return json({ error: "CHANNEL_REGISTRY binding is missing." }, 503);
  }

  return stub.fetch(
    new Request("https://channel-registry.internal" + path, init)
  );
}

async function listManagedChannels(env) {
  const response = await registryRequest(env, "/channels");
  if (!response.ok) return [];
  const data = await response.json();
  return Array.isArray(data.channels) ? data.channels : [];
}

async function authorizedChannelSet(env) {
  const result = csvSet(env.AUTHORIZED_CHANNEL_IDS);

  try {
    const managed = await listManagedChannels(env);
    for (const channel of managed) {
      if (channel?.id) result.add(channel.id);
    }
  } catch (error) {
    console.error("Channel registry read failed:", error);
  }

  return result;
}

async function isAuthorized(env, videoId, channelId) {
  const ids = csvSet(env.AUTHORIZED_VIDEO_IDS);
  if (ids.has(videoId)) return true;
  if (!channelId) return false;

  const channels = await authorizedChannelSet(env);
  return channels.has(channelId);
}

function adminAuthError(request, env) {
  const token = String(env.ADMIN_TOKEN || "");
  if (!token) {
    return json({ error: "ADMIN_TOKEN is not configured." }, 503);
  }

  const auth = request.headers.get("authorization") || "";
  if (auth !== "Bearer " + token) {
    return json({ error: "Unauthorized." }, 401);
  }

  return null;
}

async function getYouTubeVideo(env, videoId) {
  const u = new URL("https://www.googleapis.com/youtube/v3/videos");
  u.searchParams.set("part", "snippet,status");
  u.searchParams.set("id", videoId);
  u.searchParams.set("key", env.YOUTUBE_API_KEY);

  const response = await fetch(u);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || "YouTube video lookup failed.");
  }

  return Array.isArray(data.items) ? data.items[0] || null : null;
}

function parseChannelReference(input) {
  const value = String(input || "").trim();
  if (!value) return null;

  if (isChannelId(value)) {
    return { type: "id", value };
  }

  if (value.startsWith("@") && value.length > 1) {
    return { type: "handle", value };
  }

  let url;
  try {
    url = new URL(value.startsWith("http") ? value : "https://" + value);
  } catch {
    return null;
  }

  if (!["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)) {
    return null;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  if (parts[0] === "channel" && isChannelId(parts[1])) {
    return { type: "id", value: parts[1] };
  }

  if (parts[0].startsWith("@")) {
    return { type: "handle", value: parts[0] };
  }

  if (parts[0] === "user" && parts[1]) {
    return { type: "username", value: parts[1] };
  }

  return null;
}

async function resolveChannel(env, input) {
  if (!env.YOUTUBE_API_KEY) {
    throw new Error("YOUTUBE_API_KEY is missing.");
  }

  const ref = parseChannelReference(input);
  if (!ref) {
    throw new Error(
      "Use a channel ID, @handle, youtube.com/@handle, youtube.com/channel/ID, or youtube.com/user/name."
    );
  }

  const u = new URL("https://www.googleapis.com/youtube/v3/channels");
  u.searchParams.set("part", "snippet");
  u.searchParams.set("key", env.YOUTUBE_API_KEY);

  if (ref.type === "id") u.searchParams.set("id", ref.value);
  if (ref.type === "handle") u.searchParams.set("forHandle", ref.value);
  if (ref.type === "username") u.searchParams.set("forUsername", ref.value);

  const response = await fetch(u);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || "YouTube channel lookup failed.");
  }

  const item = Array.isArray(data.items) ? data.items[0] : null;
  if (!item?.id) {
    throw new Error("YouTube channel not found.");
  }

  const snippet = item.snippet || {};
  const thumbs = snippet.thumbnails || {};

  return {
    id: item.id,
    title: decodeEntities(snippet.title || item.id),
    handle: snippet.customUrl || "",
    thumbnail:
      thumbs.medium?.url ||
      thumbs.default?.url ||
      thumbs.high?.url ||
      "",
    addedAt: new Date().toISOString()
  };
}

async function searchYouTube(env, query) {
  const managedChannelsPromise = authorizedChannelSet(env);

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

  const channelSet = await managedChannelsPromise;
  const videoSet = csvSet(env.AUTHORIZED_VIDEO_IDS);

  return raw.map((item) => {
    const videoId = item?.id?.videoId || "";
    const snippet = item?.snippet || {};
    const thumbs = snippet.thumbnails || {};
    const channelId = snippet.channelId || "";
    const status = statusMap.get(videoId) || {};

    return {
      videoId,
      title: decodeEntities(snippet.title || "Untitled"),
      channel: decodeEntities(snippet.channelTitle || "YouTube"),
      channelId,
      thumbnail:
        thumbs.high?.url ||
        thumbs.medium?.url ||
        thumbs.default?.url ||
        "",
      embeddable: status.embeddable !== false,
      downloadAuthorized:
        videoSet.has(videoId) || (channelId && channelSet.has(channelId))
    };
  });
}

async function proxyDownload(env, videoId, format) {
  if (!env.DOWNLOAD_BACKEND_URL) {
    return json({ error: "DOWNLOAD_BACKEND_URL is missing." }, 500);
  }

  if (!env.DOWNLOAD_BRIDGE_TOKEN) {
    return json({ error: "DOWNLOAD_BRIDGE_TOKEN is missing." }, 500);
  }

  const video = await getYouTubeVideo(env, videoId);
  if (!video) return json({ error: "Video not found." }, 404);

  const channelId = video?.snippet?.channelId || "";
  if (!(await isAuthorized(env, videoId, channelId))) {
    return json({
      error: "Download is enabled only for videos/channels you explicitly authorize."
    }, 403);
  }

  const internalYouTubeUrl =
    "https://www.youtube.com/watch?v=" + encodeURIComponent(videoId);

  const backend = new URL("/api/download", env.DOWNLOAD_BACKEND_URL);
  backend.searchParams.set("url", internalYouTubeUrl);
  backend.searchParams.set("format", format);

  const upstream = await fetch(backend.toString(), {
    method: "GET",
    headers: {
      "authorization": "Bearer " + env.DOWNLOAD_BRIDGE_TOKEN
    }
  });

  const headers = new Headers(upstream.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  });
}

async function handleAdmin(request, env, url) {
  const authError = adminAuthError(request, env);
  if (authError) return authError;

  if (url.pathname === "/api/admin/channels" && request.method === "GET") {
    const channels = await listManagedChannels(env);
    return json({
      channels,
      legacyChannelIds: [...csvSet(env.AUTHORIZED_CHANNEL_IDS)]
    });
  }

  if (url.pathname === "/api/admin/channels" && request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body." }, 400);
    }

    const input = String(body?.channel || "").trim();
    if (!input) {
      return json({ error: "Channel is required." }, 400);
    }

    let channel;
    try {
      channel = await resolveChannel(env, input);
    } catch (error) {
      return json({ error: error?.message || "Channel lookup failed." }, 400);
    }

    const response = await registryRequest(env, "/channels", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(channel)
    });

    if (!response.ok) {
      return json({ error: "Could not save channel." }, 500);
    }

    const saved = await response.json();
    return json(saved, 201);
  }

  if (
    url.pathname.startsWith("/api/admin/channels/") &&
    request.method === "DELETE"
  ) {
    const channelId = decodeURIComponent(
      url.pathname.slice("/api/admin/channels/".length)
    );

    if (!isChannelId(channelId)) {
      return json({ error: "Invalid channel ID." }, 400);
    }

    const response = await registryRequest(
      env,
      "/channels/" + encodeURIComponent(channelId),
      { method: "DELETE" }
    );

    return new Response(response.body, {
      status: response.status,
      headers: response.headers
    });
  }

  return json({ error: "Admin route not found." }, 404);
}

export class ChannelRegistry extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    const key = "channels";

    if (url.pathname === "/channels" && request.method === "GET") {
      const channels = (await this.ctx.storage.get(key)) || {};
      return json({
        channels: Object.values(channels).sort((a, b) =>
          String(a.title || a.id).localeCompare(String(b.title || b.id))
        )
      });
    }

    if (url.pathname === "/channels" && request.method === "PUT") {
      const channel = await request.json();

      if (!channel?.id || !isChannelId(channel.id)) {
        return json({ error: "Invalid channel." }, 400);
      }

      const channels = (await this.ctx.storage.get(key)) || {};
      channels[channel.id] = channel;
      await this.ctx.storage.put(key, channels);

      return json({
        channel,
        channels: Object.values(channels).sort((a, b) =>
          String(a.title || a.id).localeCompare(String(b.title || b.id))
        )
      });
    }

    if (
      url.pathname.startsWith("/channels/") &&
      request.method === "DELETE"
    ) {
      const channelId = decodeURIComponent(
        url.pathname.slice("/channels/".length)
      );

      const channels = (await this.ctx.storage.get(key)) || {};
      const existed = Boolean(channels[channelId]);
      delete channels[channelId];
      await this.ctx.storage.put(key, channels);

      return json({ deleted: existed, channelId });
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
        const format = String(
          url.searchParams.get("format") || "mp3"
        ).toLowerCase();

        if (!isVideoId(videoId)) {
          return json({ error: "Invalid YouTube video ID." }, 400);
        }

        if (!["mp3", "mp4"].includes(format)) {
          return json({ error: "Format must be mp3 or mp4." }, 400);
        }

        return proxyDownload(env, videoId, format);
      }

      if (url.pathname === "/api/health") {
        if (!env.DOWNLOAD_BACKEND_URL) {
          return json(
            {
              worker: true,
              downloader: false,
              registry: Boolean(env.CHANNEL_REGISTRY),
              error: "DOWNLOAD_BACKEND_URL missing"
            },
            503
          );
        }

        try {
          const target = new URL("/health", env.DOWNLOAD_BACKEND_URL);
          const response = await fetch(target.toString());
          return json(
            {
              worker: true,
              downloader: response.ok,
              registry: Boolean(env.CHANNEL_REGISTRY)
            },
            response.ok ? 200 : 503
          );
        } catch {
          return json(
            {
              worker: true,
              downloader: false,
              registry: Boolean(env.CHANNEL_REGISTRY)
            },
            503
          );
        }
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json({ error: error?.message || "DRAGON internal error." }, 500);
    }
  }
};
