(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const query = $("query");
  const results = $("results");
  const count = $("count");
  const resultsTitle = $("resultsTitle");
  const loadMore = $("loadMore");
  const playerPanel = $("playerPanel");
  const playerThumb = $("playerThumb");
  const playerTitle = $("playerTitle");
  const playerChannel = $("playerChannel");
  const playPauseBtn = $("playPauseBtn");
  const prevBtn = $("prevBtn");
  const nextBtn = $("nextBtn");
  const progress = $("progress");
  const currentTime = $("currentTime");
  const duration = $("duration");
  const openYouTube = $("openYouTube");
  const queueToggle = $("queueToggle");
  const queuePanel = $("queuePanel");
  const queueClose = $("queueClose");
  const queueList = $("queueList");
  const recentSearches = $("recentSearches");
  const toast = $("toast");

  let tracks = [];
  let queue = [];
  let selectedIndex = -1;
  let nextPageToken = null;
  let activeQuery = "";
  let player = null;
  let playerReady = false;
  let progressTimer = null;

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function fmtTime(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds || 0)));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h ? `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}` : `${m}:${String(sec).padStart(2,"0")}`;
  }

  function fmtViews(value) {
    const n = Number(value || 0);
    if (n >= 1e9) return (n/1e9).toFixed(1).replace(".0","") + "B";
    if (n >= 1e6) return (n/1e6).toFixed(1).replace(".0","") + "M";
    if (n >= 1e3) return (n/1e3).toFixed(1).replace(".0","") + "K";
    return n ? String(n) : "";
  }

  function showToast(text) {
    toast.textContent = text;
    toast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove("show"), 1800);
  }

  function saveRecent(q) {
    const current = JSON.parse(localStorage.getItem("dragon_recent") || "[]");
    const next = [q, ...current.filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 6);
    localStorage.setItem("dragon_recent", JSON.stringify(next));
    renderRecent();
  }

  function renderRecent() {
    const items = JSON.parse(localStorage.getItem("dragon_recent") || "[]");
    recentSearches.innerHTML = items.length
      ? items.map(q => `<button data-recent="${esc(q)}">${esc(q)}</button>`).join("")
      : '<div class="recent-empty">No searches yet</div>';
  }

  async function search(q, append = false) {
    q = String(q || "").trim();
    if (!q) return;

    if (!append) {
      activeQuery = q;
      saveRecent(q);
      results.innerHTML = '<div class="loading-state"><div class="loader"></div><span>Searching DRAGON...</span></div>';
      count.textContent = "0";
      resultsTitle.textContent = q;
      nextPageToken = null;
    }

    const url = new URL("/api/search", location.origin);
    url.searchParams.set("q", q);
    if (append && nextPageToken) url.searchParams.set("pageToken", nextPageToken);

    try {
      const response = await fetch(url);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Search failed");

      const incoming = Array.isArray(data.tracks) ? data.tracks : [];
      tracks = append ? [...tracks, ...incoming] : incoming;
      queue = tracks.slice();
      nextPageToken = data.nextPageToken || null;
      renderTracks();
      renderQueue();
      loadMore.hidden = !nextPageToken;
      query.value = q;
    } catch (error) {
      if (!append) {
        results.innerHTML = `<div class="empty-state"><h3>Search failed</h3><p>${esc(error.message)}</p></div>`;
      }
      showToast(error.message || "Search failed");
    }
  }

  function renderTracks() {
    count.textContent = String(tracks.length);

    if (!tracks.length) {
      results.innerHTML = '<div class="empty-state"><h3>No results</h3><p>Try a different search.</p></div>';
      return;
    }

    results.innerHTML = tracks.map((track, index) => {
      const views = fmtViews(track.views);
      const meta = [track.channel, views ? views + " views" : "", track.durationSeconds ? fmtTime(track.durationSeconds) : ""]
        .filter(Boolean).join(" · ");

      return `
        <article class="track-card ${selectedIndex === index ? "active" : ""}" data-index="${index}">
          <button class="cover-button" data-play="${index}" type="button">
            <img src="${esc(track.thumbnail)}" alt="">
            <span class="cover-overlay"><span class="cover-play">▶</span></span>
          </button>
          <div class="track-info">
            <div class="track-title">${esc(track.title)}</div>
            <div class="track-meta">${esc(meta)}</div>
          </div>
          <div class="track-actions">
            <button data-queue="${index}" type="button" title="Add to queue">＋</button>
            <button data-youtube="${index}" type="button" title="Open on YouTube">↗</button>
          </div>
        </article>
      `;
    }).join("");
  }

  function renderQueue() {
    queueList.innerHTML = queue.length
      ? queue.map((track, index) => `
          <button class="queue-item ${tracks[selectedIndex]?.videoId === track.videoId ? "active" : ""}" data-queue-play="${index}" type="button">
            <img src="${esc(track.thumbnail)}" alt="">
            <span>
              <strong>${esc(track.title)}</strong>
              <small>${esc(track.channel)}</small>
            </span>
          </button>
        `).join("")
      : '<div class="recent-empty">Queue is empty</div>';
  }

  function ensurePlayer(videoId) {
    if (playerReady && player) {
      player.loadVideoById(videoId);
      return;
    }

    const mount = document.createElement("div");
    mount.id = "yt-player";
    $("youtubeMount").replaceChildren(mount);

    player = new YT.Player("yt-player", {
      height: "1",
      width: "1",
      videoId,
      playerVars: {
        autoplay: 1,
        controls: 0,
        playsinline: 1,
        rel: 0,
        origin: location.origin
      },
      events: {
        onReady: (event) => {
          playerReady = true;
          event.target.playVideo();
          startProgressLoop();
        },
        onStateChange: handlePlayerState
      }
    });
  }

  function handlePlayerState(event) {
    if (!window.YT) return;
    if (event.data === YT.PlayerState.PLAYING) {
      playPauseBtn.textContent = "❚❚";
      startProgressLoop();
    } else if (event.data === YT.PlayerState.PAUSED) {
      playPauseBtn.textContent = "▶";
    } else if (event.data === YT.PlayerState.ENDED) {
      playNext();
    }
  }

  function startProgressLoop() {
    clearInterval(progressTimer);
    progressTimer = setInterval(() => {
      if (!playerReady || !player?.getDuration) return;
      const now = Number(player.getCurrentTime?.() || 0);
      const total = Number(player.getDuration?.() || 0);
      currentTime.textContent = fmtTime(now);
      duration.textContent = fmtTime(total);
      progress.value = total ? String(Math.round((now / total) * 1000)) : "0";
    }, 500);
  }

  function playTrack(index) {
    const track = tracks[index];
    if (!track) return;

    if (track.embeddable === false) {
      showToast("This video cannot be embedded. Opening YouTube.");
      window.open("https://www.youtube.com/watch?v=" + encodeURIComponent(track.videoId), "_blank", "noopener,noreferrer");
      return;
    }

    selectedIndex = index;
    playerPanel.classList.remove("hidden");
    playerThumb.src = track.thumbnail || "";
    playerTitle.textContent = track.title;
    playerChannel.textContent = track.channel;
    openYouTube.onclick = () =>
      window.open("https://www.youtube.com/watch?v=" + encodeURIComponent(track.videoId), "_blank", "noopener,noreferrer");

    ensurePlayer(track.videoId);
    renderTracks();
    renderQueue();
  }

  function playNext() {
    if (!tracks.length) return;
    const next = selectedIndex < tracks.length - 1 ? selectedIndex + 1 : 0;
    playTrack(next);
  }

  function playPrev() {
    if (!tracks.length) return;
    const prev = selectedIndex > 0 ? selectedIndex - 1 : tracks.length - 1;
    playTrack(prev);
  }

  window.onYouTubeIframeAPIReady = () => {};

  query.addEventListener("keydown", (e) => {
    if (e.key === "Enter") search(query.value);
  });

  $("heroSearch").addEventListener("click", () => {
    query.focus();
    window.scrollTo({top:0, behavior:"smooth"});
  });

  document.querySelectorAll("[data-preset]").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-preset]").forEach(b => b.classList.remove("active"));
      button.classList.add("active");
      search(button.dataset.preset);
    });
  });

  recentSearches.addEventListener("click", (e) => {
    const button = e.target.closest("[data-recent]");
    if (button) search(button.dataset.recent);
  });

  results.addEventListener("click", (e) => {
    const play = e.target.closest("[data-play]");
    if (play) return playTrack(Number(play.dataset.play));

    const queueBtn = e.target.closest("[data-queue]");
    if (queueBtn) {
      const track = tracks[Number(queueBtn.dataset.queue)];
      if (track) {
        queue.push(track);
        renderQueue();
        showToast("Added to queue");
      }
      return;
    }

    const yt = e.target.closest("[data-youtube]");
    if (yt) {
      const track = tracks[Number(yt.dataset.youtube)];
      if (track) window.open("https://www.youtube.com/watch?v=" + encodeURIComponent(track.videoId), "_blank", "noopener,noreferrer");
    }
  });

  queueList.addEventListener("click", (e) => {
    const button = e.target.closest("[data-queue-play]");
    if (!button) return;
    const track = queue[Number(button.dataset.queuePlay)];
    const index = tracks.findIndex(t => t.videoId === track?.videoId);
    if (index >= 0) playTrack(index);
  });

  loadMore.addEventListener("click", () => {
    if (nextPageToken) search(activeQuery, true);
  });

  playPauseBtn.addEventListener("click", () => {
    if (!playerReady || !player) return;
    const state = player.getPlayerState();
    if (state === YT.PlayerState.PLAYING) player.pauseVideo();
    else player.playVideo();
  });

  nextBtn.addEventListener("click", playNext);
  prevBtn.addEventListener("click", playPrev);

  progress.addEventListener("input", () => {
    if (!playerReady || !player?.getDuration) return;
    const total = Number(player.getDuration() || 0);
    player.seekTo((Number(progress.value) / 1000) * total, true);
  });

  queueToggle.addEventListener("click", () => queuePanel.classList.add("open"));
  queueClose.addEventListener("click", () => queuePanel.classList.remove("open"));

  $("themePulse").addEventListener("click", () => {
    document.body.classList.toggle("focus-mode");
  });

  renderRecent();
})();
