const $ = id => document.getElementById(id);

let state = {
  user: null,
  rooms: [],
  currentRoom: null,
  replyTo: null,

  // Private-message quote
 dmReplyTo: null,
dmReplyUser: null,
dmReplyAuthor: null,
dmReplyText: null,

  socket: null,
  view: "rooms",
  featurePermissions: {}
};

const rankIcon = {
  MEMBER: "⚡",
  VIP: "💎",
  PREMIUM: "🏅",
  MOD: "🛡️",
  ADMIN: "⭐",
  SUPER_ADMIN: "🌟",
  COMMISSOR: "👻",
  COOWNER: "🦉",
  OWNER: "👑"
};

const rankOrder = {
  MEMBER: 0,
  VIP: 1,
  PREMIUM: 2,
  MOD: 3,
  ADMIN: 4,
  SUPER_ADMIN: 5,
  COMMISSOR: 6,
  COOWNER: 7,
  OWNER: 8
};

const esc = s =>
  String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c]));

const fmt = t => {
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
};

const rank = r =>
  `<span class="rank">${rankIcon[r] || "⚡"} ${esc(r)}</span>`;

async function api(url, opt = {}) {
  const headers = { ...(opt.headers || {}) };

  if (!(opt.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, {
    ...opt,
    headers,
    credentials: "same-origin"
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw Error(body.error || "Request failed");
  }

  return body;
}

function toast(text) {
  $("toast").textContent = text;
  $("toast").style.display = "block";

  clearTimeout(toast.timer);

  toast.timer = setTimeout(() => {
    $("toast").style.display = "none";
  }, 2800);
}

function closeModal() {
  $("modal").classList.add("hidden");
}

function modal(html) {
  $("modalBody").innerHTML = html;
  $("modal").classList.remove("hidden");
}

function avatar(u, cls = "avatar") {
  const name = u?.displayName || u?.username || "?";

  return `
    <div class="${cls}">
      ${
        u?.avatar
          ? `<img src="${esc(u.avatar)}" alt="">`
          : esc(name.slice(0, 1).toUpperCase())
      }
    </div>
  `;
}

function can(requiredRank) {
  if (!state.user) return false;
  return (rankOrder[state.user.rank] ?? -1) >= (rankOrder[requiredRank] ?? 999);
}
function canFeature(key){
  if(!state.user) return false;
  if(state.user.username==='Maleficent'&&state.user.rank==='OWNER') return true;
  const required=state.featurePermissions?.[key];
  return required ? can(required) : false;
}

/* ---------------- AUTH ---------------- */

function setAuthMode(login) {
  $("tabLogin").classList.toggle("active", login);
  $("tabRegister").classList.toggle("active", !login);

  document
    .querySelectorAll(".register-only")
    .forEach(el => el.classList.toggle("hidden", login));

  if ($("confirmPassword")) $("confirmPassword").classList.toggle("hidden", login);
  if ($("passwordStrength")) $("passwordStrength").classList.toggle("hidden", login);

  $("authSubmit").textContent = login ? "Login" : "Register";
  $("authMsg").textContent = "";
}

$("tabLogin").onclick = () => setAuthMode(true);
$("tabRegister").onclick = () => setAuthMode(false);

if ($("password")) $("password").addEventListener("input",()=>{
  if ($("tabRegister").classList.contains("active")) {
    const p=$("password").value; let score=0;
    if(p.length>=8)score++; if(/[A-Z]/.test(p))score++; if(/[0-9]/.test(p))score++; if(/[^A-Za-z0-9]/.test(p))score++;
    $("passwordStrength").textContent="Password strength: "+(["Weak","Fair","Good","Strong","Very strong"][score]);
  }
});

$("authForm").onsubmit = async e => {
  e.preventDefault();

  try {
    const login =
      $("tabLogin").classList.contains("active");

    const result = await api(
      login ? "/api/login" : "/api/register",
      {
        method: "POST",
        body: JSON.stringify({
          username: $("username").value.trim(),
          displayName: $("displayName").value.trim(),
          password: $("password").value,
          confirmPassword: $("confirmPassword")?.value
        })
      }
    );

       state.user = result.user;
    const boot = await api("/api/bootstrap");
    state.featurePermissions = boot.featurePermissions || {};

    await start();
  } catch (error) {
    $("authMsg").textContent = error.message;
  }
};

$("logout").onclick = async () => {
  try {
    await api("/api/logout", {
      method: "POST"
    });
  } finally {
    location.reload();
  }
};

/* ---------------- START ---------------- */

/* ---------------- START ---------------- */

async function start() {
  $("auth").classList.add("hidden");
  $("app").classList.remove("hidden");

  updateNav();
  applyTheme(state.user?.theme||'obsidian');

  if (state.socket) {
    try {
      state.socket.disconnect();
    } catch {}
  }

  state.socket = io();

  state.socket.on("connect", () => {
    if (state.user) {
      state.socket.emit("auth", state.user.id);
    }

    if (state.currentRoom) {
      state.socket.emit("join-room", state.currentRoom);
    }
  });

  state.socket.on("presence", async () => {
    if (state.view === "rooms") {
      try { await loadRooms(); } catch {}
      renderRooms();
      renderOnline();
    }
  });

  state.socket.on("message", message => {
    if (message.roomId === state.currentRoom) {
      appendMessage(message);
    }
  });

  state.socket.on("message:update", message => {
    const element =
      document.querySelector(`[data-mid="${message.id}"]`);

    if (element) {
      element.outerHTML = messageHTML(message);
    }
  });

  state.socket.on("message:delete", data => {
    const element =
      document.querySelector(`[data-mid="${data.id}"]`);

    if (element) {
      element.remove();
    }
  });

  state.socket.on("room:clear", () => {
    if (state.currentRoom) {
      $("messages").innerHTML = "";
      toast("Room cleared by staff.");
    }
  });

  state.socket.on("typing", data => {
    $("typing").textContent =
      data.typing
        ? `${esc(data.user)} is typing…`
        : "";
  });

  state.socket.on("notification", () => {
    loadNotifications();
  });

  state.socket.on("dm", message => {
    if (
      state.dmUserId &&
      message &&
      (message.from === state.dmUserId || message.to === state.dmUserId)
    ) {
      openDM(state.dmUserId);
    } else {
      toast("New private message");
    }
  });

  await loadRooms();
  await renderView();
  await loadNotifications();
}

async function bootstrap() {
  try {
    const data = await api("/api/bootstrap");

    if (data.user) {
      state.user = data.user;
      state.featurePermissions = data.featurePermissions || {};
      await start();
    }
  } catch {
    /* Not logged in */
  }
}

/* ---------------- NAVIGATION ---------------- */

function updateNav() {
  if (!state.user) return;

  $("meMini").innerHTML = `
    ${avatar(state.user)}
    <div class="me-mini-copy"><b>${esc(state.user.displayName)}</b><small>${rank(state.user.rank)} · Lv ${state.user.level || 1}</small></div>
  `;

  if ($("topProfile")) {
    $("topProfile").innerHTML = avatar(state.user, "top-avatar");
  }

  document
    .querySelectorAll(".staff-only")
    .forEach(el =>
      el.classList.toggle("hidden", !can("MOD"))
    );

  document
    .querySelectorAll(".owner-only")
    .forEach(el =>
      el.classList.toggle(
        "hidden",
        !(
          state.user.rank === "OWNER" &&
          state.user.username === "Maleficent"
        )
      )
    );

  document
    .querySelectorAll(".admin-only")
    .forEach(el =>
      el.classList.toggle("hidden", !can("ADMIN"))
    );

  document
    .querySelectorAll(".coowner-only")
    .forEach(el =>
      el.classList.toggle("hidden", !canFeature("create_room"))
    );
}

document
  .querySelectorAll(".nav[data-view]")
  .forEach(button => {
    button.onclick = async () => {
      state.view = button.dataset.view;

      document
        .querySelectorAll(".nav[data-view]")
        .forEach(x =>
          x.classList.toggle(
            "active",
            x.dataset.view === state.view
          )
        );

      await renderView();

      $("sidebar").classList.remove("open");
    };
  });

async function renderView() {
  document
    .querySelectorAll(".view")
    .forEach(v => v.classList.add("hidden"));

  const id =
    `view${state.view[0].toUpperCase()}${state.view.slice(1)}`;

  const view = $(id);

  if (!view) return;

  view.classList.remove("hidden");

  switch (state.view) {
    case "rooms":
      return renderRooms();

    case "users":
      return loadUsers();

    case "friends":
      return loadFriends();

    case "dms":
      return loadDMList();

    case "news":
      return loadNews();

    case "leaderboard":
      return loadLeaderboard();

    case "saved":
      return loadSavedMessages();

    case "search":
      return loadSearchRooms();

    case "profile":
      return loadProfile(state.user);

    case "staff":
      return loadStaff();

    case "owner":
      return loadOwner();
  }
}

$("mobileMenu").onclick = () => {
  $("sidebar").classList.toggle("open");
};

if ($("backRooms")) {
  $("backRooms").onclick = () => {
    $("viewRooms").classList.remove("chatting");
    $("chatWrap").classList.add("hidden");
    renderRooms();
  };
}

if ($("topMessages")) $("topMessages").onclick = () => {
  state.view = "dms";
  document.querySelectorAll(".nav[data-view]").forEach(x => x.classList.toggle("active", x.dataset.view === "dms"));
  renderView();
};
if ($("topFriends")) $("topFriends").onclick = () => {
  state.view = "friends";
  document.querySelectorAll(".nav[data-view]").forEach(x => x.classList.toggle("active", x.dataset.view === "friends"));
  renderView();
};
if ($("topNotifications")) $("topNotifications").onclick = () => $("notifications").click();
if ($("topProfile")) $("topProfile").onclick = () => {
  state.view = "profile";
  document.querySelectorAll(".nav[data-view]").forEach(x => x.classList.toggle("active", x.dataset.view === "profile"));
  renderView();
};

/* ---------------- ROOMS ---------------- */

async function loadRooms() {
  const data = await api("/api/rooms");
  state.rooms = data.rooms || [];
}

function renderRooms() {
  const search=($('roomSearch').value||'').trim().toLowerCase();
  const rooms=state.rooms.filter(room=>{
    const hay=[room.name,room.description,room.category].join(' ').toLowerCase();
    return !search || hay.includes(search);
  });
  $('rooms').innerHTML=rooms.map(room=>{
    const locked=room.locked??!!room.passwordHash;
    const count=Number(room.onlineCount||0);
    return `
      <button class="room room-list-item ${state.currentRoom===room.id?'selected':''}" onclick="joinRoom('${esc(room.id)}')">
        <span class="room-icon-wrap">${esc(room.icon||'💬')}</span>
        <span class="room-main">
          <span class="room-title-row"><strong>${esc(room.name)}</strong>${locked?'<span class="room-lock">🔒</span>':''}</span>
          <span class="room-desc">${esc(room.description||'No description has been written for this room')}</span>
          <span class="room-subrow"><span>${esc(room.category||'Community')}</span><span>•</span><span>${esc(room.rankRequired||'MEMBER')}+</span>${room.announcement?'<span>• 📌 announcement</span>':''}</span>
        </span>
        <span class="room-count"><strong>${count}</strong><span>♟</span></span>
      </button>`;
  }).join('') || '<div class="room-empty"><div>🏠</div><b>No rooms found</b><span>Try another search.</span></div>';
}

$("roomSearch").oninput = renderRooms;

async function joinRoom(id) {
  const room =
    state.rooms.find(r => r.id === id);

  if (!room) return;

  try {
    let password = "";

    const locked =
      room.locked ??
      !!room.passwordHash;

    if (locked) {
      password =
        prompt("Room password:") || "";
    }

    await api(`/api/rooms/${id}/join`, {
      method: "POST",
      body: JSON.stringify({ password })
    });

    if (
      state.currentRoom &&
      state.socket
    ) {
      state.socket.emit(
        "leave-room",
        state.currentRoom
      );
    }

    state.currentRoom = id;

    if (state.socket) {
      state.socket.emit("join-room", id);
    }

    $("chatWrap").classList.remove("hidden");
    $("viewRooms").classList.add("chatting");

    $("roomName").textContent =
      `${room.icon || "💬"} ${room.name}`;

    $("roomDesc").textContent =
      room.description || "";

    $("announcement").textContent =
      room.announcement || "";

    $("announcement").classList.toggle(
      "hidden",
      !room.announcement
    );

   const data =
  await api(`/api/rooms/${id}/messages`);

state.messages = data.messages || [];

$("messages").innerHTML =
  state.messages
    .map(messageHTML)
    .join("");

    $("messages").scrollTop =
      $("messages").scrollHeight;

    renderOnline();
    renderRooms();
  } catch (error) {
    toast(error.message);
  }
}

function renderOnline() {
  api("/api/users")
    .then(data => {
      const online =
        (data.users || []).filter(
          user => user.online
        );

      $("onlineUsers").innerHTML =
        online.map(user => `
          <div
            class="online-user"
            onclick="openUser('${esc(user.id)}')"
          >
            ${avatar(user)}

            <div>
              <b>${esc(user.displayName)}</b>
              <br>
              ${rank(user.rank)}
            </div>

            <span class="status on"></span>
          </div>
        `).join("") ||
        `<p class="muted">Nobody online.</p>`;

      $("onlineCount").textContent =
        `${online.length} online`;

      $("roomOnlineBadge").textContent =
        online.length;
    })
    .catch(() => {});
}

/* ---------------- MESSAGES ---------------- */

function messageHTML(message) {
  const user = {
    username: message.username,
    displayName: message.displayName,
    rank: message.rank,
    avatar: message.avatar || ""
  };

  let attachment = "";

  if (message.attachment) {
    if (
      message.attachment.type &&
      message.attachment.type.startsWith("image/")
    ) {
      attachment = `
        <img
          src="${esc(message.attachment.url)}"
          alt="Attachment"
          class="message-image"
        >
      `;
    } else {
      attachment = `
        <audio
          controls
          src="${esc(message.attachment.url)}"
        ></audio>
      `;
    }
  }

  const reactions =
    Object.entries(message.reactions || {})
      .filter(([, users]) => users.length)
      .map(([emoji, users]) => `
        <button
          class="mini"
          onclick="reactMsg(
            '${esc(message.id)}',
            '${esc(emoji)}'
          )"
        >
          ${emoji} ${users.length}
        </button>
      `)
      .join("");

  return `
    <div
      class="msg"
      data-mid="${esc(message.id)}"
    >
      ${avatar(user)}

      <div class="msg-body">

        <div class="msg-top">
          <b>${esc(message.displayName)}</b>
          ${rank(message.rank)}

          <span class="msg-time">
            ${fmt(message.time)}
            ${message.edited ? " · edited" : ""}
          </span>
        </div>

       ${
  message.replyTo
    ? (() => {
        const quoted =
          state.messages.find(
            m => m.id === message.replyTo
          );

        if (!quoted) {
          return `
            <div class="quoted">
              <div class="quoted-label">
                ↪ Replying to a message
              </div>
            </div>
          `;
        }

        return `
          <div
            class="quoted"
            onclick="jumpToMessage('${esc(quoted.id)}')"
          >
            <div class="quoted-label">
              ↪ ${esc(quoted.displayName || quoted.username || "User")}
            </div>

            <div class="quoted-text">
              ${
                quoted.text
                  ? esc(quoted.text)
                  : quoted.attachment
                    ? "📎 Attachment"
                    : "Message"
              }
            </div>
          </div>
        `;
      })()
    : ""
}

        ${
          message.text
            ? `<div class="msg-text">
                 ${esc(message.text)}
               </div>`
            : ""
        }

        ${attachment}

        ${
          message.forwardedFrom
            ? `<div class="muted">
                 ↗ forwarded
               </div>`
            : ""
        }

        ${
          message.pinned
            ? `<div class="pinned">
                 📌 Pinned message
               </div>`
            : ""
        }

        <div class="msg-actions">

          <button
            class="mini"
            onclick="replyMsg('${esc(message.id)}')"
          >
            Quote
          </button>

          <button
            class="mini"
            onclick="reportMsg('${esc(message.id)}')"
          >
            Report
          </button>

          <button
            class="mini"
            onclick="reactMsg('${esc(message.id)}','👍')"
          >
            👍
          </button>

          <button
            class="mini"
            onclick="saveMsg('${esc(message.id)}')"
          >
            🔖
          </button>

          ${
            message.userId === state.user.id ||
            can("MOD")
              ? `
                <button
                  class="mini"
                  onclick="editMsg('${esc(message.id)}')"
                >
                  Edit
                </button>

                <button
                  class="mini danger"
                  onclick="deleteMsg('${esc(message.id)}')"
                >
                  Delete
                </button>
              `
              : ""
          }

          ${
            can("MOD")
              ? `
                <button
                  class="mini"
                  onclick="pinMsg('${esc(message.id)}')"
                >
                  ${message.pinned ? "Unpin" : "Pin"}
                </button>
              `
              : ""
          }

        </div>

        <div class="reaction">
          ${reactions}
        </div>

      </div>
    </div>
  `;
}

function appendMessage(message) {
  if (
    document.querySelector(
      `[data-mid="${message.id}"]`
    )
  ) {
    return;
  }

  state.messages.push(message);

  $("messages").insertAdjacentHTML(
    "beforeend",
    messageHTML(message)
  );

  $("messages").scrollTop =
    $("messages").scrollHeight;
}

$("composer").onsubmit = async e => {
  e.preventDefault();

  if (!state.currentRoom) {
    toast("Join a room first.");
    return;
  }

  const text =
    $("message").value.trim();

  const file =
    $("file").files[0];

  if (!text && !file) return;

  const form = new FormData();

  form.append("text", text);

  if (file) {
    form.append("file", file);
  }

  if (state.replyTo) {
    form.append(
      "replyTo",
      state.replyTo
    );
  }

  try {
    const response =
      await fetch(
        `/api/rooms/${state.currentRoom}/messages`,
        {
          method: "POST",
          body: form,
          credentials: "same-origin"
        }
      );

    const data =
      await response.json()
        .catch(() => ({}));

    if (!response.ok) {
      throw Error(
        data.error || "Could not send message."
      );
    }

    $("message").value = "";
    $("file").value = "";

    state.replyTo = null;

    $("replyBar").classList.add(
      "hidden"
    );
  } catch (error) {
    toast(error.message);
  }
};
$("attach").onclick = () =>
  $("file").click();

$("message").oninput = () => {
  if (
    state.socket &&
    state.currentRoom
  ) {
    state.socket.emit("typing", {
      roomId: state.currentRoom,
      user: state.user.displayName,
      typing:
        $("message").value.length > 0
    });
  }
};

function replyMsg(id) {
  if (!state.user) {
    toast("Please login first.");
    return;
  }

  const message = state.messages?.find(
    m => String(m.id) === String(id)
  );

  if (!message) {
    toast("Original message could not be found.");
    return;
  }

  state.replyTo = message.id;

  const author =
    message.displayName ||
    message.username ||
    "User";

  const preview =
    message.text ||
    (message.attachment
      ? "📎 Attachment"
      : "Message");

  $("replyBar").innerHTML = `
    <div class="replybar-content">
      <div>
        <strong>↪ Replying to ${esc(author)}</strong>
        <div class="reply-preview">
          ${esc(preview)}
        </div>
      </div>

      <button
        type="button"
        class="reply-cancel"
        onclick="cancelReply()"
      >
        ✕
      </button>
    </div>
  `;

  $("replyBar").classList.remove("hidden");

  $("message").focus();
}
function cancelReply() {
  state.replyTo = null;

  $("replyBar").innerHTML = "";

  $("replyBar").classList.add(
    "hidden"
  );
}

function jumpToMessage(id) {
  const element =
    document.querySelector(
      `[data-mid="${CSS.escape(id)}"]`
    );

  if (!element) {
    return;
  }

  element.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });

  element.classList.add(
    "quote-highlight"
  );

  setTimeout(() => {
    element.classList.remove(
      "quote-highlight"
    );
  }, 1500);
}

