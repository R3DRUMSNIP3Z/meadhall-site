// /src/yggdrasil-ui.ts
type YggSkill = {
  id: "basic" | "aoe" | "buff" | "debuff";
  name: string;
  desc: string;
  icon: string;
  unlockedAtLevel: number;
};

type VAYggState = {
  classId: string;
  pathName: string;
  level: number;
  skills: YggSkill[];    // unlocked
  allSkills: YggSkill[]; // all 4
};

function getYggState(): VAYggState | null {
  return (window as any).VAYggdrasil || null;
}

function syncYggUiFromState() {
  const st = getYggState();
  if (!st) return;

  // title
  const title = document.getElementById("yggPathTitle");
  if (title) title.textContent = st.pathName;

  // POINTS label (optional – you already show this via game.ts)
  const pts = document.getElementById("yggPoints");
  const me = (window as any).state?.me as { points?: number } | undefined;
  if (pts && me) pts.textContent = String(me.points ?? 0);

  // one card per slot: data-ygg-slot="basic|aoe|buff|debuff"
  st.allSkills.forEach((sk) => {
    const card = document.querySelector<HTMLElement>(
      `.ygg-card[data-ygg-slot="${sk.id}"]`
    );
    if (!card) return;

    const nameEl = card.querySelector<HTMLElement>(".ygg-name");
    const descEl = card.querySelector<HTMLElement>(".ygg-desc");
    const iconEl = card.querySelector<HTMLImageElement>(".ygg-icon");
    const tagEl  = card.querySelector<HTMLElement>(".ygg-tag"); // e.g. "INNATE", "LOCKED"

    if (nameEl) nameEl.textContent = sk.name;
    if (descEl) descEl.textContent = sk.desc;
    if (iconEl && sk.icon) {
      iconEl.src = sk.icon;
      iconEl.alt = sk.name;
    }

    const isUnlocked = st.level >= (sk.unlockedAtLevel ?? 1);
    if (tagEl) {
      tagEl.textContent = isUnlocked ? "Unlocked" : `Unlocks at Lv.${sk.unlockedAtLevel}`;
    }

    // optional: disable/enable the Unlock button
    const btn = card.querySelector<HTMLButtonElement>(".ygg-unlock");
    if (btn) {
      btn.disabled = !isUnlocked;
    }
  });
}

// Run once on load & whenever game.ts refreshes VAYggdrasil
window.addEventListener("DOMContentLoaded", () => {
  syncYggUiFromState();
});

window.addEventListener("va-yggdrasil-updated", () => {
  syncYggUiFromState();
});
