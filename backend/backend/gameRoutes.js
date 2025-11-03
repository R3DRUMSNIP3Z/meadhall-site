// backend/gameRoutes.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const { users } = require("./db");

// ================== IN-MEMORY GAME STATE ==================
const state = Object.create(null);

// ================== CATALOG LOADING ==================
const FILENAME = "catalogshop.json"; // single source of truth

// Local Windows dev (yours)
const WINDOWS_CATALOG_PATH =
  "C:\\Users\\Lisa\\meadhall-site\\public\\guildbook\\" + FILENAME;

// On Render, __dirname ≈ /opt/render/project/src/backend/backend
// Go up 2 levels to project root, then /public/guildbook/<file>
const RENDER_PUBLIC = path.resolve(__dirname, "..", "..", "public", "guildbook", FILENAME);

// Optional explicit override via env
const ENV_PATH = process.env.SHOP_CATALOG_PATH;

function pickCatalogPath() {
  const candidates = [ENV_PATH, WINDOWS_CATALOG_PATH, RENDER_PUBLIC].filter(Boolean);
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  // Fall back to Render public path for consistent logging
  return RENDER_PUBLIC;
}

let CATALOG_PATH = pickCatalogPath();
let catalog = { sets: {}, items: [] };

function loadCatalogOnce(p) {
  try {
    const raw = fs.readFileSync(p, "utf8");
    const obj = JSON.parse(raw);
    if (!Array.isArray(obj.items)) obj.items = [];
    if (!obj.sets || typeof obj.sets !== "object") obj.sets = {};
    console.log(`🛒 Catalog loaded: ${p} — ${obj.items.length} items, ${Object.keys(obj.sets).length} sets`);
    return obj;
  } catch (err) {
    console.warn("⚠️ Failed to load catalog:", p, err.message);
    return { sets: {}, items: [] };
  }
}

catalog = loadCatalogOnce(CATALOG_PATH);
try {
  fs.watchFile(CATALOG_PATH, { interval: 2000 }, () => {
    console.log("♻️ Shop catalog changed, reloading...");
    catalog = loadCatalogOnce(CATALOG_PATH);
  });
} catch { /* no-op */ }

const getShop = () => catalog.items || [];
const getSetBonuses = () => {
  const out = {};
  for (const [setId, setObj] of Object.entries(catalog.sets || {})) {
    out[setId] = Array.isArray(setObj.bonuses) ? setObj.bonuses : [];
  }
  return out;
};
const findItem = (id) => getShop().find((i) => i.id === id);

// ================== CONSTANTS (RULES) ==================
const SLOT_UNLOCK = {
  helm: 5,
  shoulders: 8,
  chest: 10,
  gloves: 12,
  boots: 15,
  ring: 18,
  wings: 22,
  pet: 24,
  sylph: 28,
};
const PVP_UNLOCK = 25;

// ================== DEV KEY ==================
const DEV_KEY = process.env.DEV_KEY || "valhalla-dev";
function requireDev(req, res, next) {
  const k = req.get("x-dev-key");
  if (!k || k !== DEV_KEY) return res.status(403).json({ error: "Forbidden (dev key)" });
  next();
}

// ================== HELPERS ==================
function ensure(uId) {
  if (!state[uId]) {
    const u = users.get(uId) || { id: uId, name: "Skald" };
    state[uId] = {
      id: u.id,
      name: u.name || "Skald",
      level: 1,
      xp: 0,
      gold: 100,
      power: 5,
      defense: 5,
      speed: 5,
      points: 0,
      gender: undefined,
      slots: {},        // { slotName: itemId }
      // derived fields set by recompute():
      totalPower: 5,
      totalDefense: 5,
      totalSpeed: 5,
      gearPower: 0,
      battleRating: 15,
      renameUsed: false,
      lastTick: Date.now(),
    };
  }
  return state[uId];
}

function tick(me) {
  const now = Date.now();
  const dt = Math.max(0, Math.floor((now - (me.lastTick || now)) / 1000));
  if (dt > 0) {
    me.gold += dt * 1;             // +1 gold/sec
    me.xp   += Math.floor(dt / 5); // +1 xp per 5s
    while (me.xp >= me.level * 100) {
      me.xp -= me.level * 100;
      me.level += 1;
      me.points += 3;
    }
    me.lastTick = now;
  }
  return me;
}

