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

function isAuthorized(env, videoId, channelId) {
  const ids = csvSet(env.AUTHORIZED_VIDEO_IDS);
  const channels = csvSet(env.AUTHORIZED_CHANNEL_IDS);
  return ids.has(videoId) || (channelId && channels.has(channelId));
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

  let statusMap = new Map();

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
      downloadAuthorized: isAuthorized(env, videoId, channelId)
    };
  });
}

async function proxyDownload(request, env, videoId, format) {
  if (!env.DOWNLOAD_BACKEND_URL) {
    return json({ error: "DOWNLOAD_BACKEND_URL is missing." }, 500);
  }

  if (!env.DOWNLOAD_BRIDGE_TOKEN) {
    return json({ error: "DOWNLOAD_BRIDGE_TOKEN is missing." }, 500);
  }

  const video = await getYouTubeVideo(env, videoId);
  if (!video) return json({ error: "Video not found." }, 404);

  const channelId = video?.snippet?.channelId || "";
  if (!isAuthorized(env, videoId, channelId)) {
    return json({
      error: "Download is enabled only for videos/channels you explicitly authorize for this test."
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

  return new Response(upstream.body, {
    status: upstream.status,
    headers: upstream.headers
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
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
        const format = String(url.searchParams.get("format") || "mp3").toLowerCase();

        if (!isVideoId(videoId)) {
          return json({ error: "Invalid YouTube video ID." }, 400);
        }

        if (!["mp3", "mp4"].includes(format)) {
          return json({ error: "Format must be mp3 or mp4." }, 400);
        }

        return proxyDownload(request, env, videoId, format);
      }

      if (url.pathname === "/api/health") {
        if (!env.DOWNLOAD_BACKEND_URL) {
          return json({ worker: true, downloader: false, error: "DOWNLOAD_BACKEND_URL missing" }, 503);
        }

        try {
          const target = new URL("/health", env.DOWNLOAD_BACKEND_URL);
          const response = await fetch(target.toString());
          return json({ worker: true, downloader: response.ok }, response.ok ? 200 : 503);
        } catch {
          return json({ worker: true, downloader: false }, 503);
        }
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json({ error: error?.message || "DRAGON internal error." }, 500);
    }
  }
};
