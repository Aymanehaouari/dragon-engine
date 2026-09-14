(() => {
  "use strict";

  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];

  const searchInputs = qsa('[data-role="search-input"]');
  const resultsRoots = qsa('[data-role="results"]');
  const titleRoots = qsa('[data-role="results-title"]');
  const countRoots = qsa('[data-role="count"]');
  const loadButtons = qsa('[data-action="load-more"]');
  const thumbRoots = qsa('[data-role="player-thumb"]');
  const playerTitleRoots = qsa('[data-role="player-title"]');
  const playerChannelRoots = qsa('[data-role="player-channel"]');
  const progressRoots = qsa('[data-role="progress"]');
  const currentTimeRoots = qsa('[data-role="current-time"]');
  const durationRoots = qsa('[data-role="duration"]');
  const playButtons = qsa('[data-action="play-pause"]');
  const queueLists = qsa('[data-role="queue-list"]');
  const toast = qs("#toast");

  let tracks = [];
  let queue = [];
  let selectedIndex = -1;
  let nextPageToken = null;
  let activeQuery = "";
  let player = null;
  let playerReady = false;
  let progressTimer = null;
  let currentVideoId = "";

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function fmtTime(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds || 0)));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h
      ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
      : `${m}:${String(sec).padStart(2, "0")}`;
  }

  function fmtViews(value) {
    const n = Number(value || 0);
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(".0", "") + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(".0", "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(".0", "") + "K";
    return n ? String(n) : "";
  }

  function applyAdaptiveAccent(track) {
    const seed = String(track?.videoId || track?.title || "DRAGON");
    let total = 0;
    for (let i = 0; i < seed.length; i++) total += seed.charCodeAt(i) * (i + 1);
    const hue = 235 + (total % 56);
    document.documentElement.style.setProperty("--accent-hue", String(hue));
  }

  function showToast(text) {
    toast.textContent = text;
    toast.classList.add("show");
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => toast.classList.remove("show"), 1800);
  }

  function saveRecent(query) {
    const current = JSON.parse(localStorage.getItem("dragon_recent") || "[]");
    const next = [
      query,
      ...current.filter((x) => x.toLowerCase() !== query.toLowerCase())
    ].slice(0, 7);

    localStorage.setItem("dragon_recent", JSON.stringify(next));
    renderRecent();
  }

  function renderRecent() {
    const items = JSON.parse(localStorage.getItem("dragon_recent") || "[]");
    qsa('[data-role="recent-list"]').forEach((root) => {
      root.innerHTML = items.length
        ? items
            .map(
              (item) =>
                `<button data-recent="${esc(item)}">${esc(item)}</button>`
            )
            .join("")
        : '<span class="recent-empty">Nothing yet</span>';
    });
  }

  function syncSearchInputs(value) {
    searchInputs.forEach((input) => {
      input.value = value;
    });
  }

  async function search(query, append = false) {
    const q = String(query || "").trim();
    if (!q) return;

    if (!append) {
      activeQuery = q;
      saveRecent(q);
      syncSearchInputs(q);
      titleRoots.forEach((el) => (el.textContent = q));
      countRoots.forEach((el) => (el.textContent = "0"));
      resultsRoots.forEach((root) => {
        root.innerHTML =
          '<div class="searching"><span class="spinner"></span><strong>Searching DRAGON</strong></div>';
      });
      nextPageToken = null;
    }

    const url = new URL("/api/search", location.origin);
    url.searchParams.set("q", q);
    if (append && nextPageToken) {
      url.searchParams.set("pageToken", nextPageToken);
    }

    try {
      const response = await fetch(url);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Search failed");

      const incoming = Array.isArray(data.tracks) ? data.tracks : [];
      tracks = append ? [...tracks, ...incoming] : incoming;
      if (!append) queue = tracks.slice();

      nextPageToken = data.nextPageToken || null;
      renderResults();
      renderQueue();

      loadButtons.forEach((button) => {
        button.hidden = !nextPageToken;
      });
    } catch (error) {
      if (!append) {
        resultsRoots.forEach((root) => {
          root.innerHTML =
            `<div class="search-error"><strong>Search failed</strong><span>${esc(
              error.message
            )}</span></div>`;
        });
      }
      showToast(error.message || "Search failed");
    }
  }

  function renderResults() {
    countRoots.forEach((el) => (el.textContent = String(tracks.length)));

    const desktopRoot = qs(".desktop-results");
    const mobileRoot = qs(".mobile-results");

    if (!tracks.length) {
      if (desktopRoot) {
        desktopRoot.innerHTML =
          '<div class="desktop-empty"><div class="empty-mark">D</div><h4>No results</h4><p>Try a different search.</p></div>';
      }
      if (mobileRoot) {
        mobileRoot.innerHTML =
          '<div class="mobile-empty"><div class="mobile-empty-mark">D</div><strong>No results</strong><span>Try another search.</span></div>';
      }
      return;
    }

    if (desktopRoot) {
      desktopRoot.innerHTML = tracks
        .map((track, index) => {
          const views = fmtViews(track.views);
          return `
            <article class="desktop-track ${selectedIndex === index ? "active" : ""}">
              <button class="desktop-cover" data-play="${index}">
                <img src="${esc(track.thumbnail)}" alt="">
                <span class="desktop-play">▶</span>
              </button>
              <div class="desktop-track-copy">
                <h4>${esc(track.title)}</h4>
                <p>${esc(track.channel)}</p>
                <div>
                  ${views ? `<span>${views} views</span>` : ""}
                  ${track.durationSeconds ? `<span>${fmtTime(track.durationSeconds)}</span>` : ""}
                </div>
              </div>
              <div class="desktop-track-actions">
                <button data-queue="${index}" title="Add to queue">＋</button>
                <button data-youtube="${index}" title="Open on YouTube">↗</button>
              </div>
            </article>
          `;
        })
        .join("");
    }

    if (mobileRoot) {
      mobileRoot.innerHTML = tracks
        .map((track, index) => {
          const views = fmtViews(track.views);
          const meta = [track.channel, views ? views + " views" : ""]
            .filter(Boolean)
            .join(" · ");

          return `
            <article class="mobile-track ${selectedIndex === index ? "active" : ""}" data-play="${index}">
              <div class="mobile-track-image">
                <img src="${esc(track.thumbnail)}" alt="">
                <span>${track.durationSeconds ? fmtTime(track.durationSeconds) : "▶"}</span>
              </div>
              <div class="mobile-track-copy">
                <h3>${esc(track.title)}</h3>
                <p>${esc(meta)}</p>
              </div>
              <button class="mobile-more" data-queue="${index}" aria-label="Add to queue">＋</button>
            </article>
          `;
        })
        .join("");
    }

    requestAnimationFrame(() => {
      qsa(".desktop-track, .mobile-track").forEach((card, i) => {
        card.style.animationDelay = Math.min(i * 24, 360) + "ms";
        card.classList.add("luxury-enter");
      });
    });
  }

  function renderQueue() {
    queueLists.forEach((root) => {
      root.innerHTML = queue.length
        ? queue
            .map(
              (track, index) => `
                <button class="queue-item ${
                  currentVideoId === track.videoId ? "active" : ""
                }" data-queue-play="${index}">
                  <img src="${esc(track.thumbnail)}" alt="">
                  <span>
                    <strong>${esc(track.title)}</strong>
                    <small>${esc(track.channel)}</small>
                  </span>
                  <em>▶</em>
                </button>
              `
            )
            .join("")
        : '<div class="queue-empty">Your queue is empty.</div>';
    });
  }

  function ensurePlayer(videoId) {
    currentVideoId = videoId;

    if (playerReady && player) {
      player.loadVideoById(videoId);
      return;
    }

    const mount = document.createElement("div");
    mount.id = "yt-player";
    qs("#youtubeMount").replaceChildren(mount);

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
      playButtons.forEach((button) => (button.textContent = "❚❚"));
      startProgressLoop();
    } else if (event.data === YT.PlayerState.PAUSED) {
      playButtons.forEach((button) => (button.textContent = "▶"));
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
      const value = total ? Math.round((now / total) * 1000) : 0;

      currentTimeRoots.forEach((el) => (el.textContent = fmtTime(now)));
      durationRoots.forEach((el) => (el.textContent = fmtTime(total)));
      progressRoots.forEach((el) => (el.value = String(value)));
    }, 500);
  }

  function playTrack(index) {
    const track = tracks[index];
    if (!track) return;

    if (track.embeddable === false) {
      showToast("This video cannot play inside DRAGON.");
      window.open(
        "https://www.youtube.com/watch?v=" + encodeURIComponent(track.videoId),
        "_blank",
        "noopener,noreferrer"
      );
      return;
    }

    selectedIndex = index;
    currentVideoId = track.videoId;
    applyAdaptiveAccent(track);

    thumbRoots.forEach((img) => {
      img.src = track.thumbnail || "";
    });
    playerTitleRoots.forEach((el) => (el.textContent = track.title));
    playerChannelRoots.forEach((el) => (el.textContent = track.channel));

    qsa('[data-action="open-youtube"]').forEach((button) => {
      button.disabled = false;
      button.onclick = () =>
        window.open(
          "https://www.youtube.com/watch?v=" + encodeURIComponent(track.videoId),
          "_blank",
          "noopener,noreferrer"
        );
    });

    qs('[data-role="desktop-player"]')?.classList.remove("idle");
    qs('[data-role="mobile-mini-player"]')?.classList.remove("hidden");

    ensurePlayer(track.videoId);
    renderResults();
    renderQueue();
  }

  function playNext() {
    if (!tracks.length) return;
    playTrack(selectedIndex < tracks.length - 1 ? selectedIndex + 1 : 0);
  }

  function playPrev() {
    if (!tracks.length) return;
    playTrack(selectedIndex > 0 ? selectedIndex - 1 : tracks.length - 1);
  }

  function togglePlay() {
    if (!playerReady || !player || !window.YT) return;
    const state = player.getPlayerState();
    if (state === YT.PlayerState.PLAYING) player.pauseVideo();
    else player.playVideo();
  }

  function openQueue() {
    qs('[data-role="queue-sheet"]')?.classList.add("open");
    qs('[data-role="sheet-backdrop"]')?.classList.add("show");
    renderQueue();
  }

  function closeQueue() {
    qs('[data-role="queue-sheet"]')?.classList.remove("open");
    if (!qs('[data-role="mobile-player-sheet"]')?.classList.contains("open")) {
      qs('[data-role="sheet-backdrop"]')?.classList.remove("show");
    }
  }

  function openMobilePlayer() {
    if (selectedIndex < 0) return;
    qs('[data-role="mobile-player-sheet"]')?.classList.add("open");
    qs('[data-role="sheet-backdrop"]')?.classList.add("show");
  }

  function closeMobilePlayer() {
    qs('[data-role="mobile-player-sheet"]')?.classList.remove("open");
    if (!qs('[data-role="queue-sheet"]')?.classList.contains("open")) {
      qs('[data-role="sheet-backdrop"]')?.classList.remove("show");
    }
  }

  window.onYouTubeIframeAPIReady = () => {};

  searchInputs.forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") search(input.value);
    });
  });

  qsa('[data-action="search-button"]').forEach((button) => {
    button.addEventListener("click", () => {
      const scope = button.closest(".mobile-search, .desktop-search");
      const input = scope?.querySelector('[data-role="search-input"]');
      search(input?.value || "");
    });
  });

  qsa("[data-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      qsa("[data-preset]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      search(button.dataset.preset);
    });
  });

  qsa('[data-role="recent-list"]').forEach((root) => {
    root.addEventListener("click", (event) => {
      const button = event.target.closest("[data-recent]");
      if (button) search(button.dataset.recent);
    });
  });

  resultsRoots.forEach((root) => {
    root.addEventListener("click", (event) => {
      const queueButton = event.target.closest("[data-queue]");
      if (queueButton) {
        event.stopPropagation();
        const track = tracks[Number(queueButton.dataset.queue)];
        if (track) {
          queue.push(track);
          renderQueue();
          showToast("Added to queue");
        }
        return;
      }

      const youtubeButton = event.target.closest("[data-youtube]");
      if (youtubeButton) {
        event.stopPropagation();
        const track = tracks[Number(youtubeButton.dataset.youtube)];
        if (track) {
          window.open(
            "https://www.youtube.com/watch?v=" +
              encodeURIComponent(track.videoId),
            "_blank",
            "noopener,noreferrer"
          );
        }
        return;
      }

      const play = event.target.closest("[data-play]");
      if (play) playTrack(Number(play.dataset.play));
    });
  });

  qsa('[data-action="prev"]').forEach((button) =>
    button.addEventListener("click", playPrev)
  );
  qsa('[data-action="next"]').forEach((button) =>
    button.addEventListener("click", playNext)
  );
  playButtons.forEach((button) =>
    button.addEventListener("click", togglePlay)
  );

  progressRoots.forEach((input) => {
    input.addEventListener("input", () => {
      if (!playerReady || !player?.getDuration) return;
      const total = Number(player.getDuration() || 0);
      player.seekTo((Number(input.value) / 1000) * total, true);
    });
  });

  loadButtons.forEach((button) =>
    button.addEventListener("click", () => {
      if (nextPageToken) search(activeQuery, true);
    })
  );

  qsa('[data-action="focus-search"]').forEach((button) =>
    button.addEventListener("click", () => {
      const input = qs(".desktop-search input");
      input?.focus();
      input?.scrollIntoView({ behavior: "smooth", block: "center" });
    })
  );

  qsa('[data-action="open-queue"]').forEach((button) =>
    button.addEventListener("click", openQueue)
  );
  qsa('[data-action="close-queue"]').forEach((button) =>
    button.addEventListener("click", closeQueue)
  );
  qsa('[data-action="open-mobile-player"]').forEach((button) =>
    button.addEventListener("click", openMobilePlayer)
  );
  qsa('[data-action="close-mobile-player"]').forEach((button) =>
    button.addEventListener("click", closeMobilePlayer)
  );

  qsa('[data-role="queue-list"]').forEach((root) => {
    root.addEventListener("click", (event) => {
      const button = event.target.closest("[data-queue-play]");
      if (!button) return;
      const track = queue[Number(button.dataset.queuePlay)];
      const index = tracks.findIndex((item) => item.videoId === track?.videoId);
      if (index >= 0) {
        playTrack(index);
        closeQueue();
      }
    });
  });

  qs('[data-action="search-tab"]')?.addEventListener("click", () => {
    qs(".mobile-search input")?.focus();
    qs(".mobile-search")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  qs('[data-action="home-tab"]')?.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  qs('[data-role="sheet-backdrop"]')?.addEventListener("click", () => {
    closeQueue();
    closeMobilePlayer();
  });

  renderRecent();
})();