// Apply gear + set bonuses and compute totals/BR
function recompute(me) {
  const gear = { power: 0, defense: 0, speed: 0 };
  const countsBySet = {};
  for (const slot of Object.keys(me.slots || {})) {
    const itemId = me.slots[slot];
    const it = findItem(itemId);
    if (!it) continue;
    if (it.stat && typeof it.boost === "number") gear[it.stat] += it.boost;
    if (it.set) countsBySet[it.set] = (countsBySet[it.set] || 0) + 1;
  }

  const SET_BONUSES = getSetBonuses();
  const setBonus = { power: 0, defense: 0, speed: 0 };
  for (const setId of Object.keys(countsBySet)) {
    const n = countsBySet[setId];
    for (const r of (SET_BONUSES[setId] || [])) {
      if (n >= (r.pieces || 0)) {
        const b = r.bonus || {};
        if (b.power)   setBonus.power   += b.power;
        if (b.defense) setBonus.defense += b.defense;
        if (b.speed)   setBonus.speed   += b.speed;
      }
    }
  }

  me.totalPower   = Math.max(0, (me.power   || 0) + gear.power   + setBonus.power);
  me.totalDefense = Math.max(0, (me.defense || 0) + gear.defense + setBonus.defense);
  me.totalSpeed   = Math.max(0, (me.speed   || 0) + gear.speed   + setBonus.speed);
  me.gearPower    = gear.power + setBonus.power; // legacy read by UI
  me.battleRating = me.totalPower + me.totalDefense + me.totalSpeed;
  return me;
}

function fightCalc(m) {
  const roll = () => Math.random() * 10 - 5; // [-5,+5)
  return m.totalPower * 1.0 + m.totalDefense * 0.8 + m.totalSpeed * 0.6 + roll();
}

function pickRandomOpponent(myId) {
  const ids = Object.keys(state).filter((id) => id !== myId);
  if (!ids.length) return null;
  const id = ids[Math.floor(Math.random() * ids.length)];
  return state[id];
}

// Gender lock helpers
function violatesGenderLock(me, item) {
  if (!item || !item.set) return null;
  if (!me.gender) return "Pick a gender first.";
  if (item.set === "skjaldmey" && me.gender !== "female") return "Skjaldmey is female-only.";
  if (item.set === "drengr" && me.gender !== "male") return "Drengr is male-only.";
  return null;
}

