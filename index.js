function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function decodeEntities(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function durationSeconds(value) {
  const m = String(value || "").match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}

async function searchYouTube(env, query, pageToken = "") {
  const u = new URL("https://www.googleapis.com/youtube/v3/search");
  u.searchParams.set("part", "snippet");
  u.searchParams.set("type", "video");
  u.searchParams.set("videoCategoryId", "10");
  u.searchParams.set("maxResults", "30");
  u.searchParams.set("order", "relevance");
  u.searchParams.set("q", query);
  u.searchParams.set("key", env.YOUTUBE_API_KEY);
  if (pageToken) u.searchParams.set("pageToken", pageToken);

  const response = await fetch(u);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || "Search failed.");
  }

  const items = Array.isArray(data.items) ? data.items : [];
  const ids = items.map((x) => x?.id?.videoId).filter(Boolean);
  const details = new Map();

  if (ids.length) {
    const d = new URL("https://www.googleapis.com/youtube/v3/videos");
    d.searchParams.set("part", "status,contentDetails,statistics,snippet");
    d.searchParams.set("id", ids.join(","));
    d.searchParams.set("key", env.YOUTUBE_API_KEY);

    const detailResponse = await fetch(d);
    if (detailResponse.ok) {
      const detailData = await detailResponse.json();
      for (const item of detailData.items || []) details.set(item.id, item);
    }
  }

  return {
    tracks: items.map((item) => {
      const videoId = item?.id?.videoId || "";
      const full = details.get(videoId) || {};
      const snippet = full.snippet || item.snippet || {};
      const thumbs = snippet.thumbnails || {};
      return {
        videoId,
        title: decodeEntities(snippet.title || "Untitled"),
        channel: decodeEntities(snippet.channelTitle || "YouTube"),
        thumbnail:
          thumbs.maxres?.url ||
          thumbs.standard?.url ||
          thumbs.high?.url ||
          thumbs.medium?.url ||
          thumbs.default?.url ||
          "",
        durationSeconds: durationSeconds(full.contentDetails?.duration),
        views: Number(full.statistics?.viewCount || 0),
        embeddable: full.status?.embeddable !== false
      };
    }),
    nextPageToken: data.nextPageToken || null
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/search") {
        if (!env.YOUTUBE_API_KEY) return json({ error: "YOUTUBE_API_KEY is missing." }, 500);

        const q = String(url.searchParams.get("q") || "").trim();
        const pageToken = String(url.searchParams.get("pageToken") || "").trim();
        if (!q) return json({ error: "Missing search query." }, 400);

        const result = await searchYouTube(env, q, pageToken);
        return json({ query: q, count: result.tracks.length, ...result });
      }

      if (url.pathname === "/api/health") {
        return json({
          worker: true,
          youtubeSearch: Boolean(env.YOUTUBE_API_KEY),
          mode: "listen-only"
        });
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json({ error: error?.message || "DRAGON internal error." }, 500);
    }
  }
};
