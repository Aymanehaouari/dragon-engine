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

    download({ url, title = "Saved track", artist = "", artwork = "" }) {
      return send({ action: "download", url, title, artist, artwork });
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
