// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { existsSync } from "fs";

const html = (...p: string[]) => {
  const f = resolve(__dirname, ...p);
  return existsSync(f) ? f : undefined;
};

const inputs: Record<string, string> = {
  main:          resolve(__dirname, "index.html"),
  account:       html("account.html")!,
  friends:       html("friends.html")!,
  friendprofile: html("friendprofile.html")!,
  profile:       html("profile.html")!,
  book:          html("book.html")!,
  meadhall:      html("meadhall.html")!,
  game:          html("game.html")!,        // ← ✅ add this line
  shop:          html("shop.html")!,   // ← add this line
  brisingrshop:  html("brisingrshop.html")!,  // ✅ Add this line
    quests:        html("quests.html")!,        // ✅ add this line for Quests page
      dreadheimmap:  html("dreadheimmap.html")!,




};
// drop undefined entries
Object.keys(inputs).forEach((k) => inputs[k] === undefined && delete inputs[k]);

export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { input: inputs } },
});