(() => {
  if (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    window.matchMedia("(pointer: coarse)").matches
  ) {
    return;
  }

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  document.querySelectorAll("[data-tilt-card]").forEach((card) => {
    card.addEventListener("mousemove", (event) => {
      const rect = card.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width - 0.5;
      const py = (event.clientY - rect.top) / rect.height - 0.5;

      const ry = clamp(px * 7, -4.5, 4.5);
      const rx = clamp(-py * 7, -4.5, 4.5);

      card.style.transform =
        "perspective(1200px) rotateX(" +
        rx +
        "deg) rotateY(" +
        ry +
        "deg) translateZ(0)";
    });

    card.addEventListener("mouseleave", () => {
      card.style.transform = "";
    });
  });

  document.querySelectorAll("[data-tilt-soft]").forEach((card) => {
    card.addEventListener("mousemove", (event) => {
      const rect = card.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width - 0.5;
      const py = (event.clientY - rect.top) / rect.height - 0.5;

      card.style.transform =
        "perspective(1000px) rotateX(" +
        (-py * 2.2) +
        "deg) rotateY(" +
        (px * 2.2) +
        "deg)";
    });

    card.addEventListener("mouseleave", () => {
      card.style.transform = "";
    });
  });

  document.addEventListener("pointermove", (event) => {
    document.documentElement.style.setProperty("--pointer-x", event.clientX + "px");
    document.documentElement.style.setProperty("--pointer-y", event.clientY + "px");
  });
})();


