// /src/dev-layout.ts
// Dev-only UI mover/resizer for elements on the page.
// Press F5 to toggle edit mode (this overrides normal reload on dev).

type DevLayoutEntry = {
  left: number;
  top: number;
  width?: number;
  height?: number;
};

type DevLayoutStore = {
  [id: string]: DevLayoutEntry;
};

const STORE_KEY = "va_dev_layout_v1";
const DEV_ATTR = "data-dev-edit";

let devMode = false;
let layoutCache: DevLayoutStore | null = null;

function loadLayout(): DevLayoutStore {
  if (layoutCache) return layoutCache;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) {
      layoutCache = {};
    } else {
      layoutCache = JSON.parse(raw);
    }
  } catch {
    layoutCache = {};
  }
  return layoutCache!;
}

function saveLayout() {
  if (!layoutCache) return;
  localStorage.setItem(STORE_KEY, JSON.stringify(layoutCache));
}

function isDevEnvironment(): boolean {
  // Dev only: localhost OR ?dev=1 in the URL
  return (
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.search.includes("dev=1")
  );
}

function applySavedLayout(el: HTMLElement) {
  const id = el.id;
  if (!id) return;

  const store = loadLayout();
  const entry = store[id];
  if (!entry) return;

  if (!el.style.position || el.style.position === "static") {
    el.style.position = "absolute";
  }

  el.style.left = entry.left + "px";
  el.style.top = entry.top + "px";

  if (entry.width != null) el.style.width = entry.width + "px";
  if (entry.height != null) el.style.height = entry.height + "px";
}

/* =========================================================
   DRAG + RESIZE HANDLERS
   ========================================================= */

type ActiveDrag = {
  el: HTMLElement;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
};

type ActiveResize = {
  el: HTMLElement;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
};

let activeDrag: ActiveDrag | null = null;
let activeResize: ActiveResize | null = null;

function onPointerMove(ev: PointerEvent) {
  if (activeDrag) {
    const dx = ev.clientX - activeDrag.startX;
    const dy = ev.clientY - activeDrag.startY;
    const newLeft = activeDrag.startLeft + dx;
    const newTop = activeDrag.startTop + dy;

    activeDrag.el.style.left = newLeft + "px";
    activeDrag.el.style.top = newTop + "px";
  } else if (activeResize) {
    const dx = ev.clientX - activeResize.startX;
    const dy = ev.clientY - activeResize.startY;
    const newWidth = Math.max(20, activeResize.startWidth + dx);
    const newHeight = Math.max(20, activeResize.startHeight + dy);

    activeResize.el.style.width = newWidth + "px";
    activeResize.el.style.height = newHeight + "px";
  }
}

function endInteraction() {
  if (!devMode) {
    activeDrag = null;
    activeResize = null;
    return;
  }

  const store = loadLayout();

  function persist(el: HTMLElement) {
    const id = el.id;
    if (!id) return;

    const rect = el.getBoundingClientRect();
    const left = parseFloat(el.style.left || "0");
    const top = parseFloat(el.style.top || "0");

    const entry: DevLayoutEntry = {
      left: isNaN(left) ? rect.left : left,
      top: isNaN(top) ? rect.top : top,
    };

    // Only save width/height if they’re explicitly set
    if (el.style.width) {
      entry.width = parseFloat(el.style.width);
    }
    if (el.style.height) {
      entry.height = parseFloat(el.style.height);
    }

    store[id] = entry;
    saveLayout();
  }

  if (activeDrag) persist(activeDrag.el);
  if (activeResize) persist(activeResize.el);

  activeDrag = null;
  activeResize = null;
}

function makeElementEditable(el: HTMLElement) {
  el.classList.add("va-dev-edit-target");

  // Ensure absolute for moving
  const computed = getComputedStyle(el);
  if (computed.position === "static") {
    el.style.position = "absolute";
  }

  // DRAG on main element
  el.addEventListener("pointerdown", (ev) => {
    // ignore if clicked on resize handle
    const target = ev.target as HTMLElement;
    if (target && target.classList.contains("va-dev-resize-handle")) return;

    if (!devMode) return;

    ev.preventDefault();
    el.setPointerCapture(ev.pointerId);

    const rect = el.getBoundingClientRect();
    const startLeft = parseFloat(el.style.left || rect.left.toString());
    const startTop = parseFloat(el.style.top || rect.top.toString());

    activeDrag = {
      el,
      startX: ev.clientX,
      startY: ev.clientY,
      startLeft,
      startTop,
    };
  });

  // RESIZE HANDLE (bottom-right tiny box)
  let handle = el.querySelector<HTMLElement>(".va-dev-resize-handle");
  if (!handle) {
    handle = document.createElement("div");
    handle.className = "va-dev-resize-handle";
    el.appendChild(handle);
  }

  handle.addEventListener("pointerdown", (ev) => {
    if (!devMode) return;

    ev.stopPropagation();
    ev.preventDefault();
    handle!.setPointerCapture(ev.pointerId);

    const rect = el.getBoundingClientRect();

    const startWidth =
      parseFloat(el.style.width || rect.width.toString()) || rect.width;
    const startHeight =
      parseFloat(el.style.height || rect.height.toString()) || rect.height;

    activeResize = {
      el,
      startX: ev.clientX,
      startY: ev.clientY,
      startWidth,
      startHeight,
    };
  });
}

/* =========================================================
   MODE TOGGLE
   ========================================================= */

function enableDevMode() {
  devMode = true;
  document.body.classList.add("va-dev-mode");

  const store = loadLayout();
  console.log("[VA DEV] Layout editor ON", store);

  document
    .querySelectorAll<HTMLElement>(`[${DEV_ATTR}="1"]`)
    .forEach((el) => {
      if (!el.id) {
        console.warn(
          "[VA DEV] Element with data-dev-edit=1 requires an id:",
          el
        );
        return;
      }
      applySavedLayout(el);
      makeElementEditable(el);
    });

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", endInteraction);
  window.addEventListener("pointercancel", endInteraction);
}

function disableDevMode() {
  devMode = false;
  document.body.classList.remove("va-dev-mode");

  activeDrag = null;
  activeResize = null;

  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", endInteraction);
  window.removeEventListener("pointercancel", endInteraction);
}

export function installDevLayoutEditor() {
  if (!isDevEnvironment()) {
    console.log("[VA DEV] Layout editor disabled (not dev env).");
    return;
  }

  console.log(
    "[VA DEV] Layout editor ready. Press F5 to toggle (dev override)."
  );

  window.addEventListener(
    "keydown",
    (ev) => {
      if (ev.key === "F5" && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
        // Dev override: prevent normal reload on plain F5
        ev.preventDefault();
        if (devMode) {
          disableDevMode();
        } else {
          enableDevMode();
        }
      }
    },
    { passive: false }
  );
}