async function editMsg(id) {
  const element =
    document.querySelector(
      `[data-mid="${id}"] .msg-text`
    );

  if (!element) return;

  const text =
    element.textContent;

  const updated =
    prompt("Edit message:", text);

  if (updated === null) return;

  try {
    await api(`/api/messages/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        text: updated
      })
    });
  } catch (error) {
    toast(error.message);
  }
}

async function deleteMsg(id) {
  if (!confirm("Delete this message?")) {
    return;
  }

  try {
    await api(`/api/messages/${id}`, {
      method: "DELETE"
    });

    const element =
      document.querySelector(
        `[data-mid="${id}"]`
      );

    if (element) {
      element.remove();
    }
  } catch (error) {
    toast(error.message);
  }
}

async function reactMsg(id, emoji) {
  try {
    await api(
      `/api/messages/${id}/reaction`,
      {
        method: "POST",
        body: JSON.stringify({ emoji })
      }
    );
  } catch (error) {
    toast(error.message);
  }
}

async function pinMsg(id) {
  try {
    await api(
      `/api/messages/${id}/pin`,
      {
        method: "POST"
      }
    );
  } catch (error) {
    toast(error.message);
  }
}

async function saveMsg(id) {
  try {
    const data =
      await api(
        `/api/messages/${id}/save`,
        {
          method: "POST"
        }
      );

    toast(data.saved ? "Message saved" : "Removed from saved");
    if(state.view==='saved') await loadSavedMessages();
  } catch (error) {
    toast(error.message);
  }
}

async function reportMsg(id) {
  const reason =
    prompt(
      "Reason for report:",
      "Rule breaking message"
    );

  if (reason === null) return;

  try {
    await api(
      `/api/messages/${id}/report`,
      {
        method: "POST",
        body: JSON.stringify({
          category: "Other",
          reason
        })
      }
    );

    toast("Report submitted.");
  } catch (error) {
    toast(error.message);
  }
}

/* ---------------- USERS ---------------- */

async function loadUsers() {
  try {
    const query =
      $("userSearch").value.trim();

    const data =
      await api(
        `/api/users?q=${encodeURIComponent(query)}`
      );

    $("users").innerHTML =
      (data.users || [])
        .map(userCard)
        .join("") ||
      `<p class="muted">No users found.</p>`;
  } catch (error) {
    toast(error.message);
  }
}

$("userSearch").oninput =
  () => loadUsers();

function userCard(user) {
  return `
    <div class="user-card">

      ${avatar(user)}

      <div style="flex:1">

        <b>${esc(user.displayName)}</b>

        <div class="muted">
          @${esc(user.username)}
        </div>

        ${rank(user.rank)}
        · Lv ${user.level || 1}
        · 🪙 ${user.gold || 0}

      </div>

      <button
        class="mini"
        onclick="openUser('${esc(user.id)}')"
      >
        Open
      </button>

    </div>
  `;
}

async function openUser(id) {
  try {
    const data = await api(`/api/users/${encodeURIComponent(id)}/profile`);
    const user=data.user; if(!user) return;
    renderUserProfileModal(user,data);
  } catch(error){ toast(error.message); }
}

function renderUserProfileModal(user,data={}){
  const memberSince=user.createdAt?new Date(user.createdAt).toLocaleDateString():'Unknown';
  const lastSeen=user.privacy?.lastSeen!==false&&user.lastSeen?new Date(user.lastSeen).toLocaleString():'Hidden';
  const bannerStyle=user.banner?`style="background-image:linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.78)),url('${esc(user.banner)}')"`:'';
  const isSelf=user.id===state.user.id;
  const liked=!!data.likedByMe;
  modal(`<div class="profile-modal">
    <div class="profile-banner" ${bannerStyle}>
      <div class="profile-stats"><span class="profile-stat">⭐ ${user.level||1}</span><span class="profile-stat">XP ${user.xp||0}</span><span class="profile-stat">❤️ ${user.profileLikes||data.profileLikes||0}</span></div>
      ${avatar(user,'big-avatar')}
      <div class="profile-rank">${rank(user.rank)}${user.verified?' · ✓ Verified':''}</div>
      <div class="profile-name">${esc(user.displayName)}</div>
      <div class="profile-handle">@${esc(user.username)}</div>
    </div>
    <div class="profile-tabs">
      <button class="profile-tab active" data-tab="info">Account</button>
      <button class="profile-tab" data-tab="about">About Me</button>
      <button class="profile-tab" data-tab="friends">Friends</button>
      <button class="profile-tab" data-tab="gifts">Gifts</button>
      <button class="profile-tab" data-tab="more">More</button>
    </div>
    <div id="profileTabContent" class="profile-info"></div>
  </div>`);
  const renderTab=(tab)=>{
    document.querySelectorAll('.profile-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
    const box=$('profileTabContent');
    if(tab==='info') box.innerHTML=`
      <div class="profile-info-row"><b>👤 Username</b><span>@${esc(user.username)}</span></div>
      <div class="profile-info-row"><b>🏅 Rank</b><span>${rank(user.rank)}</span></div>
      <div class="profile-info-row"><b>⭐ Level</b><span>${user.level||1} · ${user.xp||0} XP · 🪙 ${user.gold||0}</span></div>
      <div class="profile-info-row"><b>📅 Member since</b><span>${esc(memberSince)}</span></div>
      <div class="profile-info-row"><b>🏠 Status</b><span>${user.online?'Online':'Offline'}</span></div>
      <div class="profile-info-row"><b>◉ Last seen</b><span>${esc(lastSeen)}</span></div>
      <div class="profile-actions">
        ${!isSelf?`<button class="primary" id="profileLikeBtn">${liked?'❤️ Unlike':'❤️ Like'} <span id="likeCount">${user.profileLikes||data.profileLikes||0}</span></button><button class="mini" id="profileMessageBtn">💬 Message</button><button class="mini" id="profileFriendBtn">👥 ${data.friendship==='ACCEPTED'?'Friends':data.friendship==='PENDING'?'Pending':'Add Friend'}</button><button class="mini" id="profileBlockBtn">🚫 Block</button>`:''}
        ${isSelf?`<button class="primary" id="editProfileFromModal">✏️ Edit profile</button>`:''}
        ${can('MOD')&&!isSelf?`<button class="mini" id="profileModerateBtn">🛡️ Moderate</button>`:''}
      </div>`;
    else if(tab==='about') box.innerHTML=`<div class="about-card"><h3>About Me</h3><p>${esc(user.bio||'This user has not written an About Me yet.')}</p>${user.pronouns?`<div class="profile-info-row"><b>Pronouns</b><span>${esc(user.pronouns)}</span></div>`:''}${user.interests?.length?`<div class="tag-list">${user.interests.map(x=>`<span class="tag">${esc(x)}</span>`).join('')}</div>`:''}${isSelf?`<button class="primary" id="editAboutBtn">✏️ Edit About Me</button>`:''}</div>`;
    else if(tab==='friends') box.innerHTML=`<div class="about-card"><h3>Friends</h3><p class="muted">Friends and social connections for @${esc(user.username)}.</p><div class="profile-info-row"><b>👥 Friends</b><span>${user.friendsCount||0}</span></div><button class="mini" id="viewFriendsBtn">Open Friends</button></div>`;
    else if(tab==='gifts') box.innerHTML=`<div class="about-card"><h3>Virtual Gifts</h3><p class="muted">Send a gift using your in-site gold.</p>${!isSelf?`<div class="gift-grid"><button class="gift-btn" data-gift="rose">🌹 Rose · 25</button><button class="gift-btn" data-gift="star">⭐ Star · 50</button><button class="gift-btn" data-gift="crown">👑 Crown · 100</button><button class="gift-btn" data-gift="heart">💜 Heart · 150</button></div>`:'<p>Your received gifts appear here.</p>'}</div>`;
    else box.innerHTML=`<div class="about-card"><div class="profile-info-row"><b>📝 About</b><span>${esc(user.bio||'No About Me')}</span></div><div class="profile-info-row"><b>📜 Username history</b><span>${(user.usernameHistory||[]).length} changes</span></div><div class="profile-info-row"><b>🔗 Profile ID</b><span>${esc(user.id)}</span></div><div class="profile-actions">${!isSelf?'<button class="mini danger" id="profileReportBtn">⚑ Report user</button>':''}</div></div>`;
    wireProfileTabActions();
  };
  function wireProfileTabActions(){
    $('profileLikeBtn')?.addEventListener('click',async()=>{try{const r=await api(`/api/users/${user.id}/like`,{method:'POST'});data.likedByMe=r.liked;user.profileLikes=r.likes;$('profileLikeBtn').innerHTML=`${r.liked?'❤️ Unlike':'❤️ Like'} <span id="likeCount">${r.likes}</span>`;document.querySelector('.profile-stats .profile-stat:last-child').textContent=`❤️ ${r.likes}`;}catch(e){toast(e.message)}});
    $('profileMessageBtn')?.addEventListener('click',()=>{closeModal();openDM(user.id);});
    $('profileFriendBtn')?.addEventListener('click',async()=>{if(data.friendship==='ACCEPTED'){toast('Already friends.');return;}try{await friend(user.id);data.friendship='PENDING';renderTab('info');}catch(e){}});
    $('profileBlockBtn')?.addEventListener('click',async()=>{await block(user.id);closeModal();});
    $('profileModerateBtn')?.addEventListener('click',()=>moderate(user.id));
    $('editProfileFromModal')?.addEventListener('click',()=>{closeModal();state.view='profile';renderView();});
    $('editAboutBtn')?.addEventListener('click',()=>{modal(`<h2>Edit About Me</h2><textarea id="aboutEdit" rows="7">${esc(state.user.bio||'')}</textarea><div class="toolbar"><button class="primary" id="saveAbout">Save</button><button class="mini" onclick="closeModal()">Cancel</button></div>`);$('saveAbout').onclick=async()=>{try{const r=await api('/api/profile',{method:'PUT',body:JSON.stringify({bio:$('aboutEdit').value})});state.user=r.user;closeModal();toast('About Me saved.');}catch(e){toast(e.message)}};});
    $('viewFriendsBtn')?.addEventListener('click',()=>{closeModal();state.view='friends';renderView();});
    document.querySelectorAll('.gift-btn').forEach(b=>b.addEventListener('click',async()=>{try{const r=await api(`/api/users/${user.id}/gift`,{method:'POST',body:JSON.stringify({gift:b.dataset.gift})});state.user.gold=r.remainingGold;toast(`${r.gift.icon} ${r.gift.name} sent.`);renderTab('gifts');}catch(e){toast(e.message)}}));
    $('profileReportBtn')?.addEventListener('click',()=>{const reason=prompt('Why are you reporting this user?','Rule breaking behavior');if(reason)api('/api/reports',{method:'POST',body:JSON.stringify({target:user.id,reason})}).then(()=>toast('Report submitted.')).catch(e=>toast(e.message));});
  }
  document.querySelectorAll('.profile-tab').forEach(b=>b.addEventListener('click',()=>renderTab(b.dataset.tab)));
  renderTab('info');
}

async function friend(id) {
  try {
    await api(
      `/api/friends/${id}/request`,
      {
        method: "POST"
      }
    );

    toast("Friend request sent.");
  } catch (error) {
    toast(error.message);
  }
}

async function block(id) {
  try {
    await api(
      `/api/users/${id}/block`,
      {
        method: "POST"
      }
    );

    toast("User blocked.");
  } catch (error) {
    toast(error.message);
  }
}

/* ---------------- FRIENDS ---------------- */

async function loadFriends() {
  try {
    const data =
      await api("/api/friends");

    $("friends").innerHTML =
      (data.users || [])
        .map(userCard)
        .join("") ||
      `<p class="muted">No friends yet.</p>`;
  } catch (error) {
    toast(error.message);
  }
}

/* ---------------- PRIVATE MESSAGES ---------------- */

async function loadDMList() {
  try {
    const data =
      await api("/api/users");

    $("dmList").innerHTML =
      (data.users || [])
        .filter(u => u.id !== state.user.id)
        .map(user => `
          <div class="user-card">

            ${avatar(user)}

            <div style="flex:1">
              <b>${esc(user.displayName)}</b>
              <br>
              ${rank(user.rank)}
            </div>

            <button
              class="primary"
              onclick="openDM('${esc(user.id)}')"
            >
              Chat
            </button>

          </div>
        `)
        .join("") ||
      `<p class="muted">No users available.</p>`;
  } catch (error) {
    toast(error.message);
  }
}
function dmMessageHTML(message, messages, user) {
  const quoted = message.replyTo
    ? messages.find(m => String(m.id) === String(message.replyTo))
    : null;

  const quoteAuthor = quoted
    ? (quoted.from === state.user.id ? "You" : user.displayName)
    : null;

  const quoteText = quoted
    ? (quoted.text || (quoted.attachment ? "📎 Attachment" : "Message"))
    : null;

  return `
    <div
      class="msg dm-msg ${message.from === state.user.id ? "mine" : "theirs"}"
      data-dmid="${esc(message.id)}"
    >
      <div class="msg-body">
        <div class="msg-top">
          <b>${message.from === state.user.id ? "You" : esc(user.displayName)}</b>
          <span class="msg-time">
            ${fmt(message.time)}
            ${message.read ? " · read" : " · delivered"}
          </span>
        </div>

        ${
          message.replyTo
            ? `
              <div
                class="quoted dm-quoted"
                onclick="jumpToDMMessage('${esc(message.replyTo)}')"
                title="Jump to original message"
              >
                <div class="quoted-label">
                  ↪ ${esc(quoteAuthor || "Original message")}
                </div>
                <div class="quoted-text">
                  ${esc(quoteText || "Original message is no longer visible")}
                </div>
              </div>
            `
            : ""
        }

        ${
          message.text
            ? `<div class="msg-text">${esc(message.text)}</div>`
            : ""
        }

        ${
          message.attachment
            ? `
              <a
                href="${esc(message.attachment.url)}"
                target="_blank"
                rel="noopener noreferrer"
              >
                📎 ${esc(message.attachment.name || "Attachment")}
              </a>
            `
            : ""
        }

        <div class="msg-actions">
          <button
            type="button"
            class="mini"
            onclick="replyDMMsg('${esc(message.id)}','${esc(user.id)}')"
          >
            Quote
          </button>
        </div>
      </div>
    </div>
  `;
}

async function openDM(id) {
  try {
    const users = await api("/api/users");
    const user = (users.users || []).find(x => x.id === id);

    if (!user) {
      toast("User not found.");
      return;
    }

    state.dmUserId = id;

    const data = await api(`/api/dm/${id}`);
    const messages = data.messages || [];
    state.dmMessages = messages;

    modal(`
      <h2>
        Private chat with ${esc(user.displayName)}
      </h2>

      <div
        id="dmMessages"
        class="messages"
        style="height:45vh"
      >
        ${
          messages.length
            ? messages.map(message => dmMessageHTML(message, messages, user)).join("")
            : `<p class="muted">No private messages yet.</p>`
        }
      </div>

      ${
        state.dmReplyTo
          ? `
            <div class="dm-replybar">
              <div class="dm-reply-content">
                <div>
                  <strong>
                    ↪ Replying to ${esc(state.dmReplyAuthor || user.displayName)}
                  </strong>
                  <div class="dm-reply-preview">
                    ${esc(state.dmReplyText || "Original message")}
                  </div>
                </div>
                <button
                  type="button"
                  class="mini danger"
                  onclick="cancelDMReply()"
                >
                  ✕
                </button>
              </div>
            </div>
          `
          : ""
      }

      <form id="dmForm" class="composer">
        <input
          id="dmText"
          placeholder="Private message…"
          maxlength="4000"
          autocomplete="off"
          required
        >
        <button class="send" type="submit">Send</button>
      </form>
    `);

    const box = $("dmMessages");
    if (box) box.scrollTop = box.scrollHeight;

    try {
      await api(`/api/dm/${id}/read`, { method: "POST" });
    } catch {}

    $("dmForm").onsubmit = async e => {
      e.preventDefault();

      const input = $("dmText");
      const text = input.value.trim();
      if (!text) return;

      try {
        const body = { text };
        if (state.dmReplyTo) body.replyTo = state.dmReplyTo;

        await api(`/api/dm/${id}`, {
          method: "POST",
          body: JSON.stringify(body)
        });

        input.value = "";
        state.dmReplyTo = null;
        state.dmReplyUser = null;
        state.dmReplyAuthor = null;
        state.dmReplyText = null;

        await openDM(id);
      } catch (error) {
        toast(error.message);
      }
    };

    $("dmText")?.focus();
  } catch (error) {
    toast(error.message);
  }
}

function replyDMMsg(messageId, userId) {
  const message = state.dmMessages?.find(
    m => String(m.id) === String(messageId)
  );

  if (!message) {
    toast("Original message is no longer available.");
    return;
  }

  state.dmReplyTo = message.id;
  state.dmReplyUser = userId;
  state.dmReplyAuthor =
    message.from === state.user.id
      ? "You"
      : ((state.dmMessages.find(m => m.from === message.from)?.displayName) || "User");
  state.dmReplyText =
    message.text ||
    (message.attachment ? "📎 Attachment" : "Message");

  openDM(userId);
}

function cancelDMReply() {
  const userId = state.dmReplyUser || state.dmUserId;

  state.dmReplyTo = null;
  state.dmReplyUser = null;
  state.dmReplyAuthor = null;
  state.dmReplyText = null;

  if (userId) {
    openDM(userId);
  }
}

function jumpToDMMessage(id) {
  const element = document.querySelector(
    `[data-dmid="${CSS.escape(String(id))}"]`
  );

  if (!element) {
    toast("Original message is no longer visible.");
    return;
  }

  element.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });

  element.classList.add("quote-highlight");

  setTimeout(() => {
    element.classList.remove("quote-highlight");
  }, 1400);
}

/* ---------------- SAVED / SEARCH ---------------- */

function messageResultHTML(message,opts={}){
  const room=state.rooms.find(r=>r.id===message.roomId);
  const text=message.deletedSnapshot?.text ?? message.text ?? '';
  return `<article class="card search-result" data-result-id="${esc(message.id)}">
    <div class="search-result-head">
      ${avatar(message)}
      <div><b>${esc(message.displayName||message.username||'Unknown')}</b> <span class="muted">@${esc(message.username||'')}</span><div class="muted">${esc(room?.name||message.roomId||'Unknown room')} · ${fmt(message.time)}</div></div>
    </div>
    <div class="search-result-text">${esc(text||'(no text)')}</div>
    ${message.attachment?.url?`<div class="muted">📎 ${esc(message.attachment.name||message.attachment.type||'Attachment')}</div>`:''}
    <div class="toolbar"><button class="mini" onclick="openResultMessage('${esc(message.id)}','${esc(message.roomId||'')}')">Open message</button>${opts.saved?`<button class="mini danger" onclick="saveMsg('${esc(message.id)}')">Remove saved</button>`:''}</div>
  </article>`;
}

async function loadSavedMessages(){
  try{
    const data=await api('/api/saved-messages');
    const messages=data.messages||[];
    $('saved').innerHTML=messages.length?messages.map(m=>messageResultHTML(m,{saved:true})).join(''):`<div class="room-empty"><div>🔖</div><b>No saved messages yet</b><span>Use the 🔖 button on any message to save it here.</span></div>`;
  }catch(e){toast(e.message)}
}

async function loadSearchRooms(){
  try{
    const data=await api('/api/rooms');
    const rooms=data.rooms||[];
    const sel=$('sr');
    const old=sel.value;
    sel.innerHTML='<option value="">All rooms</option>'+rooms.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
    sel.value=old;
  }catch(e){toast(e.message)}
}

$('searchForm').onsubmit=async e=>{
  e.preventDefault();
  try{
    const q=encodeURIComponent($('sq').value.trim());
    const author=encodeURIComponent($('sa').value.trim());
    const roomId=encodeURIComponent($('sr').value);
    const data=await api(`/api/search/messages?q=${q}&author=${author}&roomId=${roomId}`);
    const messages=data.messages||[];
    $('searchResults').innerHTML=messages.length?messages.map(m=>messageResultHTML(m)).join(''):`<div class="room-empty"><div>🔎</div><b>No matching messages</b><span>Try a different keyword, author or room.</span></div>`;
  }catch(e){toast(e.message)}
};

async function openResultMessage(id,roomId){
  try{
    if(roomId){
      await joinRoom(roomId);
      const el=document.querySelector(`[data-mid="${CSS.escape(String(id))}"]`);
      if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.classList.add('quote-highlight');setTimeout(()=>el.classList.remove('quote-highlight'),1400);}
    }else{
      toast('Room information is unavailable for this message.');
    }
  }catch(e){toast(e.message)}
}


/* ---------------- NEWS ---------------- */

async function loadNews() {
  try {
    const data =
      await api("/api/news");

    $("news").innerHTML =
      (data.news || [])
        .map(news => `
          <article class="card">

            <h3>
              ${esc(news.title)}
            </h3>

            <div class="muted">
              ${fmt(news.time)}
              · @${esc(news.author)}
            </div>

            <p>
              ${esc(news.body)}
            </p>
            ${canFeature('delete_news')?`<div class="toolbar"><button class="mini danger" onclick="deleteNews('${esc(news.id)}')">🗑 Delete news</button></div>`:''}

          </article>
        `)
        .join("") ||
      `<p class="muted">No news yet.</p>`;
  } catch (error) {
    toast(error.message);
  }
}

$("publishNews").onclick = () => {
  modal(`
    <h2>Publish News</h2>

    <form id="newsForm">

      <input
        id="nt"
        placeholder="Title"
        required
      >

      <textarea
        id="nb"
        placeholder="News content"
        rows="8"
        required
      ></textarea>

      <button class="primary">
        Publish
      </button>

    </form>
  `);

  $("newsForm").onsubmit =
    async e => {
      e.preventDefault();

      try {
        await api("/api/news", {
          method: "POST",
          body: JSON.stringify({
            title: $("nt").value,
            body: $("nb").value
          })
        });

        closeModal();
        await loadNews();

        toast("News published.");
      } catch (error) {
        toast(error.message);
      }
    };
};

async function deleteNews(id){
  if(!confirm('Delete this news item?')) return;
  try{await api(`/api/news/${encodeURIComponent(id)}`,{method:'DELETE'});toast('News deleted.');await loadNews();}catch(e){toast(e.message)}}

/* ---------------- LEADERBOARD ---------------- */

async function loadLeaderboard() {
  try {
    const data =
      await api("/api/leaderboard");

    const users =
      data.users || [];

    $("leaderboard").innerHTML = `
      <div class="card">

        <h3>Top XP</h3>

        ${
          users.map((user, i) => `
            <div class="user-card">

              <b>#${i + 1}</b>

              ${avatar(user)}

              <div style="flex:1">
                <b>${esc(user.displayName)}</b>
                ${rank(user.rank)}
              </div>

              <b>
                Lv ${user.level || 1}
                · ${user.xp || 0} XP
              </b>

            </div>
          `).join("")
        }

      </div>

      <div class="card">

        <h3>Gold</h3>

        ${
          users
            .slice()
            .sort(
              (a, b) =>
                (b.gold || 0) -
                (a.gold || 0)
            )
            .map(user => `
              <div class="user-card">

                ${avatar(user)}

                <div style="flex:1">
                  ${esc(user.displayName)}
                </div>

                <b>
                  🪙 ${user.gold || 0}
                </b>

              </div>
            `)
            .join("")
        }

      </div>
    `;
  } catch (error) {
    toast(error.message);
  }
}

/* ---------------- PROFILE ---------------- */

async function loadProfile(user){
  if(!user) return;
  const banner=user.banner?`style="background-image:linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.72)),url('${esc(user.banner)}')"`:'';
  $('profile').innerHTML=`<div class="my-profile-wrap"><div class="profile-settings-card">
    <div class="profile-settings-head" ${banner}>
      <div class="profile-settings-top"><span>⭐ ${user.level||1}</span><span>❤️ ${user.profileLikes||0}</span><button class="mini" onclick="uploadAvatar()">📷</button></div>
      ${avatar(user,'big-avatar')}
      <div class="profile-rank">${rank(user.rank)}${user.verified?' · ✓ Verified':''}</div>
      <div class="profile-name">${esc(user.displayName)}</div><div class="profile-handle">@${esc(user.username)}</div>
      <button class="mini" onclick="uploadBanner()">🎵 Add music / banner</button>
    </div>
    <div class="settings-tabs"><button class="settings-tab active" data-st="account">Account</button><button class="settings-tab" data-st="more">More</button></div>
    <div id="myProfileSettings"></div>
  </div></div>`;
  const content=$('myProfileSettings');
  const render=(tab)=>{
    document.querySelectorAll('.settings-tab').forEach(b=>b.classList.toggle('active',b.dataset.st===tab));
    if(tab==='account'){content.innerHTML=`<div class="settings-list">
      <button class="settings-row" onclick="editProfileInfo()"><span>🪪</span><b>Edit info</b><small>Display name, pronouns and profile details</small><strong>›</strong></button>
      <button class="settings-row" onclick="editRelationship()"><span>♥</span><b>Edit relationship</b><small>${esc(user.relationship||'Not set')}</small><strong>›</strong></button>
      <button class="settings-row" onclick="editUsername()"><span>✎</span><b>Edit username</b><small>@${esc(user.username)}</small><strong>›</strong></button>
      <button class="settings-row" onclick="editAboutMe()"><span>?</span><b>Edit about me</b><small>${esc(user.bio||'Not set')}</small><strong>›</strong></button>
      <button class="settings-row" onclick="editMood()"><span>☻</span><b>Edit mood</b><small>${esc(user.mood||'Not set')}</small><strong>›</strong></button>
      <button class="settings-row" onclick="editEmail()"><span>✉</span><b>Edit email</b><small>Email is optional</small><strong>›</strong></button>
      <button class="settings-row" onclick="changePasswordModal()"><span>🔑</span><b>Change password</b><small>Update your login password</small><strong>›</strong></button>
    </div>`;}else{content.innerHTML=`<div class="settings-list">
      <button class="settings-row" onclick="privacyModal()"><span>🔒</span><b>Privacy</b><small>Control status and last-seen visibility</small><strong>›</strong></button>
      <button class="settings-row" onclick="uploadAvatar()"><span>🖼️</span><b>Edit photos</b><small>Profile photo and banner</small><strong>›</strong></button>
      <button class="settings-row" onclick="usernameHistory()"><span>📜</span><b>Username history</b><small>${(user.usernameHistory||[]).length} recorded changes</small><strong>›</strong></button>
      <button class="settings-row danger-row" onclick="deleteAccount()"><span>⊘</span><b>Delete account</b><small>This action is permanent</small><strong>›</strong></button>
    </div>`;}
  };
  document.querySelectorAll('.settings-tab').forEach(b=>b.addEventListener('click',()=>render(b.dataset.st))); render('account');
}

async function saveMyProfile(fields,message){try{const r=await api('/api/profile',{method:'PUT',body:JSON.stringify(fields)});state.user=r.user;closeModal();updateNav();await loadProfile(state.user);toast(message||'Saved.');}catch(e){toast(e.message)}}
function editProfileInfo(){modal(`<h2>Edit info</h2><input id="piName" value="${esc(state.user.displayName)}" placeholder="Display name"><input id="piPronouns" value="${esc(state.user.pronouns||'')}" placeholder="Pronouns"><button class="primary" id="savePI">Save</button>`);$('savePI').onclick=()=>saveMyProfile({displayName:$('piName').value.trim(),pronouns:$('piPronouns').value.trim()},'Info saved.');}
function editRelationship(){modal(`<h2>Edit relationship</h2><select id="rel"><option value="">Not set</option><option>Single</option><option>In a relationship</option><option>Complicated</option><option>Prefer not to say</option></select><button class="primary" id="saveRel">Save</button>`);$('rel').value=state.user.relationship||'';$('saveRel').onclick=()=>saveMyProfile({relationship:$('rel').value},'Relationship saved.');}
function editUsername(){modal(`<h2>Edit username</h2><input id="newUsername" maxlength="24" value="${esc(state.user.username)}"><p class="muted">3–24 letters, numbers and underscores.</p><button class="primary" id="saveUsername">Save</button>`);$('saveUsername').onclick=()=>saveMyProfile({username:$('newUsername').value.trim()},'Username saved.');}
function editAboutMe(){modal(`<h2>Edit about me</h2><textarea id="aboutMeEdit" rows="7" maxlength="500">${esc(state.user.bio||'')}</textarea><button class="primary" id="saveAboutMe">Save</button>`);$('saveAboutMe').onclick=()=>saveMyProfile({bio:$('aboutMeEdit').value},'About Me saved.');}
function editMood(){modal(`<h2>Edit mood</h2><input id="moodEdit" maxlength="120" value="${esc(state.user.mood||'')}" placeholder="How are you feeling?"><button class="primary" id="saveMood">Save</button>`);$('saveMood').onclick=()=>saveMyProfile({mood:$('moodEdit').value.trim()},'Mood saved.');}
async function editEmail(){try{const r=await api('/api/me/email');modal(`<h2>Edit email</h2><p class="muted">Email is optional. It is not required on the registration screen.</p><input id="emailEdit" type="email" value="${esc(r.email||'')}" placeholder="Email address"><div class="toolbar"><button class="primary" id="saveEmail">Save</button><button class="mini" onclick="closeModal()">Cancel</button></div>`);$('saveEmail').onclick=async()=>{try{await api('/api/me/email',{method:'PUT',body:JSON.stringify({email:$('emailEdit').value.trim()})});closeModal();toast('Email saved.');}catch(e){toast(e.message)}}}catch(e){toast(e.message)}}
function changePasswordModal(){modal(`<h2>Change password</h2><input id="oldPassword" type="password" placeholder="Current password"><input id="newPassword" type="password" placeholder="New password (8+ characters)"><button class="primary" id="savePassword">Change password</button>`);$('savePassword').onclick=async()=>{try{await api('/api/password/change',{method:'POST',body:JSON.stringify({currentPassword:$('oldPassword').value,newPassword:$('newPassword').value})});closeModal();toast('Password changed.');}catch(e){toast(e.message)}}}

function uploadAvatar() {
  modal(`
    <h2>Profile photo</h2>

    <input
      type="file"
      id="av"
      accept="image/*"
    >

    <button
      class="primary"
      onclick="sendUpload('/api/me/avatar','av')"
    >
      Upload
    </button>
  `);
}

function uploadBanner() {
  modal(`
    <h2>Profile banner</h2>

    <input
      type="file"
      id="bn"
      accept="image/*"
    >

    <button
      class="primary"
      onclick="sendUpload('/api/me/banner','bn')"
    >
      Upload
    </button>
  `);
}

async function sendUpload(url, id) {
  const file = $(id).files[0];

  if (!file) {
    toast("Choose a file first.");
    return;
  }

  const form = new FormData();

  form.append("file", file);

  try {
    const response =
      await fetch(url, {
        method: "POST",
        body: form,
        credentials: "same-origin"
      });

    const data =
      await response.json()
        .catch(() => ({}));

    if (!response.ok) {
      throw Error(
        data.error || "Upload failed."
      );
    }

    state.user = data.user;

    closeModal();

    updateNav();

    await loadProfile(
      state.user
    );

    toast("Uploaded successfully.");
  } catch (error) {
    toast(error.message);
  }
}

function privacyModal() {
  modal(`
    <h2>Privacy</h2>

    <p class="muted">
      Privacy settings control
      online-status and last-seen visibility.
    </p>

    <button
      class="primary"
      onclick="closeModal()"
    >
      Done
    </button>
  `);
}

function usernameHistory() {
  modal(`
    <h2>Username change history</h2>

    <pre>${esc(
      JSON.stringify(
        state.user.usernameHistory || [],
        null,
        2
      )
    )}</pre>
  `);
}

async function deleteAccount() {
  if (
    !confirm(
      "Permanently delete your account?"
    )
  ) {
    return;
  }

  try {
    await api("/api/me", {
      method: "DELETE"
    });

    location.reload();
  } catch (error) {
    toast(error.message);
  }
}

/* ---------------- MODERATION ---------------- */

function moderate(id) {
  modal(`
    <h2>Moderation</h2>

    <p>Select an action.</p>

    <div class="toolbar">

      ${
        [
          "WARN",
          "MUTE",
          "KICK",
          "BAN",
          "UNMUTE",
          "REVOKE_MUTE",
          "REVOKE_BAN",
          "REVOKE_KICK"
        ]
          .map(action => `
            <button
              class="mini"
              onclick="doModerate(
                '${esc(id)}',
                '${action}'
              )"
            >
              ${action}
            </button>
          `)
          .join("")
      }

    </div>

    <input
      id="modReason"
      placeholder="Reason"
    >

    <input
      id="modMinutes"
      type="number"
      min="1"
      placeholder="Minutes"
    >
  `);
}

async function doModerate(id, action) {
  try {
    await api(
      `/api/moderation/${action.toLowerCase()}`,
      {
        method: "POST",
        body: JSON.stringify({
          userId: id,
          reason:
            $("modReason")?.value || "",
          minutes:
            $("modMinutes")?.value || ""
        })
      }
    );

    closeModal();

    toast("Moderation action applied.");
  } catch (error) {
    toast(error.message);
  }
}

/* ---------------- STAFF ---------------- */

async function loadStaff() {
  try {
    const data=await api('/api/staff/dashboard');
    const bootstrapData=await api('/api/bootstrap');
    const filterWords=await api('/api/staff/filter-word');
    $('staff').innerHTML=`
      <div class="grid2">
        <div class="card"><h3>Statistics</h3><p>Users: ${data.stats.users}<br>Online: ${data.stats.online}<br>Messages: ${data.stats.messages}<br>Open reports: ${data.stats.reportsOpen}</p></div>
        <div class="card"><h3>Filtered words</h3><button class="mini" onclick="addFilterWord()">＋ Add word</button><div class="filter-word-list">${(filterWords.words||[]).map(w=>`<div class="filter-word-row"><code>${esc(w)}</code><button class="mini danger" onclick="deleteFilterWord(decodeURIComponent('${encodeURIComponent(w)}'))">Delete</button></div>`).join('')||'<span class="muted">No filter words configured.</span>'}</div><p class="muted">Link filter: ${bootstrapData.settings?.linkFilter?'ON':'OFF'}</p></div>
      </div>
      <div class="card"><h3>Reports</h3>
        ${(data.reports||[]).map(report=>{
          const snap=report.messageSnapshot||{};
          return `<div class="report-card"><div class="report-main"><div><b>${esc(report.category)}</b> · ${esc(report.status)}</div><div class="report-target"><b>Reported user:</b> @${esc(report.reportedUserUsername||snap.username||'Unknown')} ${esc(report.reportedUserRank||snap.rank||'')}</div><div class="report-message"><b>Reported message:</b><br>${esc(snap.text||'(no text)')}</div><div class="muted">Reported by @${esc(report.reporterUsername||findUserName(report.reporter)||'Unknown')} · ${fmt(report.time)}</div><div class="muted">Reason: ${esc(report.reason||'No reason supplied')}</div></div><div class="toolbar">${report.reportedUserId?`<button class="mini" onclick="moderate('${esc(report.reportedUserId)}')">⚙ Moderate user</button>`:''}${report.messageId?`<button class="mini danger" onclick="deleteReportedMessage('${esc(report.messageId)}')">🗑 Delete message</button>`:''}${report.status!=='RESOLVED'?`<button class="mini" onclick="resolveReport('${esc(report.id)}')">Resolve</button>`:''}</div></div>`;
        }).join('')||'<p class="muted">No reports.</p>'}
      </div>
      <div class="card"><h3>Audit log</h3><div class="table-wrap"><table class="table"><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th></tr>${(data.logs||[]).slice(0,100).map(log=>`<tr><td>${fmt(log.time)}</td><td>${esc(log.actor)}</td><td>${esc(log.action)}</td><td>${esc(log.target)}</td><td>${esc(logDetails(log))}</td></tr>`).join('')}</table></div></div>`;
  }catch(e){toast(e.message)}
}

function findUserName(id){
  return state.allUsers?.find(u=>u.id===id)?.username || (id?String(id).slice(0,12):'Unknown');
}
function logDetails(log){
  if(!log?.meta) return '';
  if(log.action==='MESSAGE_DELETE') return log.meta.text||log.meta.deletedSnapshot?.text||'';
  if(log.action==='NEWS_DELETE') return log.meta.title||'';
  if(log.action==='FEATURE_PERMISSION_CHANGE') return `${log.meta.rank||''}`;
  return typeof log.meta==='string'?log.meta:JSON.stringify(log.meta);
}

async function deleteReportedMessage(id){
  if(!confirm('Delete the reported message?')) return;
  try{await api(`/api/messages/${encodeURIComponent(id)}`,{method:'DELETE'});toast('Reported message deleted.');await loadStaff();}catch(e){toast(e.message)}}

async function addFilterWord() {
  const word =
    prompt(
      "Word or phrase to auto-filter:"
    );

  if (!word) return;

  try {
    await api(
      "/api/staff/filter-word",
      {
        method: "POST",
        body: JSON.stringify({ word })
      }
    );

    toast("Filter word added.");

    await loadStaff();
  } catch (error) {
    toast(error.message);
  }
}

async function deleteFilterWord(word){
  if(!confirm(`Delete filter word "${word}"?`)) return;
  try{await api('/api/staff/filter-word',{method:'DELETE',body:JSON.stringify({word})});toast('Filter word deleted.');await loadStaff();}catch(e){toast(e.message)}}

async function resolveReport(id) {
  try {
    await api(
      `/api/staff/reports/${id}/resolve`,
      {
        method: "POST",
        body: JSON.stringify({
          status: "RESOLVED"
        })
      }
    );

    await loadStaff();
  } catch (error) {
    toast(error.message);
  }
}

/* ---------------- OWNER ---------------- */

async function loadOwner() {
  try {
    const data =
      await api("/api/owner/overview");

    $("owner").innerHTML = `
      <div class="card">

        <h3>
          Permanent Owner Space
        </h3>

        <p>
          Owner-only controls for
          users, ranks, gold, passwords,
          private-message inspection,
          rooms, settings and audit logs.
        </p>

        <div class="toolbar">

          <button
            class="primary"
            onclick="inspectDMs()"
          >
            Inspect private messages
          </button>

          <button
            class="mini"
            onclick="ownerSettings()"
          >
            Site settings
          </button>

          <button class="mini" onclick="ownerFeatureGrants()">🧩 Feature granting</button>

        </div>

      </div>

      <div class="card">

        <h3>User controls</h3>

        ${
          (data.users || [])
            .map(user => `
              <div class="user-card">

                ${avatar(user)}

                <div style="flex:1">

                  <b>
                    ${esc(user.displayName)}
                  </b>

                  @${esc(user.username)}

                  <br>

                  ${rank(user.rank)}

                  · 🪙 ${user.gold || 0}

                  · Lv ${user.level || 1}

                </div>

                <button
                  class="mini"
                  onclick="ownerEdit(
                    '${esc(user.id)}'
                  )"
                >
                  Manage
                </button>

              </div>
            `)
            .join("")
        }

      </div>

      <div class="card">

        <h3>
          Gold transaction history
        </h3>

        ${
          data.goldTransactions?.length
            ? data.goldTransactions
                .slice(-100)
                .reverse()
                .map(transaction => `
                  <div>
                    ${fmt(transaction.time)}
                    ·
                    ${esc(transaction.type)}
                    ·
                    ${transaction.delta}
                  </div>
                `)
                .join("")
            : `<p>No transactions.</p>`
        }

      </div>
    `;
  } catch (error) {
    toast(error.message);
  }
}

async function ownerEdit(id) {
  try {
    const data =
      await api("/api/owner/overview");

    const user =
      (data.users || [])
        .find(u => u.id === id);

    if (!user) return;

    const editableRanks = [
      "MEMBER",
      "VIP",
      "PREMIUM",
      "MOD",
      "ADMIN",
      "SUPER_ADMIN",
      "COMMISSOR",
      "COOWNER"
    ];

    modal(`
      <h2>
        Manage @${esc(user.username)}
      </h2>

      <select id="orank">

        ${
          editableRanks
            .map(r => `
              <option
                value="${r}"
                ${
                  r === user.rank
                    ? "selected"
                    : ""
                }
              >
                ${r}
              </option>
            `)
            .join("")
        }

      </select>

      <input
        id="ogold"
        type="number"
        value="${user.gold || 0}"
        placeholder="Gold"
      >

      <input
        id="opass"
        type="password"
        placeholder="New password (optional)"
      >

      <div class="toolbar">

        <button
          class="primary"
          onclick="saveOwnerUser(
            '${esc(user.id)}'
          )"
        >
          Save
        </button>

        ${
          user.username !== "Maleficent"
            ? `
              <button
                class="mini danger"
                onclick="ownerDelete(
                  '${esc(user.id)}'
                )"
              >
                Delete account
              </button>
            `
            : ""
        }

      </div>
    `);
  } catch (error) {
    toast(error.message);
  }
}

async function saveOwnerUser(id) {
  try {
    await api(
      `/api/owner/user/${id}/rank`,
      {
        method: "PATCH",
        body: JSON.stringify({
          rank: $("orank").value
        })
      }
    );

    await api(
      `/api/owner/user/${id}/gold`,
      {
        method: "PATCH",
        body: JSON.stringify({
          amount: $("ogold").value
        })
      }
    );

    if ($("opass").value) {
      await api(
        `/api/owner/user/${id}/password`,
        {
          method: "PATCH",
          body: JSON.stringify({
            password: $("opass").value
          })
        }
      );
    }

    closeModal();

    await loadOwner();

    toast("User updated.");
  } catch (error) {
    toast(error.message);
  }
}

async function ownerDelete(id) {
  if (
    !confirm(
      "Delete this account permanently?"
    )
  ) {
    return;
  }

  try {
    await api(
      `/api/owner/user/${id}`,
      {
        method: "DELETE"
      }
    );

    closeModal();

    await loadOwner();
  } catch (error) {
    toast(error.message);
  }
}

async function inspectDMs() {
  try {
    const data =
      await api("/api/owner/dms");

    modal(`
      <h2>
        Owner-only private-message inspection
      </h2>

      ${
        (data.privateMessages || [])
          .map(message => `
            <div class="card">

              <b>
                ${esc(message.from)}
                →
                ${esc(message.to)}
              </b>

              <br>

              ${esc(message.text || "")}

              <br>

              <small>
                ${fmt(message.time)}
              </small>

            </div>
          `)
          .join("") ||
        `<p>No private messages.</p>`
      }
    `);
  } catch (error) {
    toast(error.message);
  }
}

async function ownerFeatureGrants(){
  try{
    const data=await api('/api/owner/feature-permissions');
    modal(`<div class="feature-grant-modal"><h2>🧩 Feature Granting Panel</h2><p class="muted">Choose the minimum rank that can use each implemented feature. Changes are enforced by the server.</p><div class="feature-grant-list">${data.controls.map(f=>`<div class="feature-grant-row"><div><b>${esc(f.name)}</b><small>${esc(f.category)}</small></div><select data-feature="${esc(f.key)}">${data.ranks.map(r=>`<option value="${r}" ${(data.permissions[f.key]||f.defaultRank)===r?'selected':''}>${rankIcon[r]||''} ${r}</option>`).join('')}</select></div>`).join('')}</div><div class="toolbar"><button class="primary" id="saveFeatureGrants">Save all permissions</button><button class="mini" onclick="closeModal()">Cancel</button></div></div>`);
    $('saveFeatureGrants').onclick=async()=>{try{for(const sel of document.querySelectorAll('[data-feature]')){const current=data.permissions[sel.dataset.feature]||'';if(sel.value!==current){await api(`/api/owner/feature-permissions/${encodeURIComponent(sel.dataset.feature)}`,{method:'PATCH',body:JSON.stringify({rank:sel.value})});}}closeModal();toast('Feature permissions saved.');}catch(e){toast(e.message)}};
  }catch(e){toast(e.message)}
}

async function ownerSettings() {
  try {
    const data =
      await api("/api/owner/overview");

    const settings =
      data.settings || {};

    modal(`
      <h2>Site settings</h2>

      <input
        id="xp"
        type="number"
        value="${settings.xpPerLevel ?? 100}"
        placeholder="XP per level"
      >

      <input
        id="dxp"
        type="number"
        value="${settings.dailyXpLimit ?? 1000}"
        placeholder="Daily XP limit"
      >

      <input
        id="gm"
        type="number"
        value="${settings.goldPerMinute ?? 1}"
        placeholder="Gold per minute"
      >

      <label class="check-row"><input id="lf" type="checkbox" ${settings.linkFilter?"checked":""}> Link filter</label>
      <label class="field-label">Filtered-word mute applies to this rank and below</label>
      <select id="filterRank">${ranks.map(r=>`<option value="${r}" ${r===(settings.filterMuteMinRank||'MEMBER')?'selected':''}>${rankIcon[r]||''} ${r}</option>`).join('')}</select>
      <label class="field-label">Filtered-word mute duration (minutes)</label>
      <input id="filterDuration" type="number" min="1" max="10080" value="${Number(settings.filterMuteDurationMinutes||5)}">

      <button
        class="primary"
        onclick="saveOwnerSettings()"
      >
        Save
      </button>
    `);
  } catch (error) {
    toast(error.message);
  }
}

async function saveOwnerSettings() {
  try {
    await api(
      "/api/owner/settings",
      {
        method: "PATCH",
        body: JSON.stringify({
          xpPerLevel:
            $("xp").value,

          dailyXpLimit:
            $("dxp").value,

          goldPerMinute:
            $("gm").value,

          linkFilter:$('lf').checked,
          filterMuteMinRank:$('filterRank').value,
          filterMuteDurationMinutes:$('filterDuration').value
        })
      }
    );

    closeModal();

    toast("Settings saved.");
  } catch (error) {
    toast(error.message);
  }
}

/* ---------------- NOTIFICATIONS ---------------- */

async function loadNotifications() {
  try {
    const data =
      await api("/api/notifications");

    const unread =
      (data.notifications || [])
        .filter(n => !n.read)
        .length;

    $("notifDot").style.display = unread ? "inline-block" : "none";
    if ($("topNotifDot")) $("topNotifDot").style.display = unread ? "block" : "none";
  } catch {}
}

$("notifications").onclick =
  async () => {
    try {
      const data =
        await api("/api/notifications");

      modal(`
        <h2>Notifications</h2>

        ${
          (data.notifications || [])
            .map(notification => `
              <div class="card">

                <b>
                  ${esc(notification.title)}
                </b>

                <br>

                ${esc(notification.text)}

                <br>

                <small>
                  ${fmt(notification.time)}
                </small>

              </div>
            `)
            .join("") ||
          `<p class="muted">
             No notifications.
           </p>`
        }
      `);

      await api(
        "/api/notifications/read",
        {
          method: "POST"
        }
      );

      await loadNotifications();
    } catch (error) {
      toast(error.message);
    }
  };

/* ---------------- ROOM MENU ---------------- */

$("roomMenu").onclick = () => {
  const room =
    state.rooms.find(
      r => r.id === state.currentRoom
    );

  if (!room) return;

  modal(`
    <h2>
      ${esc(room.name)}
    </h2>

    <div class="toolbar">

      ${
        canFeature("clear_room") || canFeature("edit_room") || canFeature("delete_room")
          ? `
            ${canFeature("clear_room")?`<button class="mini" onclick="clearRoom()">/clear</button>`:""}

            ${canFeature("edit_room")?`<button class="mini" onclick="editRoom()">Edit room</button>`:""}

            ${canFeature("delete_room")?`<button class="mini danger" onclick="deleteRoom()">Delete room</button>`:""}
          `
          : ""
      }

      <button
        class="mini"
        onclick="showInvite()"
      >
        Invite link
      </button>

    </div>
  `);
};

async function clearRoom() {
  if (!confirm("Clear this room?")) {
    return;
  }

  try {
    await api(
      `/api/rooms/${state.currentRoom}/clear`,
      {
        method: "POST"
      }
    );

    closeModal();
  } catch (error) {
    toast(error.message);
  }
}

function editRoom() {
  const room =
    state.rooms.find(
      r => r.id === state.currentRoom
    );

  if (!room) return;

  modal(`
    <h2>Edit room</h2>

    <input
      id="rn"
      value="${esc(room.name)}"
      placeholder="Room name"
    >

    <input
      id="ri"
      value="${esc(room.icon || "💬")}"
      placeholder="Icon"
    >

    <textarea
      id="rd"
      placeholder="Description"
    >${esc(room.description || "")}</textarea>

    <input
      id="rc"
      value="${esc(room.category || "Community")}"
      placeholder="Category"
    >

    <input
      id="rs"
      type="number"
      min="0"
      value="${room.slowMode || 0}"
      placeholder="Slow mode"
    >

    <input
      id="rp"
      placeholder="New password (blank removes)"
    >

    <button
      class="primary"
      onclick="saveRoom()"
    >
      Save
    </button>
  `);
}

async function saveRoom() {
  try {
    await api(
      `/api/rooms/${state.currentRoom}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: $("rn").value,
          icon: $("ri").value,
          description: $("rd").value,
          category: $("rc").value,
          slowMode: $("rs").value,
          password: $("rp").value
        })
      }
    );

    await loadRooms();

    closeModal();

    renderRooms();

    toast("Room updated.");
  } catch (error) {
    toast(error.message);
  }
}