/* Mobile app shell: keep the page fixed horizontally and disable pinch zoom. */
(() => {
  if (!window.matchMedia("(max-width: 760px)").matches) return;

  const stopGesture = (event) => {
    event.preventDefault();
  };

  document.addEventListener("gesturestart", stopGesture, { passive: false });
  document.addEventListener("gesturechange", stopGesture, { passive: false });
  document.addEventListener("gestureend", stopGesture, { passive: false });

  document.addEventListener(
    "touchmove",
    (event) => {
      if (event.touches && event.touches.length > 1) {
        event.preventDefault();
      }
    },
    { passive: false }
  );

  window.addEventListener("orientationchange", () => {
    window.scrollTo({ left: 0, top: window.scrollY });
  });
})();


/* Stronger iPhone/iPad zoom suppression for the app shell. */
(() => {
  if (!window.matchMedia("(max-width: 760px)").matches) return;

  const prevent = (event) => event.preventDefault();

  document.addEventListener("gesturestart", prevent, { passive: false });
  document.addEventListener("gesturechange", prevent, { passive: false });
  document.addEventListener("gestureend", prevent, { passive: false });

  document.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches && event.touches.length > 1) {
        event.preventDefault();
      }
    },
    { passive: false }
  );

  document.addEventListener(
    "touchmove",
    (event) => {
      if (event.touches && event.touches.length > 1) {
        event.preventDefault();
      }
    },
    { passive: false }
  );

  document.addEventListener(
    "dblclick",
    (event) => {
      event.preventDefault();
    },
    { passive: false }
  );

  let lastTouchEnd = 0;
  document.addEventListener(
    "touchend",
    (event) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) {
        event.preventDefault();
      }
      lastTouchEnd = now;
    },
    { passive: false }
  );
})();


