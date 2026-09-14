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

async function getOmniGetInfo() {
  const headers = {
    "accept": "application/vnd.github+json",
    "user-agent": "DRAGON-Music-App"
  };

  const [repoResponse, releaseResponse] = await Promise.all([
    fetch("https://api.github.com/repos/tonhowtf/omniget", { headers }),
    fetch("https://api.github.com/repos/tonhowtf/omniget/releases/latest", { headers })
  ]);

  const repoData = repoResponse.ok ? await repoResponse.json() : {};
  const releaseData = releaseResponse.ok ? await releaseResponse.json() : {};

  const assets = Array.isArray(releaseData.assets)
    ? releaseData.assets.map((asset) => ({
        name: asset.name,
        size: Number(asset.size || 0),
        downloadUrl: asset.browser_download_url
      }))
    : [];

  return {
    repository: "tonhowtf/omniget",
    repositoryUrl: "https://github.com/tonhowtf/omniget",
    description: repoData.description || "Open-source desktop media toolbox.",
    stars: Number(repoData.stargazers_count || 0),
    license: repoData.license?.spdx_id || "GPL-3.0",
    release: releaseData.tag_name
      ? {
          tag: releaseData.tag_name,
          name: releaseData.name || releaseData.tag_name,
          publishedAt: releaseData.published_at || "",
          releaseUrl: releaseData.html_url || "https://github.com/tonhowtf/omniget/releases/latest",
          assets
        }
      : null
  };
}

function requireOmniGetBackend(env) {
  const base = String(env.OMNIGET_BACKEND_URL || "").trim().replace(/\/+$/, "");
  const token = String(env.OMNIGET_WEB_TOKEN || "").trim();
  if (!base || !token) {
    throw new Error("OmniGet web backend is not configured.");
  }
  return { base, token };
}

async function proxyOmniGet(env, path, request, options = {}) {
  const { base, token } = requireOmniGetBackend(env);
  const headers = new Headers();
  headers.set("authorization", "Bearer " + token);

  let body;
  if (options.forwardBody) {
    headers.set("content-type", "application/json");
    body = await request.text();
  }

  const upstream = await fetch(base + path, {
    method: options.method || request.method,
    headers,
    body
  });

  if (options.stream) {
    const responseHeaders = new Headers();
    for (const name of ["content-type", "content-length", "content-disposition", "etag", "last-modified"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    responseHeaders.set("cache-control", "private, no-store");
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders
    });
  }

  const text = await upstream.text();
  const responseHeaders = new Headers({
    "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  return new Response(text, { status: upstream.status, headers: responseHeaders });
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


      if (url.pathname === "/api/omniget") {
        const info = await getOmniGetInfo();
        return new Response(JSON.stringify(info), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "public, max-age=1800"
          }
        });
      }


      if (url.pathname === "/api/omniget/health") {
        return proxyOmniGet(env, "/health", request, { method: "GET" });
      }

      if (url.pathname === "/api/omniget/info" && request.method === "POST") {
        return proxyOmniGet(env, "/v1/info", request, {
          method: "POST",
          forwardBody: true
        });
      }

      if (url.pathname === "/api/omniget/download" && request.method === "POST") {
        return proxyOmniGet(env, "/v1/download", request, {
          method: "POST",
          forwardBody: true
        });
      }

      const omnigetJob = url.pathname.match(/^\/api\/omniget\/jobs\/([a-f0-9]+)$/i);
      if (omnigetJob && request.method === "GET") {
        return proxyOmniGet(
          env,
          "/v1/jobs/" + encodeURIComponent(omnigetJob[1]),
          request,
          { method: "GET" }
        );
      }

      const omnigetFile = url.pathname.match(/^\/api\/omniget\/files\/([a-f0-9]+)$/i);
      if (omnigetFile && request.method === "GET") {
        return proxyOmniGet(
          env,
          "/v1/files/" + encodeURIComponent(omnigetFile[1]),
          request,
          { method: "GET", stream: true }
        );
      }

      if (url.pathname === "/api/health") {
        return json({
          worker: true,
          youtubeSearch: Boolean(env.YOUTUBE_API_KEY),
          mode: "listen-only",
          omnigetWebConfigured: Boolean(env.OMNIGET_BACKEND_URL && env.OMNIGET_WEB_TOKEN)
        });
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json({ error: error?.message || "DRAGON internal error." }, 500);
    }
  }
};
