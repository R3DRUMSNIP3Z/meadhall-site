import { useState } from "react";

// --- Simple in-file data (swap with real CMS later) ---
const GENRES = [
  { key: "horror", label: "Horror" },
  { key: "romance", label: "Romance" },
  { key: "fantasy", label: "Fantasy" },
];

const STORIES = [
  {
    id: "h1",
    title: "Room 313",
    genre: "horror",
    blurb: "A late-night janitor unlocks a door that isn't on the floor plan.",
    content:
      "The key turned with a soft metallic sigh. Behind Room 313, the hallway air was colder, like the building was holding its breath...",
    cover:
      "https://images.unsplash.com/photo-1519681393784-d120267933ba?q=80&w=1600&auto=format&fit=crop",
  },
  {
    id: "r1",
    title: "Café de Medianoche",
    genre: "romance",
    blurb: "Two strangers keep meeting at 12:03 a.m. when the neon flickers on.",
    content:
      "The bell above the door never rang at midnight, except when she walked in. The steam from the espresso made halos around her hair...",
    cover:
      "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?q=80&w=1600&auto=format&fit=crop",
  },
  {
    id: "f1",
    title: "Ash & Anthems",
    genre: "fantasy",
    blurb: "A forbidden song wakes the sleeping walls of a ruined citadel.",
    content:
      "They told the apprentices never to hum in the archives. Sound is a chisel, the masters said, and the stones remember...",
    cover:
      "https://images.unsplash.com/photo-1501785888041-af3ef285b470?q=80&w=1600&auto=format&fit=crop",
  },
];

