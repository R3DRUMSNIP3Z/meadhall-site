import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
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


