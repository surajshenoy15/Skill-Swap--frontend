// ---------------- State ----------------
let token = localStorage.getItem("skillswap_token") || null;
let me = null;
let users = [];
let activeUser = null;
let ws = null;
let reconnectTimer = null;

// ---------------- Config ----------------
// Do NOT declare const API_BASE here again.
// This avoids: Identifier 'API_BASE' has already been declared
const BACKEND_API_BASE =
  typeof API_BASE !== "undefined"
    ? API_BASE.replace(/\/$/, "")
    : "https://skill-swap-backend-cnqr.onrender.com";

const BACKEND_WS_BASE =
  typeof WS_BASE !== "undefined"
    ? WS_BASE.replace(/\/$/, "")
    : "wss://skill-swap-backend-cnqr.onrender.com";

const ICONS = {
  offer: `<svg viewBox="0 0 24 24" fill="none"><path d="M12 2v20M2 12h20" stroke="currentColor" stroke-width="2" stroke-linecap="round" transform="rotate(45 12 12)"/></svg>`,
  want: `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
};

// ---------------- Helpers ----------------
function $(id) {
  return document.getElementById(id);
}

function initials(name) {
  if (!name) return "?";

  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function fmtTime(iso) {
  if (!iso) return "";

  const d = new Date(iso + (iso.endsWith("Z") ? "" : "Z"));

  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s || "";
  return div.innerHTML;
}

async function api(path, options = {}) {
  const headers = {
    ...(options.headers || {}),
    "Content-Type": "application/json",
  };

  if (token) {
    headers["Authorization"] = "Bearer " + token;
  }

  const res = await fetch(BACKEND_API_BASE + path, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.detail || data.message || "Request failed");
  }

  return data;
}

// ---------------- Auth screen ----------------
document.querySelectorAll(".auth-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".auth-tab").forEach((t) => {
      t.classList.remove("active");
    });

    document.querySelectorAll(".auth-form").forEach((f) => {
      f.classList.remove("active");
    });

    tab.classList.add("active");

    const form = $(tab.dataset.tab + "-form");
    if (form) {
      form.classList.add("active");
    }
  });
});

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  $("login-error").textContent = "";

  try {
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        email: $("login-email").value.trim(),
        password: $("login-password").value,
      }),
    });

    onAuthed(data);
  } catch (err) {
    $("login-error").textContent = err.message;
  }
});

$("register-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  $("register-error").textContent = "";

  try {
    const data = await api("/api/register", {
      method: "POST",
      body: JSON.stringify({
        name: $("reg-name").value.trim(),
        email: $("reg-email").value.trim(),
        password: $("reg-password").value,
        skill_offered: $("reg-offered").value.trim(),
        skill_wanted: $("reg-wanted").value.trim(),
        bio: $("reg-bio").value.trim(),
      }),
    });

    onAuthed(data);
  } catch (err) {
    $("register-error").textContent = err.message;
  }
});

function onAuthed(data) {
  token = data.token;
  me = data.user || data;

  localStorage.setItem("skillswap_token", token);

  showApp();
}

$("logout-btn").addEventListener("click", () => {
  localStorage.removeItem("skillswap_token");

  token = null;
  me = null;
  users = [];
  activeUser = null;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (ws) {
    ws.close();
    ws = null;
  }

  $("app-screen").style.display = "none";
  $("auth-screen").style.display = "flex";
});

// ---------------- App screen ----------------
async function showApp() {
  $("auth-screen").style.display = "none";
  $("app-screen").style.display = "flex";

  renderMeCard();

  await loadUsers();

  connectWS();
}

function renderMeCard() {
  if (!me) return;

  $("me-card").innerHTML = `
    <div class="me-name">${escapeHtml(me.name)}</div>
    <div class="me-skills">
      <div class="me-skill-row">
        ${ICONS.offer} Offers <b>${escapeHtml(me.skill_offered)}</b>
      </div>
      <div class="me-skill-row">
        ${ICONS.want} Wants <b>${escapeHtml(me.skill_wanted)}</b>
      </div>
    </div>
  `;
}

async function loadUsers() {
  const data = await api("/api/users");

  users = Array.isArray(data) ? data : data.users || [];

  renderUserList();
}

function renderUserList(flashId = null) {
  $("member-count").textContent = users.length;

  const list = $("user-list");

  if (users.length === 0) {
    list.innerHTML = `
      <div class="messages-empty" style="color:rgba(247,244,238,0.4); padding:20px 10px;">
        No other members yet.
      </div>
    `;
    return;
  }

  list.innerHTML = users
    .map(
      (u) => `
      <div 
        class="user-item ${
          activeUser && activeUser.id === u.id ? "selected" : ""
        } ${flashId === u.id ? "new-flash" : ""}"
        data-id="${u.id}" 
        tabindex="0"
      >
        <div class="avatar">${initials(u.name)}</div>
        <div class="user-item-text">
          <div class="user-item-name">${escapeHtml(u.name)}</div>
          <div class="user-item-skill">Offers ${escapeHtml(u.skill_offered)}</div>
        </div>
      </div>
    `
    )
    .join("");

  list.querySelectorAll(".user-item").forEach((el) => {
    el.addEventListener("click", () => {
      openChat(parseInt(el.dataset.id));
    });

    el.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        openChat(parseInt(el.dataset.id));
      }
    });
  });
}

// ---------------- Chat ----------------
async function openChat(userId) {
  activeUser = users.find((u) => u.id === userId);

  if (!activeUser) return;

  renderUserList();

  $("chat-empty").style.display = "none";
  $("chat-active").style.display = "flex";

  $("partner-avatar").textContent = initials(activeUser.name);
  $("partner-name").textContent = activeUser.name;

  $("partner-skills").innerHTML = `
    <span class="skill-pill offer">
      ${ICONS.offer} ${escapeHtml(activeUser.skill_offered)}
    </span>
    <span class="skill-pill want">
      ${ICONS.want} ${escapeHtml(activeUser.skill_wanted)}
    </span>
  `;

  const data = await api(`/api/messages/${userId}`);

  const msgs = Array.isArray(data) ? data : data.messages || [];

  renderMessages(msgs);
}

function renderMessages(msgs) {
  const box = $("messages");

  if (!Array.isArray(msgs) || msgs.length === 0) {
    box.innerHTML = `
      <div class="messages-empty">
        No messages yet. Say hello and propose a trade.
      </div>
    `;
    return;
  }

  box.innerHTML = msgs
    .map(
      (m) => `
      <div class="msg-row ${m.sender_id === me.id ? "mine" : "theirs"}">
        <div class="bubble">
          ${escapeHtml(m.content)}
          <span class="bubble-time">${fmtTime(m.created_at)}</span>
        </div>
      </div>
    `
    )
    .join("");

  box.scrollTop = box.scrollHeight;
}

function appendMessage(m) {
  const box = $("messages");

  const empty = box.querySelector(".messages-empty");

  if (empty) {
    empty.remove();
  }

  const row = document.createElement("div");

  row.className = "msg-row " + (m.sender_id === me.id ? "mine" : "theirs");

  row.innerHTML = `
    <div class="bubble">
      ${escapeHtml(m.content)}
      <span class="bubble-time">${fmtTime(m.created_at)}</span>
    </div>
  `;

  box.appendChild(row);

  box.scrollTop = box.scrollHeight;
}

$("message-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const input = $("message-input");
  const content = input.value.trim();

  if (!content || !activeUser) return;

  input.value = "";

  try {
    await api("/api/messages", {
      method: "POST",
      body: JSON.stringify({
        receiver_id: activeUser.id,
        content,
      }),
    });
  } catch (err) {
    alert(err.message);
  }
});

// ---------------- WebSocket ----------------
function connectWS() {
  if (!token) return;

  if (ws) {
    ws.close();
  }

  ws = new WebSocket(`${BACKEND_WS_BASE}/ws/${token}`);

  ws.onopen = () => {
    setConnStatus(true);
  };

  ws.onclose = () => {
    setConnStatus(false);

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }

    reconnectTimer = setTimeout(() => {
      if (token) {
        connectWS();
      }
    }, 2000);
  };

  ws.onerror = () => {
    setConnStatus(false);
  };

  ws.onmessage = (evt) => {
    const payload = JSON.parse(evt.data);

    if (payload.type === "user_joined") {
      const u = payload.user;

      if (!me || u.id === me.id) return;

      if (!users.find((x) => x.id === u.id)) {
        users.push(u);
        renderUserList(u.id);
      }

      return;
    }

    if (payload.type === "message") {
      const m = payload.message;

      const otherId = m.sender_id === me.id ? m.receiver_id : m.sender_id;

      if (activeUser && activeUser.id === otherId) {
        appendMessage(m);
      }
    }
  };
}

function setConnStatus(online) {
  const el = $("conn-status");

  if (!el) return;

  el.classList.toggle("offline", !online);

  el.innerHTML = `
    <span class="conn-dot"></span> 
    ${online ? "Live" : "Reconnecting…"}
  `;
}

// ---------------- Boot ----------------
(async function boot() {
  if (token) {
    try {
      const data = await api("/api/me");

      me = data.user || data;

      showApp();

      return;
    } catch (err) {
      console.log("Auto login failed:", err.message);

      localStorage.removeItem("skillswap_token");

      token = null;
    }
  }

  $("auth-screen").style.display = "flex";
})();