/* DRAGON 3D background parallax — desktop only.
   Mobile keeps autonomous motion so the app stays stable under touch. */
(() => {
  const root = document.documentElement;
  const finePointer = window.matchMedia("(hover:hover) and (pointer:fine)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion:reduce)");

  if (!finePointer.matches || reducedMotion.matches) return;

  let targetX = 0;
  let targetY = 0;
  let currentX = 0;
  let currentY = 0;
  let raf = 0;

  const render = () => {
    currentX += (targetX - currentX) * 0.075;
    currentY += (targetY - currentY) * 0.075;

    root.style.setProperty("--bg-parallax-x", (currentX * 18).toFixed(2) + "px");
    root.style.setProperty("--bg-parallax-y", (currentY * 14).toFixed(2) + "px");
    root.style.setProperty("--bg-tilt-x", (-currentY * 1.4).toFixed(2) + "deg");
    root.style.setProperty("--bg-tilt-y", (currentX * 1.8).toFixed(2) + "deg");

    raf = requestAnimationFrame(render);
  };

  window.addEventListener("pointermove", (event) => {
    targetX = event.clientX / window.innerWidth - 0.5;
    targetY = event.clientY / window.innerHeight - 0.5;
  }, { passive: true });

  window.addEventListener("blur", () => {
    targetX = 0;
    targetY = 0;
  });

  raf = requestAnimationFrame(render);

  window.addEventListener("pagehide", () => {
    if (raf) cancelAnimationFrame(raf);
  }, { once: true });
})();


