// src/friends.ts
type SafeUser = {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string;
  bio?: string;
  interests?: string;
};

type FriendsPayload = {
  friends: SafeUser[];
  incoming: SafeUser[];
  outgoing: SafeUser[];
};

type Message = { from: string; to: string; text: string; ts: number };

// ------- CONFIG & AUTH -------
const API_BASE =
  (document.querySelector('meta[name="api-base"]') as HTMLMetaElement)?.content?.replace(/\/$/, "") ||
  (import.meta as any)?.env?.VITE_API_BASE ||
  "";

function getUserFromLS(): SafeUser | null {
  try {
    return JSON.parse(
      localStorage.getItem("mh_user") ||
        localStorage.getItem("user") ||
        "null"
    );
  } catch {
    return null;
  }
}
const me = getUserFromLS();
const CURRENT_USER_ID = me?.id || "";

// ------- DOM -------
const $ = (id: string) => document.getElementById(id)!;
const $friends = $("friendsList");
const $incoming = $("incomingList");
const $outgoing = $("outgoingList");
const $lookup = $("lookupId") as HTMLInputElement;
const $lookupBtn = $("lookupBtn") as HTMLButtonElement;
const $lookupResult = $("lookupResult");
const $dock = $("chatDock");

// feedback line (optional)
let $notice = document.getElementById("notice");
const say = (msg: string, kind = "") => {
  if (!$notice) return;
  $notice.innerHTML = msg ? `<span class="${kind}">${escapeHtml(msg)}</span>` : "";
};

// ------- Guards -------
if (!API_BASE) {
  console.error("Missing API base. Add <meta name='api-base' content='http://localhost:5050'/>");
}
if (!CURRENT_USER_ID) {
  console.warn("Not signed in. mh_user / user missing in localStorage.");
}

// ------- Utilities -------
const escapeHtml = (s: any) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function http<T = any>(method: "GET" | "POST" | "PUT", path: string, body?: any): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-user-id": CURRENT_USER_ID || "",
    },
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
  });
  if (!r.ok) {
    const ct = r.headers.get("content-type") || "";
    const data = ct.includes("json") ? await r.json() : await r.text();
    const msg = typeof data === "string" ? data : data?.error || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return (await r.json()) as T;
}

// ------- API wrappers -------
const apiSearchUsers = (q: string) => http<SafeUser[]>("GET", `/api/users/search?q=${encodeURIComponent(q)}`);
const apiGetFriends = () => http<FriendsPayload>("GET", "/api/friends");
const apiRequestFriend = (toUserId: string) => http("POST", "/api/friends/request", { toUserId });
const apiRespondFriend = (fromUserId: string, accept: boolean) =>
  http("POST", "/api/friends/respond", { fromUserId, accept });
const apiHistory = (withId: string) => http<Message[]>("GET", `/api/chat/history?with=${encodeURIComponent(withId)}`);
const apiSend = (to: string, text: string) => http("POST", "/api/chat/send", { to, text });

// ------- Lookup -------
async function lookup() {
  if (!$lookup || !$lookupResult) return;
  $lookupResult.innerHTML = "";
  if (!$lookup.value.trim()) return;

  try {
    const results = await apiSearchUsers($lookup.value.trim());
    if (!Array.isArray(results) || results.length === 0) {
      $lookupResult.innerHTML = `<div class="muted">No user found for â€œ${escapeHtml($lookup.value)}â€.</div>`;
      return;
    }
    const rel = await apiGetFriends();
    $lookupResult.innerHTML = results.map((u) => buildLookupRow(u, rel)).join("");
    // bind buttons
    results.forEach((u) => {
      const btn = document.getElementById(`addBtn_${u.id}`) as HTMLButtonElement | null;
      if (btn && !btn.disabled) {
        btn.onclick = async () => {
          try {
            await apiRequestFriend(u.id);
            say(`Sent request to ${u.name || u.id}`, "ok");
            await refreshLists();
            await lookup(); // refresh state
          } catch (e: any) {
            say(e?.message || "Failed to send request", "err");
          }
        };
      }
    });
  } catch (e: any) {
    say(e?.message || "Search failed", "err");
  }
}

