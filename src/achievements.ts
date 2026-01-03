// src/achievements.ts
export type AchievementUnlock = {
  id: string;
  title?: string;
  description?: string;
  coins?: number;        // coins awarded for this unlock
};

const COIN_KEY = "mh_coins";
const ACHV_PREFIX = "mh_achv:";

// ----- Coins -----
export function getCoins(): number {
  return parseInt(localStorage.getItem(COIN_KEY) || "0", 10) || 0;
}

export function setCoins(value: number) {
  const safe = Math.max(0, Math.floor(value || 0));
  localStorage.setItem(COIN_KEY, String(safe));
  window.dispatchEvent(new Event("mh_coins_changed"));
}

export function addCoins(delta: number) {
  const add = Math.floor(delta || 0);
  if (!add) return;
  setCoins(getCoins() + add);
}

// ----- Achievements -----
export function isUnlocked(id: string): boolean {
  if (!id) return false;
  return localStorage.getItem(ACHV_PREFIX + id) === "1";
}

export function unlockAchievement(data: AchievementUnlock): { unlocked: boolean; coinsAwarded: number } {
  const id = data?.id?.trim();
  if (!id) return { unlocked: false, coinsAwarded: 0 };

  // Idempotent: don't award twice
  if (isUnlocked(id)) return { unlocked: false, coinsAwarded: 0 };

  localStorage.setItem(ACHV_PREFIX + id, "1");

  const coins = Math.max(0, Math.floor(data.coins || 0));
  if (coins) addCoins(coins);

  // Optional metadata (nice for toasts / history)
  if (data.title) localStorage.setItem(`${ACHV_PREFIX + id}:title`, data.title);
  if (data.description) localStorage.setItem(`${ACHV_PREFIX + id}:desc`, data.description);
  if (coins) localStorage.setItem(`${ACHV_PREFIX + id}:coins`, String(coins));
  localStorage.setItem(`${ACHV_PREFIX + id}:time`, new Date().toISOString());

  // Events for UI
  window.dispatchEvent(new CustomEvent("mh_achievement_unlocked", { detail: { ...data, coins } }));
  return { unlocked: true, coinsAwarded: coins };
}

export function getUnlockedIds(): string[] {
  const ids: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i) || "";
    if (k.startsWith(ACHV_PREFIX) && !k.includes(":") && localStorage.getItem(k) === "1") {
      ids.push(k.substring(ACHV_PREFIX.length));
    }
  }
  return ids.sort();
}

export function getAchievementMeta(id: string) {
  const key = ACHV_PREFIX + id;
  return {
    id,
    title: localStorage.getItem(key + ":title") || "",
    description: localStorage.getItem(key + ":desc") || "",
    coins: parseInt(localStorage.getItem(key + ":coins") || "0", 10) || 0,
    time: localStorage.getItem(key + ":time") || ""
  };
}
