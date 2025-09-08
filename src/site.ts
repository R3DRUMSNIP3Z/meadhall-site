import { post } from "./base";

function q<T extends HTMLElement>(sel: string): T | null { return document.querySelector<T>(sel); }
function gid<T extends HTMLElement>(id: string): T | null { return document.getElementById(id) as any; }
function flash(msg: string) {
  const box = q<HTMLElement>("[data-flash]");
  if (box) { box.textContent = msg; box.style.display = "block"; } else alert(msg);
}

document.addEventListener("DOMContentLoaded", () => {
  const signupForm = gid<HTMLFormElement>("signupForm");
  if (signupForm) {
    signupForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = (gid<HTMLInputElement>("signupName")?.value || "").trim();
      const email = (gid<HTMLInputElement>("signupEmail")?.value || "").trim();
      const password = gid<HTMLInputElement>("signupPassword")?.value || "";
      if (!name || !email || !password) return flash("Please fill all fields.");
      try {
        await post("/api/users", { name, email, password });
        flash("Signed up! You can log in now.");
      } catch (err: any) {
        flash(`Signup failed: ${err.message || err}`);
      }
    });
  }

  const loginForm = gid<HTMLFormElement>("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = (gid<HTMLInputElement>("loginEmail")?.value || "").trim();
      const password = gid<HTMLInputElement>("loginPassword")?.value || "";
      if (!email || !password) return flash("Please enter email and password.");
      try {
        const res = await post("/api/auth/login", { email, password });
        flash(`Welcome, ${res?.name || "user"}!`);
      } catch (err: any) {
        flash(`Login failed: ${err.message || err}`);
      }
    });
  }
});