/* DRAGON Signature cinematic parallax.
   Desktop follows the pointer very subtly; mobile uses autonomous animation only. */
(() => {
  const root = document.documentElement;
  const finePointer = window.matchMedia("(hover:hover) and (pointer:fine)");
  const reduced = window.matchMedia("(prefers-reduced-motion:reduce)");

  if (!finePointer.matches || reduced.matches) return;

  let targetX = 0;
  let targetY = 0;
  let x = 0;
  let y = 0;
  let frame = 0;

  const tick = () => {
    x += (targetX - x) * 0.055;
    y += (targetY - y) * 0.055;

    root.style.setProperty("--lux-x", (x * 20).toFixed(2) + "px");
    root.style.setProperty("--lux-y", (y * 14).toFixed(2) + "px");
    root.style.setProperty("--lux-tilt-x", (-y * 1.05).toFixed(2) + "deg");
    root.style.setProperty("--lux-tilt-y", (x * 1.35).toFixed(2) + "deg");

    frame = requestAnimationFrame(tick);
  };

  window.addEventListener("pointermove", (event) => {
    targetX = event.clientX / window.innerWidth - 0.5;
    targetY = event.clientY / window.innerHeight - 0.5;
  }, { passive:true });

  window.addEventListener("blur", () => {
    targetX = 0;
    targetY = 0;
  });

  frame = requestAnimationFrame(tick);

  window.addEventListener("pagehide", () => {
    if (frame) cancelAnimationFrame(frame);
  }, { once:true });
})();
