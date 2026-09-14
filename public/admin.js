(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const token = $("token");
  const video = $("video");
  const format = $("format");
  const file = $("file");
  const connectBtn = $("connectBtn");
  const uploadBtn = $("uploadBtn");
  const msg = $("msg");
  const list = $("list");

  token.value = sessionStorage.getItem("dragon_admin_token") || "";

  function authHeaders(extra) {
    return Object.assign({
      "authorization": "Bearer " + token.value.trim()
    }, extra || {});
  }

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function bytes(value) {
    const n = Number(value || 0);
    if (!n) return "size unknown";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / 1024 / 1024).toFixed(1) + " MB";
  }

  function setMessage(text) {
    msg.textContent = text;
  }

  async function load() {
    if (!token.value.trim()) {
      setMessage("Enter your admin token.");
      return;
    }

    sessionStorage.setItem("dragon_admin_token", token.value.trim());
    setMessage("Loading media library...");

    const response = await fetch("/api/admin/media", {
      headers: authHeaders()
    });

    let data = {};
    try { data = await response.json(); } catch {}

    if (!response.ok) {
      list.innerHTML = '<div class="empty">ACCESS DENIED</div>';
      setMessage(data.error || "Could not load library.");
      return;
    }

    render(data.items || []);
    setMessage("Connected.");
  }

  function render(items) {
    if (!items.length) {
      list.innerHTML = '<div class="empty">NO MEDIA MAPPED YET</div>';
      return;
    }

    list.innerHTML = items.map((item) => {
      const buttons = ["mp3","mp4"].map((fmt) => {
        const record = item.formats && item.formats[fmt];
        if (!record) return "";
        return (
          '<div class="pill">' +
            fmt.toUpperCase() + " · " + esc(bytes(record.size)) +
            ' <button class="secondary" style="height:30px;margin-left:8px" data-delete="' +
            esc(item.videoId) + '" data-format="' + fmt + '">DELETE</button>' +
          '</div>'
        );
      }).join("");

      return (
        '<div class="item">' +
          '<div><div class="name">' + esc(item.videoId) + '</div>' +
          '<div class="meta">https://www.youtube.com/watch?v=' + esc(item.videoId) + '</div></div>' +
          '<div class="formats">' + buttons + '</div>' +
        '</div>'
      );
    }).join("");
  }

  async function upload() {
    const selected = file.files && file.files[0];

    if (!token.value.trim()) {
      setMessage("Enter your admin token first.");
      return;
    }

    if (!video.value.trim()) {
      setMessage("Enter a YouTube video URL or ID.");
      return;
    }

    if (!selected) {
      setMessage("Choose an MP3 or MP4 file.");
      return;
    }

    const wanted = format.value;
    const extension = "." + wanted;

    if (!selected.name.toLowerCase().endsWith(extension)) {
      setMessage("The selected file must be " + extension.toUpperCase() + ".");
      return;
    }

    uploadBtn.disabled = true;
    setMessage("Uploading " + selected.name + " to R2...");

    try {
      const target =
        "/api/admin/media/upload?videoId=" +
        encodeURIComponent(video.value.trim()) +
        "&format=" +
        encodeURIComponent(wanted);

      const response = await fetch(target, {
        method: "POST",
        headers: authHeaders({
          "content-type": selected.type || (wanted === "mp3" ? "audio/mpeg" : "video/mp4"),
          "x-file-name": encodeURIComponent(selected.name)
        }),
        body: selected
      });

      let data = {};
      try { data = await response.json(); } catch {}

      if (!response.ok) {
        throw new Error(data.error || "Upload failed.");
      }

      file.value = "";
      setMessage("Upload complete.");
      await load();
    } catch (error) {
      setMessage(error.message || "Upload failed.");
    } finally {
      uploadBtn.disabled = false;
    }
  }

  async function remove(videoId, fmt) {
    if (!confirm("Delete the " + fmt.toUpperCase() + " file from DRAGON storage?")) {
      return;
    }

    setMessage("Deleting " + fmt.toUpperCase() + "...");

    const response = await fetch(
      "/api/admin/media/" +
      encodeURIComponent(videoId) +
      "/" +
      encodeURIComponent(fmt),
      {
        method: "DELETE",
        headers: authHeaders()
      }
    );

    let data = {};
    try { data = await response.json(); } catch {}

    if (!response.ok) {
      setMessage(data.error || "Delete failed.");
      return;
    }

    setMessage("Deleted.");
    await load();
  }

  connectBtn.addEventListener("click", load);
  uploadBtn.addEventListener("click", upload);

  token.addEventListener("keydown", (e) => {
    if (e.key === "Enter") load();
  });

  list.addEventListener("click", (e) => {
    const button = e.target.closest("[data-delete]");
    if (button) remove(button.dataset.delete, button.dataset.format);
  });

  if (token.value.trim()) load();
})();
