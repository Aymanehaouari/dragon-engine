(() => {
  "use strict";

  const native = window.DRAGON_NATIVE_AUDIO;
  const toast = document.querySelector("#toast");
  const PENDING_KEY = "dragon_pending_import";

  const notify = (message, duration = 3000) => {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(notify._timer);
    notify._timer = setTimeout(() => toast.classList.remove("show"), duration);
  };

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const videoIdFromImage = (src) => {
    const value = String(src || "");
    const match = value.match(/\/vi(?:_webp)?\/([^/?]+)\//i);
    return match?.[1] || "";
  };

  const metadataFromCard = (card) => {
    const image = card.querySelector("img");
    const title = card.querySelector("h3, h4")?.textContent?.trim() || "YouTube media";
    const meta = card.querySelector(".mobile-track-copy p, .desktop-track-copy p")?.textContent?.trim() || "";
    const artist = meta.split(" · ")[0] || "";
    const videoId = videoIdFromImage(image?.src);

    return {
      videoId,
      youtubeUrl: videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` : "",
      title,
      artist,
      artwork: image?.src || ""
    };
  };

  const savePending = (meta) => {
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify(meta));
    } catch {}
  };

  const loadPending = () => {
    try {
      return JSON.parse(localStorage.getItem(PENDING_KEY) || "{}") || {};
    } catch {
      return {};
    }
  };

  const startYouTubeHandoff = (card) => {
    if (!native?.available) {
      notify("Open DRAGON on iPhone to use offline import.");
      return;
    }

    const meta = metadataFromCard(card);
    if (!meta.youtubeUrl) {
      notify("DRAGON could not identify this YouTube video.");
      return;
    }

    savePending(meta);

    const started = native.openConverter({
      youtubeUrl: meta.youtubeUrl,
      title: meta.title,
      artist: meta.artist,
      artwork: meta.artwork
    });

    if (!started) {
      notify("The DRAGON iPhone bridge is unavailable.");
    }
  };

  const decorateResults = () => {
    document.querySelectorAll(".mobile-track").forEach((card) => {
      if (card.querySelector("[data-action='youtube-save-offline']")) return;

      const copy = card.querySelector(".mobile-track-copy");
      if (!copy) return;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "youtube-save-offline";
      button.dataset.action = "youtube-save-offline";
      button.innerHTML = "<span>↓</span> SAVE OFFLINE";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        startYouTubeHandoff(card);
      });
      copy.appendChild(button);
    });

    document.querySelectorAll(".desktop-track").forEach((card) => {
      if (card.querySelector("[data-action='youtube-save-offline']")) return;
      const actions = card.querySelector(".desktop-track-actions");
      if (!actions) return;

      const button = document.createElement("button");
      button.type = "button";
      button.dataset.action = "youtube-save-offline";
      button.title = "Save offline";
      button.textContent = "↓";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        startYouTubeHandoff(card);
      });
      actions.prepend(button);
    });
  };

  const installImportUI = () => {
    const card = document.querySelector(".mobile-omniget-card");
    if (!card || card.querySelector("[data-action='import-downloaded-media']")) return;

    const divider = document.createElement("div");
    divider.className = "youtube-offline-divider";
    divider.innerHTML = `
      <span>YOUTUBE → DRAGON</span>
      <p>Choose a YouTube result and tap <b>Save Offline</b>. DRAGON copies the video link and opens the converter. After downloading the file, return here and import it into your private offline library.</p>
    `;

    const importButton = document.createElement("button");
    importButton.type = "button";
    importButton.className = "youtube-import-button";
    importButton.dataset.action = "import-downloaded-media";
    importButton.innerHTML = "<span>＋</span> IMPORT DOWNLOADED FILE";
    importButton.addEventListener("click", () => {
      if (!native?.available) {
        notify("Open DRAGON on iPhone to import files.");
        return;
      }

      const pending = loadPending();
      const started = native.importMedia({
        title: pending.title || "",
        artist: pending.artist || "",
        artwork: pending.artwork || ""
      });

      if (!started) notify("The DRAGON iPhone importer is unavailable.");
    });

    card.append(divider, importButton);
  };

  const installStyles = () => {
    if (document.querySelector("#dragon-youtube-offline-style")) return;

    const style = document.createElement("style");
    style.id = "dragon-youtube-offline-style";
    style.textContent = `
      .youtube-save-offline{
        width:max-content;
        max-width:100%;
        min-height:28px;
        margin-top:8px;
        padding:0 9px;
        border:1px solid rgba(216,183,106,.18);
        border-radius:9px;
        color:#d9c081;
        background:rgba(216,183,106,.055);
        font-size:7px;
        font-weight:950;
        letter-spacing:.08em;
      }
      .youtube-save-offline span{margin-right:5px;font-size:10px}
      .youtube-save-offline:active{transform:scale(.96)}

      .youtube-offline-divider{
        margin-top:18px;
        padding-top:16px;
        border-top:1px solid rgba(255,255,255,.07);
      }
      .youtube-offline-divider>span{
        color:#d9c081;
        font-size:7px;
        font-weight:950;
        letter-spacing:.15em;
      }
      .youtube-offline-divider p{
        margin:7px 0 0;
        color:#777982;
        font-size:9px;
        line-height:1.55;
      }
      .youtube-offline-divider b{color:#b7b9c0}
      .youtube-import-button{
        width:100%;
        min-height:46px;
        margin-top:12px;
        border:1px solid rgba(216,183,106,.20);
        border-radius:14px;
        color:#151008;
        background:linear-gradient(135deg,#fff4d5,#dfbd69);
        box-shadow:0 12px 30px rgba(216,183,106,.10);
        font-size:8px;
        font-weight:1000;
        letter-spacing:.10em;
      }
      .youtube-import-button span{margin-right:6px;font-size:13px}
      .youtube-import-button:active{transform:scale(.985)}
    `;
    document.head.appendChild(style);
  };

  const refresh = () => {
    installStyles();
    installImportUI();
    decorateResults();
  };

  const observer = new MutationObserver(refresh);
  observer.observe(document.body, { childList: true, subtree: true });
  refresh();

  window.addEventListener("dragon:converter-opened", () => {
    notify("YouTube link copied. Paste it on ytmp3.nz, download the file, then return to DRAGON.", 5000);
  });

  window.addEventListener("dragon:download-complete", (event) => {
    if (!event.detail?.imported) return;
    try { localStorage.removeItem(PENDING_KEY); } catch {}
    notify(`${event.detail?.title || "Media"} imported into DRAGON Offline.`, 3500);
    setTimeout(() => {
      document.querySelector('[data-action="open-library"]')?.click();
    }, 450);
  });
})();
