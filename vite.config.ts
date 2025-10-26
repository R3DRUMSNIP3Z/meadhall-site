// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { existsSync } from "fs";

// List every HTML you want Vite to consider.
// Each file is included only if it actually exists.
const pages = [
  "index",
  "account",
  "friends",
  "friendprofile",
  "profile",
  "book",
  "meadhall",
];

const inputs: Record<string, string> = {};
for (const name of pages) {
  const p = resolve(__dirname, `${name}.html`);
  if (existsSync(p)) inputs[name] = p;
}

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: inputs,
    },
  },
});





