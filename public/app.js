(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const query = $("query");
  const searchBtn = $("searchBtn");
  const results = $("results");
  const count = $("count");
  const status = $("status");
  const cover = $("cover");
  const coverPlaceholder = $("coverPlaceholder");
  const nowTitle = $("nowTitle");
  const nowChannel = $("nowChannel");
  const iframeWrap = $("iframeWrap");
  const openBtn = $("openBtn");
  const downloadBtn = $("downloadBtn");
  const message = $("message");

  let tracks = [];
  let selected = null;
  let format = "mp3";

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function search() {
    const q = query.value.trim();
    if (!q) return;

    searchBtn.disabled = true;
    searchBtn.textContent = "SEARCHING";
    status.textContent = "SEARCHING";

    try {
      const response = await fetch("/api/search?q=" + encodeURIComponent(q));
      const data = await response.json();

      if (!response.ok) throw new Error(data.error || "Search failed.");

      tracks = Array.isArray(data.tracks) ? data.tracks : [];
      render();
      status.textContent = "ONLINE";
    } catch (error) {
      results.innerHTML =
        '<div class="empty">' + esc(error.message || "SEARCH FAILED") + "</div>";
      count.textContent = "0";
      status.textContent = "ERROR";
    } finally {
      searchBtn.disabled = false;
      searchBtn.textContent = "SEARCH";
    }
  }

  function render() {
    count.textContent = String(tracks.length);

    if (!tracks.length) {
      results.innerHTML = '<div class="empty">NO RESULTS</div>';
      return;
    }

    results.innerHTML = tracks.map((track, index) => {
      const downloadAction = track.downloadAuthorized
        ? '<button class="download" data-download="' + index + '">DOWNLOAD</button>'
        : "";

      const authFlag = track.downloadAuthorized
        ? '<span class="flag authorized">AUTHORIZED DOWNLOAD</span>'
        : '<span class="flag">LISTEN</span>';

      return (
        '<article class="track">' +
          '<img src="' + esc(track.thumbnail) + '" alt="">' +
          '<div>' +
            '<div class="track-title">' + esc(track.title) + '</div>' +
            '<div class="track-channel">' + esc(track.channel) + '</div>' +
            '<div class="track-flags">' +
              '<span class="flag">YOUTUBE</span>' +
              authFlag +
            '</div>' +
          '</div>' +
          '<div class="track-actions">' +
            '<button data-play="' + index + '">LISTEN</button>' +
            downloadAction +
          '</div>' +
        '</article>'
      );
    }).join("");
  }

  function selectTrack(track) {
    selected = track;

    nowTitle.textContent = track.title;
    nowChannel.textContent = track.channel;

    cover.src = track.thumbnail || "";
    cover.style.display = track.thumbnail ? "block" : "none";
    coverPlaceholder.style.display = track.thumbnail ? "none" : "grid";

    const youtubeUrl =
      "https://www.youtube.com/watch?v=" + encodeURIComponent(track.videoId);

    openBtn.disabled = false;
    openBtn.onclick = () => window.open(youtubeUrl, "_blank", "noopener,noreferrer");

    if (track.embeddable === false) {
      iframeWrap.innerHTML = '<div class="player-empty">EMBED DISABLED — OPEN IN YOUTUBE</div>';
      message.textContent = "THIS VIDEO CANNOT BE EMBEDDED";
    } else {
      const src =
        "https://www.youtube.com/embed/" +
        encodeURIComponent(track.videoId) +
        "?autoplay=1&playsinline=1&rel=0&origin=" +
        encodeURIComponent(window.location.origin);

      iframeWrap.innerHTML =
        '<iframe title="YouTube player" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen src="' +
        esc(src) +
        '"></iframe>';

      message.textContent = "PLAYING";
    }

    downloadBtn.disabled = !track.downloadAuthorized;
    downloadBtn.textContent = track.downloadAuthorized
      ? "DOWNLOAD " + format.toUpperCase()
      : "DOWNLOAD LOCKED";

    downloadBtn.onclick = () => downloadSelected();
  }

  function downloadSelected() {
    if (!selected || !selected.downloadAuthorized) return;

    // The browser sends only the videoId. The Worker creates the full YouTube URL
    // internally and passes it to the yt-dlp backend.
    const href =
      "/api/download?videoId=" +
      encodeURIComponent(selected.videoId) +
      "&format=" +
      encodeURIComponent(format);

    message.textContent = "PREPARING " + format.toUpperCase();

    const a = document.createElement("a");
    a.href = href;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 1500);
  }

  searchBtn.addEventListener("click", search);

  query.addEventListener("keydown", (event) => {
    if (event.key === "Enter") search();
  });

  results.addEventListener("click", (event) => {
    const play = event.target.closest("[data-play]");
    if (play) {
      const i = Number(play.dataset.play);
      if (tracks[i]) selectTrack(tracks[i]);
      return;
    }

    const dl = event.target.closest("[data-download]");
    if (dl) {
      const i = Number(dl.dataset.download);
      if (tracks[i]) {
        selectTrack(tracks[i]);
        downloadSelected();
      }
    }
  });

  document.querySelectorAll(".format").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".format").forEach((b) => b.classList.remove("active"));
      button.classList.add("active");
      format = button.dataset.format || "mp3";

      if (selected) {
        downloadBtn.textContent = selected.downloadAuthorized
          ? "DOWNLOAD " + format.toUpperCase()
          : "DOWNLOAD LOCKED";
      }
    });
  });

  // Subtle desktop-only depth effect.
  if (
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
    !window.matchMedia("(pointer: coarse)").matches
  ) {
    document.querySelectorAll(".tilt").forEach((el) => {
      el.addEventListener("mousemove", (event) => {
        const r = el.getBoundingClientRect();
        const x = (event.clientX - r.left) / r.width - 0.5;
        const y = (event.clientY - r.top) / r.height - 0.5;
        el.style.transform =
          "perspective(1000px) rotateX(" +
          (-y * 2.2) +
          "deg) rotateY(" +
          (x * 2.2) +
          "deg)";
      });

      el.addEventListener("mouseleave", () => {
        el.style.transform = "";
      });
    });

    const light = $("cursorLight");
    window.addEventListener("mousemove", (event) => {
      light.style.left = event.clientX + "px";
      light.style.top = event.clientY + "px";
    });
  }
})();