async function deleteRoom() {
  if (!confirm("Delete this room?")) {
    return;
  }

  try {
    await api(
      `/api/rooms/${state.currentRoom}`,
      {
        method: "DELETE"
      }
    );

    if (state.socket) {
      state.socket.emit(
        "leave-room",
        state.currentRoom
      );
    }

    state.currentRoom = null;

    $("chatWrap").classList.add(
      "hidden"
    );

    await loadRooms();

    closeModal();

    renderRooms();
  } catch (error) {
    toast(error.message);
  }
}

function showInvite() {
  const room =
    state.rooms.find(
      r => r.id === state.currentRoom
    );

  if (!room) return;

  modal(`
    <h2>Room invite</h2>

    <input
      value="${location.origin}/?room=${encodeURIComponent(room.id)}"
      readonly
    >
  `);
}

/* ---------------- CREATE ROOM ---------------- */

$("newRoom").onclick = () => {
  modal(`
    <h2>Create room</h2>

    <form id="roomForm">

      <input
        id="rn"
        placeholder="Room name"
        required
      >

      <input
        id="ri"
        placeholder="Icon"
        value="💬"
      >

      <input
        id="rd"
        placeholder="Description"
      >

      <input
        id="rc"
        placeholder="Category"
        value="Community"
      >

      <input
        id="rp"
        placeholder="Password (optional)"
        type="password"
      >

      <select id="rr">

        ${
          [
            "MEMBER",
            "VIP",
            "PREMIUM",
            "MOD",
            "ADMIN"
          ]
            .map(r =>
              `<option value="${r}">
                ${r}
              </option>`
            )
            .join("")
        }

      </select>

      <input
        id="rl"
        type="number"
        min="1"
        value="100"
        placeholder="Member limit"
      >

      <input
        id="rs"
        type="number"
        min="0"
        value="0"
        placeholder="Slow mode seconds"
      >

      <button class="primary">
        Create room
      </button>

    </form>
  `);

  $("roomForm").onsubmit =
    async e => {
      e.preventDefault();

      try {
        await api("/api/rooms", {
          method: "POST",
          body: JSON.stringify({
            name: $("rn").value,
            icon: $("ri").value,
            description:
              $("rd").value,
            category:
              $("rc").value,
            password:
              $("rp").value,
            rankRequired:
              $("rr").value,
            limit:
              $("rl").value,
            slowMode:
              $("rs").value
          })
        });

        await loadRooms();

        closeModal();

        renderRooms();

        toast("Room created.");
      } catch (error) {
        toast(error.message);
      }
    };
};