// ================== INSTALL (ROUTES) ==================
function install(app) {
  const router = express.Router();

  // simple auth shim
  router.use((req, res, next) => {
    const uId = req.get("x-user-id");
    if (!uId) return res.status(401).json({ error: "Missing x-user-id" });
    req.userId = uId;
    next();
  });

  // ---- Info
  router.get("/game/me", (req, res) => {
    const me = recompute(tick(ensure(req.userId)));
    res.json({ me });
  });

  router.post("/game/tick", express.json(), (req, res) => {
    const me = recompute(tick(ensure(req.userId)));
    res.json({ me });
  });

  // ---- Train (spends gold, increases base stats)
  router.post("/game/train", express.json(), (req, res) => {
    const me = recompute(tick(ensure(req.userId)));
    const { stat } = req.body || {};
    if (!["power", "defense", "speed"].includes(stat))
      return res.status(400).json({ error: "Invalid stat" });
    if (me.gold < 2)
      return res.status(400).json({ error: "Not enough gold" });
    me.gold -= 2;
    me[stat] += 1;
    me.xp += 2;
    recompute(me);
    res.json({ me });
  });

  // ---- Allocate unspent points (level-ups)
  router.post("/game/allocate", express.json(), (req, res) => {
    const me = recompute(tick(ensure(req.userId)));
    const { stat, amount } = req.body || {};
    if (!["power","defense","speed"].includes(stat)) {
      return res.status(400).json({ error: "Invalid stat" });
    }
    const amt = Math.max(1, Math.floor(Number(amount || 1)));
    const have = Math.max(0, Number(me.points || 0));
    if (have <= 0) return res.status(400).json({ error: "No points" });
    const spend = Math.min(amt, have);
    me.points = have - spend;
    me[stat] = Math.max(0, Number(me[stat] || 0)) + spend;
    recompute(me);
    return res.json({ me });
  });

  // ---- One-time rename
  router.post("/game/rename", express.json(), (req, res) => {
    const me = recompute(tick(ensure(req.userId)));
    if (me.renameUsed) return res.status(400).json({ error: "Rename already used." });
    let { name } = req.body || {};
    if (typeof name !== "string") return res.status(400).json({ error: "Bad name" });
    name = name.trim();
    if (name.length < 2 || name.length > 20) return res.status(400).json({ error: "Name must be 2–20 chars." });
    if (!/^[A-Za-z0-9 _-]+$/.test(name)) return res.status(400).json({ error: "Only letters, numbers, space, _ and -." });
    me.name = name;
    me.renameUsed = true;
    res.json({ me });
  });

  // ---- Gender select
  router.post("/game/gender", express.json(), (req, res) => {
    const me = recompute(tick(ensure(req.userId)));
    const { gender } = req.body || {};
    if (!["female", "male"].includes(gender))
      return res.status(400).json({ error: "Bad gender" });
    me.gender = gender;
    res.json({ me });
  });

  // ---- Shop
  router.get("/game/shop", (req, res) => res.json({ items: getShop() }));

  // Single item details (for slot rendering)
  router.get("/game/item/:id", (req, res) => {
    const it = findItem(req.params.id);
    if (!it) return res.status(404).json({ error: "No such item" });
    res.json({
      id: it.id,
      name: it.name,
      set: it.set,
      slot: it.slot,
      stat: it.stat,
      boost: it.boost,
      cost: it.cost,
      levelReq: it.levelReq,
      rarity: it.rarity,
      description: it.description || `A ${it.name}.`,
      imageUrl: it.imageUrl || `/guildbook/items/${it.id}.png`,
    });
  });

  // ---- Buy & auto-equip (with gender + level + slot locks)
  router.post("/game/shop/buy", express.json(), (req, res) => {
    const me = recompute(tick(ensure(req.userId)));
    const { itemId } = req.body || {};
    const item = findItem(itemId);
    if (!item) return res.status(404).json({ error: "No such item" });

    if (item.levelReq && me.level < item.levelReq)
      return res.status(400).json({ error: `Requires level ${item.levelReq}` });
    if (item.slot && me.level < (SLOT_UNLOCK[item.slot] || 0))
      return res.status(400).json({ error: `Slot locked until level ${SLOT_UNLOCK[item.slot]}` });

    // Gender lock
    const why = violatesGenderLock(me, item);
    if (why) return res.status(400).json({ error: why });

    if (me.gold < item.cost)
      return res.status(400).json({ error: "Not enough gold" });

    me.gold -= item.cost;
    if (item.slot) me.slots[item.slot] = item.id;
    recompute(me);

    res.json({ me, item });
  });

  // ---- PvP
  router.post("/pvp/fight", express.json(), (req, res) => {
    const me = recompute(tick(ensure(req.userId)));
    if (me.level < PVP_UNLOCK)
      return res.status(400).json({ error: `PvP unlocks at level ${PVP_UNLOCK}` });

    const opp = pickRandomOpponent(req.userId);
    if (!opp) return res.status(400).json({ error: "No opponents yet. Get a friend to play!" });

    tick(opp); recompute(opp);

    const myBR = fightCalc(me);
    const opBR = fightCalc(opp);
    const win = myBR >= opBR;

    const deltaGold = win ? 25 : -10;
    const deltaXP   = win ? 50 : 15;

    me.gold = Math.max(0, me.gold + deltaGold);
    me.xp += deltaXP;
    while (me.xp >= me.level * 100) {
      me.xp -= me.level * 100;
      me.level += 1;
      me.points += 3;
    }
    recompute(me);

    res.json({
      me,
      result: {
        win,
        opponent: { id: opp.id, name: opp.name, level: opp.level },
        deltaGold, deltaXP
      }
    });
  });

  // ================== DEV ENDPOINTS ==================
  const dev = express.Router();
  dev.use(express.json());
  dev.use(requireDev);

  dev.get("/me", (req, res) => {
    const me = recompute(tick(ensure(req.userId)));
    res.json({ me, devKeyOk: true, catalogPath: CATALOG_PATH });
  });

  dev.post("/level", (req, res) => {
    const { level } = req.body || {};
    if (!Number.isFinite(level) || level < 1)
      return res.status(400).json({ error: "level must be >=1" });
    const me = ensure(req.userId);
    me.level = Math.floor(level);
    me.xp = 0;
    me.points = 3 * (me.level - 1);
    recompute(me);
    res.json({ me });
  });

  dev.post("/gold", (req, res) => {
    const { add, set } = req.body || {};
    const me = ensure(req.userId);
    if (Number.isFinite(set)) me.gold = Math.max(0, Math.floor(set));
    else if (Number.isFinite(add)) me.gold = Math.max(0, me.gold + Math.floor(add));
    else return res.status(400).json({ error: "Provide add or set" });
    res.json({ me });
  });

  dev.post("/xp", (req, res) => {
    const { add } = req.body || {};
    if (!Number.isFinite(add)) return res.status(400).json({ error: "add number" });
    const me = ensure(req.userId);
    me.xp += Math.floor(add);
    while (me.xp >= me.level * 100) {
      me.xp -= me.level * 100;
      me.level++;
      me.points += 3;
    }
    recompute(me);
    res.json({ me });
  });

  // give/equip item (ignores cost/locks) — still enforce gender lock
  dev.post("/item", (req, res) => {
    const { itemId } = req.body || {};
    const it = findItem(itemId);
    if (!it) return res.status(404).json({ error: "No such item" });
    const me = ensure(req.userId);
    const why = violatesGenderLock(me, it);
    if (why) return res.status(400).json({ error: why });
    if (it.slot) me.slots[it.slot] = it.id;
    recompute(me);
    res.json({ me, item: it });
  });

  // set multiple slots directly — enforce gender lock per slot item
  dev.post("/slots", (req, res) => {
    const { slots } = req.body || {};
    const me = ensure(req.userId);
    if (slots && typeof slots === "object") {
      for (const [slot, itemId] of Object.entries(slots)) {
        const it = findItem(itemId);
        if (!it) continue;
        const why = violatesGenderLock(me, it);
        if (why) return res.status(400).json({ error: why });
      }
      me.slots = { ...me.slots, ...slots };
    }
    recompute(me);
    res.json({ me });
  });

  // quick equip all items from a set — enforce gender lock
  dev.post("/equip-set", (req, res) => {
    const { setId } = req.body || {};
    if (!setId) return res.status(400).json({ error: "setId required" });
    const me = ensure(req.userId);
    const sample = getShop().find(i => i.set === setId);
    if (sample) {
      const why = violatesGenderLock(me, sample);
      if (why) return res.status(400).json({ error: why });
    }
    const items = getShop().filter(i => i.set === setId);
    for (const it of items) {
      if (it.slot) me.slots[it.slot] = it.id;
    }
    recompute(me);
    res.json({ me, equipped: items.map(i => i.id) });
  });

  // drengr convenience — enforce gender lock
  dev.post("/drengr", (req, res) => {
    const me = ensure(req.userId);
    if (me.gender !== "male") return res.status(400).json({ error: "Drengr is male-only." });
    const items = getShop().filter(i => i.set === "drengr");
    for (const it of items) {
      if (it.slot) me.slots[it.slot] = it.id;
    }
    recompute(me);
    res.json({ me, equipped: items.map(i => i.id) });
  });

  // grant unspent points quickly
  dev.post("/points", (req, res) => {
    const { add } = req.body || {};
    if (!Number.isFinite(add)) return res.status(400).json({ error: "add number" });
    const me = ensure(req.userId);
    me.points = Math.max(0, Number(me.points || 0) + Math.floor(add));
    recompute(me);
    res.json({ me });
  });

  // reset user state
  dev.post("/reset", (req, res) => {
    delete state[req.userId];
    res.json({ ok: true });
  });

  router.use("/dev", dev);
  app.use("/api", router);
}

module.exports = { install };

















