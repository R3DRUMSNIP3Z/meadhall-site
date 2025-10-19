// /src/friendprofile.ts
type SafeUser = {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string;
  bio?: string;
  interests?: string;
  createdAt?: number;
};

type Story = {
  id?: string;
  title?: string;
  text?: string;
  excerpt?: string;
  imageUrl?: string;
  createdAt?: number;
};

/* ---------- helpers ---------- */
function pickApiBase(): string {
  const m = (document.querySelector('meta[name="api-base"]') as HTMLMetaElement)?.content?.trim();
  // @ts-ignore vite env support
  return m || (import.meta?.env?.VITE_API_BASE ?? "");
}

function qs(k: string) {
  const v = new URLSearchParams(location.search).get(k);
  return v && v.trim() ? v.trim() : null;
}
function fmt(ts?: number) {
  if (!ts) return "";
  try { return new Date(ts).toLocaleString(); } catch { return ""; }
}
function esc(s: any) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;", '"':"&quot;","'":"&#39;" }[c]!));
}
function nl2br(s: string) {
  return esc(s).replace(/\n/g, "<br>");
}

/* ensure /uploads/... is correct */
function makeFullUrl(API: string, p?: string | null): string | null {
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) return p; // already full
  const base = API.replace(/\/+$/, "");
  const path = String(p).replace(/^\/+/, "");
  // if missing uploads prefix, add it
  return `${base}/${path.startsWith("uploads") ? path : "uploads/" + path}`;
}
function bust(u: string | null) {
  return u ? `${u}${u.includes("?") ? "&" : "?"}t=${Date.now()}` : u;
}

/* ---------- DOM ---------- */
const avatarImg  = document.getElementById("avatar") as HTMLImageElement;
const nameH1     = document.getElementById("username") as HTMLElement;
const emailSmall = document.getElementById("useremail") as HTMLElement;
const introCard  = document.getElementById("introCard") as HTMLElement;
const joinedRow  = document.getElementById("joinedRow") as HTMLElement;
const interestsRow = document.getElementById("interestsRow") as HTMLElement;
const bioRow     = document.getElementById("bioRow") as HTMLElement;
const sagaList   = document.getElementById("sagaList") as HTMLElement;
const companionsEl = document.getElementById("companionsList") as HTMLElement;
const galleryGrid  = document.getElementById("galleryGrid") as HTMLElement;

/* ---------- Tabs ---------- */
const tabLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('.tabs a[data-tab]'));
const sections: Record<string, HTMLElement> = {
  stories: document.getElementById("tab-stories") as HTMLElement,
  companions: document.getElementById("tab-companions") as HTMLElement,
  gallery: document.getElementById("tab-gallery") as HTMLElement,
};
function showTab(tab: "stories"|"companions"|"gallery") {
  tabLinks.forEach(a => a.classList.toggle("active", a.dataset.tab === tab));
  Object.entries(sections).forEach(([k, el]) => el.classList.toggle("active", k === tab));
}
tabLinks.forEach(a=>{
  a.addEventListener("click",(e)=>{
    e.preventDefault();
    const t = (e.currentTarget as HTMLAnchorElement).dataset.tab as any;
    showTab(t);
  });
});

/* ---------- API ---------- */
async function loadUser(API:string,id:string):Promise<SafeUser>{
  const r = await fetch(`${API}/api/users/${encodeURIComponent(id)}`);
  if(!r.ok) throw new Error(`User ${r.status}`);
  return await r.json();
}
async function loadStories(API:string,id:string):Promise<Story[]>{
  const r = await fetch(`${API}/api/users/${encodeURIComponent(id)}/stories`);
  const raw = await r.json();
  const list = Array.isArray(raw)?raw:(raw?.items??[]);
  return list.map((s:Story)=>({...s,imageUrl:s.imageUrl?makeFullUrl(API,s.imageUrl)??s.imageUrl:undefined}));
}

/* ---------- MAIN ---------- */
async function main(){
  const API = pickApiBase();
  const userId = qs("user");
  if(!userId||!API){ sagaList.innerHTML="Missing info"; return; }

  try{
    const user = await loadUser(API,userId);
    const avatar = bust(makeFullUrl(API,user.avatarUrl)) || "/logo/logo-512.png";
    console.log("Avatar path resolved:", avatar);

    avatarImg.src = avatar;
    avatarImg.alt = user.name || "avatar";
    avatarImg.onerror = () => { avatarImg.src = "/logo/logo-512.png"; };

    nameH1.textContent = `Saga of ${user.name||"Wanderer"}`;
    emailSmall.textContent = user.email || "";

    if(user.createdAt) joinedRow.textContent = `Joined the Hall on ${new Date(user.createdAt).toLocaleDateString()}`;
    if(user.interests) interestsRow.textContent = `Interests: ${user.interests}`;
    if(user.bio) bioRow.textContent = user.bio;
    introCard.style.display = (user.bio||user.interests||user.createdAt) ? "" : "none";

    const stories = await loadStories(API,userId);
    sagaList.innerHTML = stories.length ? stories.map(s=>`
      <article class="saga">
        <div class="top"><h3>${esc(s.title||"(untitled)")}</h3><time>${fmt(s.createdAt)}</time></div>
        <div class="excerpt">${esc(s.excerpt||s.text?.slice(0,150)||"")}</div>
      </article>`).join("") : `<div>No sagas yet.</div>`;

  }catch(e:any){
    sagaList.innerHTML=`Error: ${esc(e.message||e)}`;
  }
}
main();

















