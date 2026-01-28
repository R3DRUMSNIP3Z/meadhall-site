// /src/global-hero.ts
// Shared hero stats (HP that persists between arena & battles)

export type VAHeroClassId =
  | "warrior"
  | "shieldmaiden"
  | "rune-mage"
  | "berserker"
  | "hunter";

export type VAHeroStats = {
  classId: VAHeroClassId;
  level: number;
  power: number;
  defense: number;
  speed: number;
  maxHealth: number;
  health: number; // current HP
  br?: number;
};

/* =========================================================
   USER + CLASS DETECTION
   ========================================================= */

function __vaHero_getUserId(): string | null {
  try {
    const raw = localStorage.getItem("mh_user");
    if (raw) {
      const obj = JSON.parse(raw);
      return obj?.id || obj?._id || obj?.user?.id || null;
    }
  } catch {}
  try {
    const q = new URLSearchParams(location.search);
    return q.get("user");
  } catch {}
  return null;
}

const __HERO_UID = __vaHero_getUserId() || "guest";
const __heroUserKey = (base: string) => `${base}__${__HERO_UID}`;

const VA_HERO_STATS_KEY_BASE = "va_hero_stats";
const VA_HERO_STATS_KEY = __heroUserKey(VA_HERO_STATS_KEY_BASE);

const CLASS_KEY_BASE = "va_class";

function __hero_detectClass(): VAHeroClassId {
  const raw =
    localStorage.getItem(__heroUserKey(CLASS_KEY_BASE)) ||
    localStorage.getItem(CLASS_KEY_BASE) ||
    "";
  const c = (raw || "").toLowerCase();

  if (c === "shieldmaiden") return "shieldmaiden";
  if (c === "rune-mage") return "rune-mage";
  if (c === "berserker") return "berserker";
  if (c === "hunter") return "hunter";
  return "warrior";
}

/* =========================================================
   DEFAULT STATS
   ========================================================= */

function getDefaultStatsForClass(cls?: VAHeroClassId): VAHeroStats {
  const classId = cls || __hero_detectClass();

  // ⬇️ base stats — you can tweak later
  const base: VAHeroStats = {
    classId,
    level: 1,
    power: 10,
    defense: 5,
    speed: 5,
    maxHealth: 180,
    health: 180,
    br: 0,
  };

  if (classId === "rune-mage") {
    base.power = 14;
    base.defense = 4;
    base.speed = 6;
  } else if (classId === "shieldmaiden") {
    base.power = 11;
    base.defense = 7;
    base.speed = 4;
  } else if (classId === "berserker") {
    base.power = 14;
    base.defense = 4;
    base.speed = 6;
  } else if (classId === "hunter") {
    base.power = 12;
    base.defense = 5;
    base.speed = 7;
  }

  base.br = base.power * 3 + base.defense * 2 + base.maxHealth * 0.5;
  return base;
}

/* =========================================================
   CORE HELPERS
   ========================================================= */

function clampHealth(stats: VAHeroStats): VAHeroStats {
  const maxH = stats.maxHealth ?? 1;
  const cur = stats.health ?? maxH;
  const clamped = Math.max(0, Math.min(maxH, cur));
  return { ...stats, health: clamped };
}

export function VAHeroRead(): VAHeroStats {
  try {
    const cached = (window as any).__VAHeroStats as VAHeroStats | undefined;
    if (cached) return clampHealth(cached);

    const raw = localStorage.getItem(VA_HERO_STATS_KEY);
    if (!raw) {
      const base = getDefaultStatsForClass();
      (window as any).__VAHeroStats = base;
      return base;
    }

    const parsed = JSON.parse(raw) as Partial<VAHeroStats>;
    const merged: VAHeroStats = {
      ...getDefaultStatsForClass(parsed.classId as VAHeroClassId | undefined),
      ...parsed,
    };
    const fixed = clampHealth(merged);
    (window as any).__VAHeroStats = fixed;
    return fixed;
  } catch {
    const fallback = getDefaultStatsForClass();
    (window as any).__VAHeroStats = fallback;
    return fallback;
  }
}

export function VAHeroWrite(partial: Partial<VAHeroStats>): VAHeroStats {
  const current = VAHeroRead();
  const merged: VAHeroStats = clampHealth({
    ...current,
    ...partial,
  });
  try {
    localStorage.setItem(VA_HERO_STATS_KEY, JSON.stringify(merged));
  } catch {}
  (window as any).__VAHeroStats = merged;
  return merged;
}

export function VAHeroReset(cls?: VAHeroClassId): VAHeroStats {
  const base = getDefaultStatsForClass(cls);
  try {
    localStorage.setItem(VA_HERO_STATS_KEY, JSON.stringify(base));
  } catch {}
  (window as any).__VAHeroStats = base;
  return base;
}

/* =========================================================
   WINDOW BRIDGE (so plain scripts can use window.VAHero)
   ========================================================= */

(window as any).VAHero = {
  read: VAHeroRead,
  write: VAHeroWrite,
  reset: VAHeroReset,
  getDefaultForClass: getDefaultStatsForClass,
};

