import { Container } from "@cloudflare/containers";

export class DragonDownloader extends Container {
  defaultPort = 8080;
  sleepAfter = "10m";
}

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
        if (!env.YOUTUBE_API_KEY) {
          return json({ error: "YOUTUBE_API_KEY is missing." }, 500);
        }

        const videoId = String(url.searchParams.get("videoId") || "");
        const format = String(url.searchParams.get("format") || "mp3").toLowerCase();

        if (!isVideoId(videoId)) {
          return json({ error: "Invalid YouTube video ID." }, 400);
        }

        if (format !== "mp3" && format !== "mp4") {
          return json({ error: "Format must be mp3 or mp4." }, 400);
        }

        // Re-check authorization server-side. We do not trust the browser.
        const video = await getYouTubeVideo(env, videoId);
        if (!video) return json({ error: "Video not found." }, 404);

        const channelId = video?.snippet?.channelId || "";
        if (!isAuthorized(env, videoId, channelId)) {
          return json({
            error:
              "This Cloudflare-only test downloads only videos/channels you explicitly authorize."
          }, 403);
        }

        // This is the internal handoff you asked for:
        // browser sends only videoId -> Worker creates the YouTube URL ->
        // Worker passes the URL internally to the YoutubeDownloader container.
        const internalYouTubeUrl =
          "https://www.youtube.com/watch?v=" + encodeURIComponent(videoId);

        const internalUrl = new URL("http://dragon-container/api/download");
        internalUrl.searchParams.set("url", internalYouTubeUrl);
        internalUrl.searchParams.set("format", format);

        const container = env.DOWNLOADER.getByName("dragon-primary");

        const containerRequest = new Request(internalUrl.toString(), {
          method: "GET",
          headers: {
            "x-dragon-internal": "1"
          }
        });

        const response = await container.fetch(containerRequest);

        // Stream the container response straight back to the browser.
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      }

      if (url.pathname === "/api/health") {
        const container = env.DOWNLOADER.getByName("dragon-primary");
        const response = await container.fetch(
          new Request("http://dragon-container/health")
        );

        return json({
          worker: true,
          downloader: response.ok
        }, response.ok ? 200 : 503);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json(
        {
          error: error?.message || "DRAGON internal error."
        },
        500
      );
    }
  }
};
