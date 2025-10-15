// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main:          resolve(__dirname, "index.html"),
        account:       resolve(__dirname, "account.html"),
        friends:       resolve(__dirname, "friends.html"),
        friendprofile: resolve(__dirname, "friendprofile.html"),
        profile:       resolve(__dirname, "profile.html"),
        book:          resolve(__dirname, "book.html"),
        // ❌ remove or comment out these:
        // meadhall: resolve(__dirname, "meadhall.html"),
        // library:  resolve(__dirname, "library.html"),
      },
    },
  },
});


