(() => {
  const bridge = window.webkit?.messageHandlers?.dragonAudio;

  window.DRAGON_NATIVE_AUDIO = {
    available: Boolean(bridge),

    play({ url, title = "DRAGON", artist = "", artwork = "" }) {
      if (!bridge) return false;
      bridge.postMessage({
        action: "play",
        url,
        title,
        artist,
        artwork
      });
      return true;
    },

    pause() {
      bridge?.postMessage({ action: "pause" });
    },

    resume() {
      bridge?.postMessage({ action: "resume" });
    },

    stop() {
      bridge?.postMessage({ action: "stop" });
    }
  };
})();
