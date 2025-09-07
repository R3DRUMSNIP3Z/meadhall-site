// backend/chatRoutes.js
const { randomUUID } = require("crypto");
const { users, ensureFriendState, messages, dmKey } = require("./db");

/* =========================================================
 * ===============   DIRECT MESSAGE (existing)   ===========
 * =======================================================*/

const currentUserId = (req) => (req.get("x-user-id") || "").trim();

// GET /api/chat/history?with=ID  -> last messages (requires friendship)
function install(app) {
  app.get("/api/chat/history", (req, res) => {
    const me  = currentUserId(req);
    const you = String(req.query.with || "").trim();

    const meUser = users.get(me);
    const youUser = users.get(you);
    if (!me || !meUser) return res.status(401).json({ error: "Not signed in" });
    if (!youUser) return res.status(404).json({ error: "User not found" });

    const meRec = ensureFriendState(me);
    if (!meRec.friends.has(you)) {
      return res.status(403).json({ error: "Not friends" });
    }

    const k = dmKey(me, you);
    const list = messages.get(k) || [];
    res.json(list.slice(-200));
  });

  // POST /api/chat/send { to, text }  (requires friendship)
  app.post("/api/chat/send", (req, res) => {
    const me   = currentUserId(req);
    const to   = String(req.body?.to || "").trim();
    const text = String(req.body?.text || "").trim();

    const meUser = users.get(me);
    const toUser = users.get(to);
    if (!me || !meUser) return res.status(401).json({ error: "Not signed in" });
    if (!toUser) return res.status(404).json({ error: "User not found" });
    if (!text)  return res.status(400).json({ error: "Empty message" });

    const meRec = ensureFriendState(me);
    if (!meRec.friends.has(to)) {
      return res.status(403).json({ error: "Not friends" });
    }

    const k = dmKey(me, to);
    const list = messages.get(k) || [];
    list.push({ from: me, to, text, ts: Date.now() });
    messages.set(k, list);

    res.status(201).json({ ok: true });
  });

  /* =========================================================
   * ======================  GLOBAL CHAT  =====================
   * =======================================================*/

  // In-memory store for global messages + SSE clients
  const globalMessages = []; // {id, userId, text, createdAt}
  const GLOBAL_HISTORY_MAX = 200;
  const clients = new Set(); // each: { res }

  function msgView(m) {
    const u = users.get(m.userId) || {};
    return {
      id: m.id,
      text: m.text,
      createdAt: m.createdAt,
      user: {
        id: u.id || null,
        name: u.name || "skald",
        avatarUrl: u.avatarUrl || null,
      },
    };
  }

  // Preflight for POST/GET (helps some browsers/extensions)
  app.options("/api/chat/global", (req, res) => {
    const origin = req.headers.origin || "*";
    res.set({
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
      "Vary": "Origin",
    });
    res.sendStatus(204);
  });

  // GET /api/chat/global?since=<lastId>   -> incremental history
  app.get("/api/chat/global", (req, res) => {
    const origin = req.headers.origin || "*";
    res.set({ "Access-Control-Allow-Origin": origin, "Vary": "Origin" });

    const since = String(req.query.since || "");
    let idx = 0;
    if (since) {
      idx = globalMessages.findIndex((m) => m.id === since);
      idx = idx === -1 ? 0 : idx + 1;
    }
    const slice = globalMessages.slice(idx).map(msgView);
    res.json(slice);
  });

  // GET /api/chat/global/stream  -> Server-Sent Events
  app.get("/api/chat/global/stream", (req, res) => {
    const origin = req.headers.origin || "*";
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": origin,
      "Vary": "Origin",
    });
    res.flushHeaders();

    // Hint reconnect
    res.write("retry: 5000\n\n");

    // Send a small recent history burst so late joiners see context
    const recent = globalMessages.slice(-50).map(msgView);
    for (const m of recent) {
      res.write(`data: ${JSON.stringify(m)}\n\n`);
    }

    const client = { res };
    clients.add(client);
    // keepalive
    const ping = setInterval(() => {
      try { res.write(`event: ping\ndata: {}\n\n`); } catch {}
    }, 25000);

    req.on("close", () => {
      clearInterval(ping);
      clients.delete(client);
    });
  });

  // POST /api/chat/global { userId, text }  -> broadcast to everyone
  // ❗ No auth required; userId is optional (anonymous = "skald")
  app.post("/api/chat/global", (req, res) => {
    const origin = req.headers.origin || "*";
    res.set({ "Access-Control-Allow-Origin": origin, "Vary": "Origin" });

    const userId = String(req.body?.userId || "").trim(); // may be ""
    const text   = String(req.body?.text   || "").trim();
    if (!text) return res.status(400).json({ error: "Empty message" });

    const msg = {
      id: randomUUID(),
      userId: userId || null,      // null -> anonymous "skald"
      text,
      createdAt: Date.now(),
    };

    // store with cap
    globalMessages.push(msg);
    if (globalMessages.length > GLOBAL_HISTORY_MAX) {
      globalMessages.splice(0, globalMessages.length - GLOBAL_HISTORY_MAX);
    }

    // fan-out
    const payload = `data: ${JSON.stringify(msgView(msg))}\n\n`;
    for (const c of clients) {
      try { c.res.write(payload); } catch {}
    }

    res.status(201).json({ ok: true, id: msg.id });
  });

  // (Optional legacy endpoint you had before — keep if other code uses it)
  app.get("/api/chat/global/history", (req, res) => {
    const origin = req.headers.origin || "*";
    res.set({ "Access-Control-Allow-Origin": origin, "Vary": "Origin" });
    const limit = Math.min(parseInt(req.query.limit || "50", 10) || 50, GLOBAL_HISTORY_MAX);
    res.json(globalMessages.slice(-limit).map(msgView));
  });
}

module.exports = { install };



