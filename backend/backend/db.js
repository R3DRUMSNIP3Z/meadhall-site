/** Simple in-memory DB shared by all routes */
const users = new Map();   // id -> { id,name,email,password?,avatarUrl,bio,interests }
const stories = new Map(); // userId -> [{ id,title,text,createdAt }]

// --- Friends + Requests ---
const friendships = new Map(); // userId -> { friends:Set, incoming:Set, outgoing:Set }
function ensureFriendState(id) {
  if (!friendships.has(id)) {
    friendships.set(id, { friends: new Set(), incoming: new Set(), outgoing: new Set() });
  }
  return friendships.get(id);
}

// --- Direct Messages ---
const messages = new Map(); // "a|b" -> [{ from, to, text, ts }]
function dmKey(a, b) {
  return [a, b].sort().join("|");
}

module.exports = {
  users,
  stories,
  friendships,
  ensureFriendState,
  messages,
  dmKey,
};