/* ---------------- V3 SETTINGS / FEATURE CENTER ---------------- */

function applyTheme(theme){
  document.documentElement.dataset.theme=theme||'obsidian';
}

async function loadSettings(){
  const r=await api('/api/settings');
  const s=r.settings||{};
  $('settings').innerHTML=`
    <div class="panel"><h3>Account status</h3>
      <select id="v3Status"><option value="online">Online</option><option value="away">Away</option><option value="busy">Busy</option><option value="invisible">Invisible</option></select>
      <input id="v3StatusText" maxlength="120" placeholder="Custom status" value="${esc(r.statusText||'')}">
      <button class="primary" id="saveStatus">Save status</button>
    </div>
    <div class="panel theme-panel"><h3>🎨 Theme</h3><p class="muted">Choose your chat appearance. Your choice is saved to your account.</p><div class="theme-picker">${['obsidian','midnight','forest','rose','lavender','sunset','ocean'].map(t=>`<button type="button" class="theme-chip" data-theme-choice="${t}"><span class="theme-dot"></span><b>${t[0].toUpperCase()+t.slice(1)}</b></button>`).join('')}</div><select id="v3Theme" class="hidden"><option>obsidian</option><option>midnight</option><option>forest</option><option>rose</option><option>lavender</option><option>sunset</option><option>ocean</option></select>
      <select id="v3Font"><option value="small">Small text</option><option value="medium">Medium text</option><option value="large">Large text</option></select>
      <label><input type="checkbox" id="v3Compact"> Compact mode</label>
      <label><input type="checkbox" id="v3Motion"> Reduced animation</label>
      <label><input type="checkbox" id="v3Contrast"> High contrast</label>
      <button class="primary" id="saveAppearance">Save appearance</button>
    </div>
    <div class="panel"><h3>Notifications</h3>
      <label><input type="checkbox" id="nMessages" checked> New messages</label>
      <label><input type="checkbox" id="nMentions" checked> Mentions</label>
      <label><input type="checkbox" id="nReplies" checked> Replies</label>
      <label><input type="checkbox" id="nSecurity" checked> Security alerts</label>
      <button class="primary" id="saveNotifications">Save notifications</button>
    </div>
    <div class="panel"><h3>Password</h3>
      <input id="oldPass" type="password" placeholder="Current password">
      <input id="newPass" type="password" placeholder="New password (8+ characters)">
      <button class="primary" id="changePass">Change password</button>
    </div>`;
  $('v3Status').value=r.status||'online'; $('v3Theme').value=s.theme||'obsidian'; $('v3Font').value=s.fontSize||'medium'; applyTheme(s.theme||'obsidian'); document.querySelectorAll('[data-theme-choice]').forEach(b=>{b.classList.toggle('active',b.dataset.themeChoice===(s.theme||'obsidian'));b.onclick=()=>{ $('v3Theme').value=b.dataset.themeChoice; applyTheme(b.dataset.themeChoice); document.querySelectorAll('[data-theme-choice]').forEach(x=>x.classList.toggle('active',x===b)); }});
  $('v3Compact').checked=!!s.compactMode; $('v3Motion').checked=!!s.reducedMotion; $('v3Contrast').checked=!!s.highContrast;
  $('saveStatus').onclick=async()=>{await api('/api/settings',{method:'PUT',body:JSON.stringify({status:$('v3Status').value,statusText:$('v3StatusText').value})});toast('Status saved.');};
  $('saveAppearance').onclick=async()=>{await api('/api/settings',{method:'PUT',body:JSON.stringify({theme:$('v3Theme').value,fontSize:$('v3Font').value,compactMode:$('v3Compact').checked,reducedMotion:$('v3Motion').checked,highContrast:$('v3Contrast').checked})});applyTheme($('v3Theme').value);toast('Appearance saved.');};
  $('saveNotifications').onclick=async()=>{await api('/api/notifications/preferences',{method:'PUT',body:JSON.stringify({messages:$('nMessages').checked,mentions:$('nMentions').checked,replies:$('nReplies').checked,security:$('nSecurity').checked})});toast('Notification preferences saved.');};
  $('changePass').onclick=async()=>{try{await api('/api/password/change',{method:'POST',body:JSON.stringify({currentPassword:$('oldPass').value,newPassword:$('newPass').value})});toast('Password changed.');}catch(e){toast(e.message)}};
}