export default function StorySiteStarter() {
  const [genre, setGenre] = useState(GENRES[0].key);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showContest, setShowContest] = useState(false);
  const [entry, setEntry] = useState({ title: "", email: "", genre: GENRES[0].key, text: "" });
  const [agree, setAgree] = useState(false);

  const filtered = STORIES.filter((s) => s.genre === genre);
  const openStory = STORIES.find((s) => s.id === openId);

  function openCheckout() {
    // TODO: replace with your Stripe Checkout link (Price for $1 one-time)
    window.location.href = "#checkout-$1";
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      {/* NAV */}
      <header className="sticky top-0 z-40 backdrop-blur bg-neutral-950/70 border-b border-neutral-800">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="h-9 w-9 rounded-2xl bg-neutral-800 grid place-items-center text-lg">✦</span>
            <h1 className="text-xl font-semibold tracking-wide">Midnight Stories</h1>
          </div>
          <nav className="hidden sm:flex gap-6 text-sm text-neutral-300">
            <a href="#genres" className="hover:text-white">Genres</a>
            <a href="#samples" className="hover:text-white">Samples</a>
            <a href="#pricing" className="hover:text-white">Pricing</a>
            <a href="#faq" className="hover:text-white">FAQ</a>
          </nav>
          <a href="#pricing" className="px-4 py-2 rounded-2xl bg-white text-black font-medium hover:opacity-90">Subscribe</a>
        </div>
      </header>

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.12),transparent_40%),radial-gradient(circle_at_70%_80%,rgba(255,255,255,0.06),transparent_40%)]" />
        <div className="max-w-6xl mx-auto px-4 py-20">
          <div className="max-w-2xl">
            <h2 className="text-4xl sm:text-5xl font-bold leading-tight">Fresh short stories, every week.</h2>
            <p className="mt-4 text-neutral-300">
              Horror that crawls under your skin. Romance that warms the room. Fantasy that opens hidden doors. All in one membership.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href="#pricing" className="px-5 py-3 rounded-2xl bg-white text-black font-semibold">Start your subscription</a>
              <a href="#samples" className="px-5 py-3 rounded-2xl border border-neutral-700 hover:border-neutral-500">Read free samples</a>
            </div>
            <p className="mt-3 text-sm text-neutral-400">Cancel anytime • Keep downloads • Members-only audio narration</p>
          </div>
        </div>
      </section>

      {/* GENRE TABS */}
      <section id="genres" className="max-w-6xl mx-auto px-4 pt-4 pb-2">
        <div className="flex gap-2 flex-wrap">
          {GENRES.map((g) => (
            <button
              key={g.key}
              onClick={() => setGenre(g.key)}
              className={`px-4 py-2 rounded-2xl border ${genre === g.key ? "bg-white text-black border-white" : "border-neutral-700 hover:border-neutral-500"}`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </section>

      {/* SAMPLES GRID */}
      <section id="samples" className="max-w-6xl mx-auto px-4 pb-14">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-4">
          {filtered.map((s) => (
            <article key={s.id} className="rounded-2xl overflow-hidden border border-neutral-800 bg-neutral-900/40">
              <div className="aspect-[16/9] overflow-hidden">
                <img src={s.cover} alt="cover" className="h-full w-full object-cover hover:scale-105 transition-transform" />
              </div>
              <div className="p-4">
                <h3 className="text-lg font-semibold">{s.title}</h3>
                <p className="text-sm text-neutral-300 mt-1 line-clamp-2">{s.blurb}</p>
                <div className="mt-4 flex items-center justify-between">
                  <button onClick={() => setOpenId(s.id)} className="text-sm underline underline-offset-4">Read sample</button>
                  <a href="#pricing" className="text-sm px-3 py-1.5 rounded-xl bg-white text-black font-medium">Subscribe</a>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="border-t border-neutral-800 bg-neutral-900/30">
        <div className="max-w-6xl mx-auto px-4 py-16">
          <h4 className="text-2xl font-bold">Membership</h4>
          <p className="text-neutral-300 mt-2">Get weekly stories + audio narration + downloads.</p>
          <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="rounded-2xl border border-neutral-800 p-6 bg-neutral-900/40">
              <h5 className="text-lg font-semibold">Reader</h5>
              <p className="text-sm text-neutral-300 mt-1">All weekly stories</p>
              <div className="text-3xl font-bold mt-4">$7<span className="text-base font-medium text-neutral-400">/mo</span></div>
              <a href="#checkout" className="mt-5 inline-block px-4 py-2 rounded-xl bg-white text-black font-semibold">Join Reader</a>
            </div>
            <div className="rounded-2xl border border-neutral-700 p-6 bg-neutral-100 text-neutral-900">
              <h5 className="text-lg font-bold">Reader + Audio</h5>
              <p className="text-sm mt-1">Stories + narrated audio + early access</p>
              <div className="text-3xl font-extrabold mt-4">$12<span className="text-base font-medium text-neutral-600">/mo</span></div>
              <a href="#checkout" className="mt-5 inline-block px-4 py-2 rounded-xl bg-neutral-900 text-white font-semibold">Join Premium</a>
            </div>
            <div className="rounded-2xl border border-neutral-800 p-6 bg-neutral-900/40">
              <h5 className="text-lg font-semibold">Annual</h5>
              <p className="text-sm text-neutral-300 mt-1">2 months free (billed yearly)</p>
              <div className="text-3xl font-bold mt-4">$70<span className="text-base font-medium text-neutral-400">/yr</span></div>
              <a href="#checkout" className="mt-5 inline-block px-4 py-2 rounded-xl bg-white text-black font-semibold">Go Annual</a>
            </div>
          </div>
          <p className="text-xs text-neutral-400 mt-4">* Replace buttons with Stripe/Lemon Squeezy checkout links.</p>
        </div>
      </section>

      {/* CONTEST */}
      <section id="contest" className="max-w-6xl mx-auto px-4 py-16">
        <div className="flex flex-col lg:flex-row gap-8">
          <div className="flex-1">
            <h4 className="text-2xl font-bold">Story of the Month — Win $100</h4>
            <p className="text-neutral-300 mt-2">
              Submit your original short story for a chance to be featured as our <strong>Story of the Month</strong> and win <strong>$100</strong>.
            </p>
            <ul className="mt-4 list-disc pl-5 text-neutral-300 space-y-1 text-sm">
              <li>Length: 800–2,500 words</li>
              <li>Genres: Horror, Romance, or Fantasy</li>
              <li>Deadline: last day of each month, 11:59pm ET</li>
              <li>Judging: editorial review using a published rubric (not random)</li>
            </ul>
            <div className="mt-6 flex gap-3">
              <button onClick={() => setShowContest(true)} className="px-5 py-3 rounded-2xl bg-white text-black font-semibold">Enter your story</button>
              <a href="#contest-rules" className="px-5 py-3 rounded-2xl border border-neutral-700 hover:border-neutral-500">Contest rules</a>
            </div>
            <p className="mt-3 text-xs text-neutral-400">No purchase necessary where prohibited. See rules for details.</p>
          </div>

          <div className="flex-1 rounded-2xl border border-neutral-800 p-6 bg-neutral-900/40">
            <h5 className="text-lg font-semibold">Monthly Member Reward</h5>
            <p className="text-neutral-300 mt-2 text-sm">All active subscribers are automatically entered into a monthly members-only drawing for bonus perks (e.g., exclusive stories, art prints, or gift cards).</p>
            <p className="text-xs text-neutral-400 mt-2">* Perks vary by month; no cash alternative. See rules.</p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="max-w-6xl mx-auto px-4 py-16">
        <h4 className="text-2xl font-bold">FAQ</h4>
        <div className="mt-6 grid sm:grid-cols-2 gap-6">
          <div>
            <p className="font-medium">How often do I get new stories?</p>
            <p className="text-neutral-300">Every week. You can read on-site or download.</p>
          </div>
          <div>
            <p className="font-medium">Can I cancel anytime?</p>
            <p className="text-neutral-300">Yes. You keep what you've already downloaded.</p>
          </div>
          <div>
            <p className="font-medium">Do I get audio versions?</p>
            <p className="text-neutral-300">On Premium and Annual plans. We add narration to new releases.</p>
          </div>
          <div>
            <p className="font-medium">Do I own the stories?</p>
            <p className="text-neutral-300">You get a personal-use license. Resale or redistribution isn’t allowed.</p>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-neutral-800">
        <div className="max-w-6xl mx-auto px-4 py-10 text-sm text-neutral-400 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p>© {new Date().getFullYear()} Midnight Stories. All rights reserved.</p>
          <div className="flex gap-4">
            <a href="#contest-rules" className="hover:text-white">Contest Rules</a>
            <a href="#" className="hover:text-white">Terms</a>
            <a href="#" className="hover:text-white">Privacy</a>
            <a href="#" className="hover:text-white">Contact</a>
          </div>
        </div>
      </footer>

      {/* STORY MODAL */}
      {openStory && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm grid place-items-center p-4" onClick={() => setOpenId(null)}>
          <div className="max-w-2xl w-full bg-neutral-900 border border-neutral-700 rounded-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="h-40 overflow-hidden">
              <img src={openStory.cover} alt="cover" className="w-full h-full object-cover" />
            </div>
            <div className="p-5">
              <h3 className="text-xl font-bold">{openStory.title}</h3>
              <p className="mt-3 whitespace-pre-line text-neutral-200 leading-relaxed">{openStory.content}</p>
              <div className="mt-6 flex items-center justify-between">
                <button onClick={() => setOpenId(null)} className="px-4 py-2 rounded-xl border border-neutral-700">Close</button>
                <a href="#pricing" className="px-4 py-2 rounded-xl bg-white text-black font-semibold">Unlock full story</a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CONTEST ENTRY MODAL */}
      {showContest && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm grid place-items-center p-4" onClick={() => setShowContest(false)}>
          <div className="max-w-2xl w-full bg-neutral-900 border border-neutral-700 rounded-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-5">
              <h3 className="text-xl font-bold">Enter Story of the Month ($100 prize)</h3>
              <p className="text-sm text-neutral-300 mt-1">Original work only. 800–2,500 words. Horror, Romance, or Fantasy.</p>
              <div className="mt-4 grid gap-3">
                <input className="px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700" placeholder="Story title" value={entry.title} onChange={(e)=>setEntry({...entry,title:e.target.value})} />
                <input className="px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700" placeholder="Your email (for winner contact)" value={entry.email} onChange={(e)=>setEntry({...entry,email:e.target.value})} />
                <select className="px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700" value={entry.genre} onChange={(e)=>setEntry({...entry,genre:e.target.value})}>
                  {GENRES.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
                </select>
                <textarea rows={10} className="px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700" placeholder="Paste your story here (800–2,500 words)" value={entry.text} onChange={(e)=>setEntry({...entry,text:e.target.value})} />
                <label className="flex items-start gap-2 text-sm text-neutral-300">
                  <input type="checkbox" className="mt-1" checked={agree} onChange={(e)=>setAgree(e.target.checked)} />
                  <span>I confirm this is my original work and I agree to the <a href="#contest-rules" className="underline">Contest Rules</a>.</span>
                </label>
                <div className="flex items-center justify-between mt-2">
                  <button onClick={()=>setShowContest(false)} className="px-4 py-2 rounded-xl border border-neutral-700">Close</button>
                  <div className="flex gap-2">
                    <button disabled={!agree || !entry.title || !entry.email || !entry.text} onClick={openCheckout} className="px-4 py-2 rounded-xl bg-white text-black font-semibold disabled:opacity-50">Pay $1 & Submit</button>
                  </div>
                </div>
                <p className="text-xs text-neutral-400">Payment handled by Stripe. Your entry is recorded after payment succeeds.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



