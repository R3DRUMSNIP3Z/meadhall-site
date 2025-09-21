import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        account: resolve(__dirname, "account.html"),
        friends: resolve(__dirname, "friends.html"),
        friendprofile: resolve(__dirname, "friendprofile.html"),
        profile: resolve(__dirname, "profile.html"),
      },
    },
  },
});

