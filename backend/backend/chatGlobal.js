// backend/chatGlobal.js
const express = require("express");
const { randomUUID } = require("crypto");
const { users } = require("./db");

const messages = [];
const clients = new Set();
const MAX_MSGS = 500;        // keep memory bounded
const HEARTBEAT_MS = 25000;  // keep SSE alive across proxies

function msgView(m) {
  const u = (m.userId && users.get(m.userId)) || {};
  return {
    id: m.id,
    text: m.text,
    createdAt: m.createdAt,
    user: {
      id: u.id || null,
      name: u.name || "skald",
      avatarUrl: u.avatarUrl || null,
      membership: (u.membership || "reader"), // <-- frames rely on this
    },
  };
}

function setCORS(req, res) {
  const origin = req.headers.origin || "*";
  res.set({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
  });
}

function install(app) {
  // --- CORS preflight for POST & GET ---
  app.options("/api/chat/global", (req, res) => {
    setCORS(req, res);
    return res.sendStatus(204);
  });
  app.options("/api/chat/global/stream", (req, res) => {
    setCORS(req, res);
    return res.sendStatus(204);
  });

  // --- History (optional since=lastId) ---
  app.get("/api/chat/global", (req, res) => {
    setCORS(req, res);
    const since = (req.query.since || "").trim();
    let out = messages;
    if (since) {
      const idx = messages.findIndex((m) => m.id === since);
      out = idx >= 0 ? messages.slice(idx + 1) : messages;
    }
    res.json(out.map(msgView));
  });

  // --- Live stream (SSE) ---
  app.get("/api/chat/global/stream", (req, res) => {
    setCORS(req, res);
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    });
    res.flushHeaders?.();

    // greet and register
    res.write(`data: ${JSON.stringify({ sys: "connected" })}\n\n`);
    clients.add(res);

    // heartbeat to prevent idle timeouts
    const hb = setInterval(() => {
      try { res.write(`event: ping\ndata: {}\n\n`); } catch { /* noop */ }
    }, HEARTBEAT_MS);

    req.on("close", () => {
      clearInterval(hb);
      clients.delete(res);
      try { res.end(); } catch {}
    });
    req.on("error", () => {
      clearInterval(hb);
      clients.delete(res);
      try { res.end(); } catch {}
    });
  });

  // --- Send message ---
  app.post("/api/chat/global", express.json(), (req, res) => {
    setCORS(req, res);
    const { userId = null, text } = req.body || {};
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "invalid text" });
    }

    const msg = { id: randomUUID(), userId, text, createdAt: Date.now() };
    messages.push(msg);
    if (messages.length > MAX_MSGS) messages.splice(0, messages.length - MAX_MSGS);

    const payload = `data: ${JSON.stringify(msgView(msg))}\n\n`;
    for (const c of clients) {
      try { c.write(payload); } catch { /* drop broken client on its own */ }
    }
    res.json({ ok: true, id: msg.id });
  });

  console.log("✅ chatGlobal routes mounted");
}

module.exports = { install };