function buildLookupRow(u: SafeUser, rel: FriendsPayload) {
  const isFriend = rel.friends.some((x) => x.id === u.id);
  const isIncoming = rel.incoming.some((x) => x.id === u.id);
  const isOutgoing = rel.outgoing.some((x) => x.id === u.id);
  const disabled = isFriend || isIncoming || isOutgoing || u.id === CURRENT_USER_ID;

  const status = isFriend
    ? "Already friends"
    : isIncoming
    ? "They requested you (see Incoming)"
    : isOutgoing
    ? "Request pending"
    : u.id === CURRENT_USER_ID
    ? "Thatâ€™s you"
    : "";

  const label = `${escapeHtml(u.name || u.id)} (UserID${escapeHtml(u.id)})`;
  const profileHref = `friendprofile.html?user=${encodeURIComponent(u.id)}`;

  return `
    <div class="result">
      <img src="${escapeHtml(u.avatarUrl || "/logo/logo-512.png")}" alt="avatar"/>
      <div style="flex:1; min-width:0">
        <div><strong><a href="${profileHref}" style="color:inherit;text-decoration:none">${label}</a></strong></div>
        <div class="muted" style="font-size:.9rem">${escapeHtml(u.email || "")}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
        <a href="${profileHref}" class="muted" style="font-size:.85rem;text-decoration:underline">View Profile</a>
        <button id="addBtn_${u.id}" ${disabled ? "disabled" : ""}>Add Friend</button>
        ${ status ? `<div class="muted" style="font-size:.85rem">${escapeHtml(status)}</div>` : "" }
      </div>
    </div>
  `;
}

// ------- Lists -------
function itemFriend(u: SafeUser) {
  const label = `${escapeHtml(u.name || u.id)} (UserID${escapeHtml(u.id)})`;
  const profileHref = `friendprofile.html?user=${encodeURIComponent(u.id)}`;
  // data-uid used by click delegation as a fallback
  return `
    <div class="item" data-uid="${escapeHtml(u.id)}">
      <div class="meta">
        <a href="${profileHref}" class="meta-link" style="display:flex;align-items:center;gap:10px;color:inherit;text-decoration:none;">
          <img src="${escapeHtml(u.avatarUrl || "/logo/logo-512.png")}" alt="">
          <div>
            <div class="name">${label}</div>
            <div class="id">${escapeHtml(u.email || "")}</div>
          </div>
        </a>
      </div>
      <div class="actions">
        <button onclick="window.openChat('${u.id}','${escapeHtml(u.name || u.id)}')">Chat</button>
      </div>
    </div>
  `;
}
function itemIncoming(u: SafeUser) {
  const label = `${escapeHtml(u.name || u.id)} (UserID${escapeHtml(u.id)})`;
  return `
    <div class="item">
      <div class="meta">
        <img src="${escapeHtml(u.avatarUrl || "/logo/logo-512.png")}" alt="">
        <div>
          <div class="name">${label}</div>
          <div class="id">${escapeHtml(u.email || "")}</div>
        </div>
      </div>
      <div class="actions">
        <button onclick="window.respondFriend('${u.id}', true)">Accept</button>
        <button class="secondary" onclick="window.respondFriend('${u.id}', false)">Decline</button>
      </div>
    </div>
  `;
}
function itemOutgoing(u: SafeUser) {
  const label = `${escapeHtml(u.name || u.id)} (UserID${escapeHtml(u.id)})`;
  return `
    <div class="item">
      <div class="meta">
        <img src="${escapeHtml(u.avatarUrl || "/logo/logo-512.png")}" alt="">
        <div>
          <div class="name">${label}</div>
          <div class="id">${escapeHtml(u.email || "")}</div>
        </div>
      </div>
      <div class="actions"><span class="muted">Pendingâ€¦</span></div>
    </div>
  `;
}

async function refreshLists() {
  try {
    const data = await apiGetFriends();
    $friends.innerHTML = data.friends.length ? data.friends.map(itemFriend).join("") : `<div class="muted">No friends yet.</div>`;
    $incoming.innerHTML = data.incoming.length ? data.incoming.map(itemIncoming).join("") : `<div class="muted">None.</div>`;
    $outgoing.innerHTML = data.outgoing.length ? data.outgoing.map(itemOutgoing).join("") : `<div class="muted">None.</div>`;
  } catch (e: any) {
    say(e?.message || "Failed to load lists", "err");
  }
}

// expose for inline onclick
;(window as any).respondFriend = async (fromUserId: string, accept: boolean) => {
  try {
    await apiRespondFriend(fromUserId, !!accept);
    await refreshLists();
    say(accept ? "Friend request accepted." : "Declined.", "ok");
  } catch (e: any) {
    say(e?.message || "Failed to respond", "err");
  }
};

