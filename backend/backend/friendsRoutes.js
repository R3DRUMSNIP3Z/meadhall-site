const { users, ensureFriendState } = require("./db");

// return only safe, public fields
function safeUser(u) {
  if (!u) return null;
  const { id, name, email, avatarUrl, bio, interests } = u;
  return { id, name, email, avatarUrl, bio, interests };
}

const currentUserId = (req) => (req.get("x-user-id") || "").trim();

function install(app) {
  // GET /api/friends — list friends + pending for current user (by x-user-id)
  app.get("/api/friends", (req, res) => {
    const me = currentUserId(req);
    const meUser = users.get(me);
    if (!me || !meUser) return res.status(401).json({ error: "Not signed in" });

    const rec = ensureFriendState(me);
    const toSafe = (id) => safeUser(users.get(id));

    res.json({
      friends:  [...rec.friends].map(toSafe).filter(Boolean),
      incoming: [...rec.incoming].map(toSafe).filter(Boolean),
      outgoing: [...rec.outgoing].map(toSafe).filter(Boolean),
    });
  });

  // POST /api/friends/request  { toUserId }
  app.post("/api/friends/request", (req, res) => {
    const me = currentUserId(req);
    const meUser = users.get(me);
    if (!me || !meUser) return res.status(401).json({ error: "Not signed in" });

    const to = String(req.body?.toUserId || "").trim();
    if (!to) return res.status(400).json({ error: "toUserId required" });
    if (to === me) return res.status(400).json({ error: "Cannot add yourself" });

    const toUser = users.get(to);
    if (!toUser) return res.status(404).json({ error: "User not found" });

    const A = ensureFriendState(me);
    const B = ensureFriendState(to);

    if (A.friends.has(to)) return res.json({ ok: true, status: "already_friends" });

    // If they already requested me, auto-accept both sides
    if (A.incoming.has(to)) {
      A.incoming.delete(to);
      B.outgoing.delete(me);
      A.friends.add(to);
      B.friends.add(me);
      return res.json({ ok: true, status: "accepted" });
    }

    // Otherwise create pending request
    A.outgoing.add(to);
    B.incoming.add(me);
    res.status(201).json({ ok: true, status: "requested" });
  });

  // POST /api/friends/respond  { fromUserId, accept }
  app.post("/api/friends/respond", (req, res) => {
    const me = currentUserId(req);
    const meUser = users.get(me);
    if (!me || !meUser) return res.status(401).json({ error: "Not signed in" });

    const from = String(req.body?.fromUserId || "").trim();
    const accept = !!req.body?.accept;
    if (!from) return res.status(400).json({ error: "fromUserId required" });

    const fromUser = users.get(from);
    if (!fromUser) return res.status(404).json({ error: "User not found" });

    const A = ensureFriendState(me);
    const B = ensureFriendState(from);

    if (!A.incoming.has(from)) return res.status(400).json({ error: "No such request" });

    // Clear pending
    A.incoming.delete(from);
    B.outgoing.delete(me);

    if (accept) {
      A.friends.add(from);
      B.friends.add(me);
    }

    res.json({ ok: true, status: accept ? "accepted" : "declined" });
  });
}

module.exports = { install };


