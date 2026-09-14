(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const token = $("token");
  const channel = $("channel");
  const connectBtn = $("connectBtn");
  const addBtn = $("addBtn");
  const msg = $("msg");
  const list = $("list");

  token.value = sessionStorage.getItem("dragon_admin_token") || "";

  function headers() {
    return {
      "authorization": "Bearer " + token.value.trim(),
      "content-type": "application/json"
    };
  }

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function setMessage(text) {
    msg.textContent = text;
  }

  async function load() {
    const t = token.value.trim();
    if (!t) {
      setMessage("Enter your admin token.");
      return;
    }
    sessionStorage.setItem("dragon_admin_token", t);
    setMessage("Loading channels...");
    const response = await fetch("/api/admin/channels", { headers: headers() });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) {
      list.innerHTML = '<div class="empty">ACCESS DENIED</div>';
      setMessage(data.error || "Could not load channels.");
      return;
    }
    render(data.channels || [], data.legacyChannelIds || []);
    setMessage("Connected.");
  }

  function render(channels, legacy) {
    if (!channels.length && !legacy.length) {
      list.innerHTML = '<div class="empty">NO AUTHORIZED CHANNELS YET</div>';
      return;
    }

    const managed = channels.map((c) => {
      const image = c.thumbnail
        ? '<img src="' + esc(c.thumbnail) + '" alt="">'
        : '<div style="width:56px;height:56px;border-radius:50%;background:#151515"></div>';
      return (
        '<div class="item">' +
          image +
          '<div><div class="name">' + esc(c.title || c.id) + '</div>' +
          '<div class="meta">' + esc(c.handle || "") + (c.handle ? " · " : "") + esc(c.id) + '</div></div>' +
          '<button class="secondary" data-remove="' + esc(c.id) + '">REMOVE</button>' +
        '</div>'
      );
    }).join("");

    const legacyHtml = legacy.map((id) =>
      '<div class="item">' +
        '<div style="width:56px;height:56px;border-radius:50%;background:#151515"></div>' +
        '<div><div class="name">Cloudflare variable channel</div><div class="meta">' + esc(id) + '</div></div>' +
        '<button class="secondary" disabled>LEGACY</button>' +
      '</div>'
    ).join("");

    list.innerHTML = managed + legacyHtml;
  }

  async function add() {
    const value = channel.value.trim();
    if (!token.value.trim()) {
      setMessage("Enter your admin token first.");
      return;
    }
    if (!value) {
      setMessage("Enter a YouTube channel.");
      return;
    }

    addBtn.disabled = true;
    setMessage("Resolving YouTube channel...");

    try {
      const response = await fetch("/api/admin/channels", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ channel: value })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not add channel.");
      channel.value = "";
      setMessage("Channel added.");
      await load();
    } catch (error) {
      setMessage(error.message || "Could not add channel.");
    } finally {
      addBtn.disabled = false;
    }
  }

  async function removeChannel(id) {
    if (!confirm("Remove this authorized channel?")) return;
    setMessage("Removing channel...");
    const response = await fetch("/api/admin/channels/" + encodeURIComponent(id), {
      method: "DELETE",
      headers: headers()
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) {
      setMessage(data.error || "Could not remove channel.");
      return;
    }
    setMessage("Channel removed.");
    await load();
  }

  connectBtn.addEventListener("click", load);
  addBtn.addEventListener("click", add);

  token.addEventListener("keydown", (e) => {
    if (e.key === "Enter") load();
  });

  channel.addEventListener("keydown", (e) => {
    if (e.key === "Enter") add();
  });

  list.addEventListener("click", (e) => {
    const button = e.target.closest("[data-remove]");
    if (button) removeChannel(button.dataset.remove);
  });

  if (token.value.trim()) load();
})();