// ------- Chat dock -------
const openWindows: Map<
  string,
  { root: HTMLElement; msgsEl: HTMLElement; ta: HTMLTextAreaElement; pollId: number | null }
> = new Map();

async function renderHistory(friendId: string) {
  const w = openWindows.get(friendId);
  if (!w) return;
  const list = await apiHistory(friendId);
  w.msgsEl.innerHTML = "";
  list.forEach((m) => {
    const div = document.createElement("div");
    div.className = "msg " + (m.from === CURRENT_USER_ID ? "mine" : "");
    div.innerHTML = `<div>${escapeHtml(m.text)}</div><time>${new Date(m.ts).toLocaleTimeString()}</time>`;
    w.msgsEl.appendChild(div);
  });
  w.msgsEl.scrollTop = w.msgsEl.scrollHeight;
}

function openChat(friendId: string, friendName: string) {
  if (openWindows.has(friendId)) {
    const { root } = openWindows.get(friendId)!;
    root.style.display = "flex";
    root.querySelector("textarea")?.focus();
    return;
  }
  const root = document.createElement("div");
  root.className = "chat-box";
  root.innerHTML = `
    <div class="chat-head">
      <div class="title">ðŸ’¬ ${escapeHtml(friendName || friendId)} (UserID${escapeHtml(friendId)})</div>
      <div class="btns">
        <button data-min>_</button>
        <button data-close>Ã—</button>
      </div>
    </div>
    <div class="chat-msgs"></div>
    <div class="chat-compose">
      <textarea rows="3" placeholder="Speak, ${escapeHtml(friendName || "friend")}â€¦"></textarea>
      <button data-send>Send</button>
    </div>
  `;
  const msgsEl = root.querySelector(".chat-msgs") as HTMLElement;
  const ta = root.querySelector("textarea") as HTMLTextAreaElement;
  const sendBtn = root.querySelector("[data-send]") as HTMLButtonElement;
  const btnMin = root.querySelector("[data-min]") as HTMLButtonElement;
  const btnClose = root.querySelector("[data-close]") as HTMLButtonElement;

  sendBtn.addEventListener("click", async () => {
    const text = (ta.value || "").trim();
    if (!text) return;
    await apiSend(friendId, text);
    ta.value = "";
    renderHistory(friendId);
  });
  ta.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = (ta.value || "").trim();
      if (!text) return;
      await apiSend(friendId, text);
      ta.value = "";
      renderHistory(friendId);
    }
  });
  btnMin.addEventListener("click", () => {
    const body = root.querySelector(".chat-msgs") as HTMLElement;
    const comp = root.querySelector(".chat-compose") as HTMLElement;
    const hidden = body.style.display === "none";
    body.style.display = hidden ? "flex" : "none";
    comp.style.display = hidden ? "flex" : "none";
  });
  btnClose.addEventListener("click", () => {
    const w = openWindows.get(friendId);
    if (w?.pollId) clearInterval(w.pollId);
    openWindows.delete(friendId);
    root.remove();
  });

  $dock.appendChild(root);
  openWindows.set(friendId, { root, msgsEl, ta, pollId: null });

  renderHistory(friendId).then(() => {
    const pollId = window.setInterval(() => renderHistory(friendId), 3000);
    const w = openWindows.get(friendId);
    if (w) w.pollId = pollId;
  });
  ta.focus();
}
;(window as any).openChat = openChat;

// ------- Click delegation fallback (ensures avatar/name opens profile) -------
$friends.addEventListener("click", (ev) => {
  const target = ev.target as HTMLElement;
  // ignore clicks in the right-side actions (Chat button, etc.)
  if (target.closest(".actions")) return;

  const metaOrLink = target.closest(".meta, .meta-link") as HTMLElement | null;
  if (!metaOrLink) return;

  const item = metaOrLink.closest(".item") as HTMLElement | null;
  const uid = item?.getAttribute("data-uid");
  if (!uid) return;

  // If an explicit anchor is present, use its href; otherwise build one
  const explicit = metaOrLink.querySelector("a.meta-link") as HTMLAnchorElement | null;
  const href = explicit?.getAttribute("href") || `friendprofile.html?user=${encodeURIComponent(uid)}`;
  window.location.href = href;
});

// ------- Wire & init -------
$lookupBtn?.addEventListener("click", lookup);
$lookup?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") lookup();
});
refreshLists().catch(() => {});







