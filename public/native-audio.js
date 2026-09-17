(() => {
  const bridge = window.webkit?.messageHandlers?.dragonAudio;

  const send = (payload) => {
    if (!bridge) return false;
    bridge.postMessage(payload);
    return true;
  };

  window.DRAGON_NATIVE_AUDIO = {
    available: Boolean(bridge),

    play({ url, title = "DRAGON", artist = "", artwork = "" }) {
      return send({ action: "play", url, title, artist, artwork });
    },

    pause() {
      return send({ action: "pause" });
    },

    resume() {
      return send({ action: "resume" });
    },

    stop() {
      return send({ action: "stop" });
    },

    download({ url, kind = "audio", title = "", artist = "", artwork = "" }) {
      return send({ action: "download", url, kind, title, artist, artwork });
    },

    openConverter({ youtubeUrl, title = "", artist = "", artwork = "" }) {
      return send({ action: "openConverter", youtubeUrl, title, artist, artwork });
    },

    importMedia({ title = "", artist = "", artwork = "" } = {}) {
      return send({ action: "importMedia", title, artist, artwork });
    },

    library() {
      return send({ action: "library" });
    },

    playOffline(id) {
      return send({ action: "playOffline", id });
    },

    deleteOffline(id) {
      return send({ action: "deleteOffline", id });
    }
  };
})();