async function loadFeatures(){
  const q=encodeURIComponent(($('featureSearch')?.value||''));
  const r=await api('/api/features?q='+q);
  const by={}; for(const f of r.features){by[f.category]=(by[f.category]||0)+1;}
  $('featureStats').innerHTML=Object.entries(by).map(([k,v])=>`<div class="panel"><b>${esc(k)}</b><div class="big-number">${v}</div></div>`).join('');
  $('featureList').innerHTML=r.features.map(f=>`<div class="feature-row"><span class="feature-id">#${f.id}</span><b>${esc(f.name)}</b><span class="muted">${esc(f.category)}</span><span class="pill">Registered</span></div>`).join('');
}

function wireV3Nav(){
  document.querySelectorAll('.nav[data-view]').forEach(b=>b.addEventListener('click',async()=>{
    if(b.dataset.view==='settings') await loadSettings();
    if(b.dataset.view==='features') await loadFeatures();
  }));
  $('featureSearch')?.addEventListener('input',()=>{clearTimeout(window.featureTimer);window.featureTimer=setTimeout(loadFeatures,180)});
}

wireV3Nav();

/* ---------------- MODAL ---------------- */

$("modal").addEventListener(
  "click",
  event => {
    if (event.target === $("modal")) {
      closeModal();
    }
  }
);

/* ---------------- INIT ---------------- */

bootstrap();
