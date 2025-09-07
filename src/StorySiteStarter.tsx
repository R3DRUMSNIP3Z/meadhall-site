// src/StorySiteStarter.tsx
import React, { useState, useEffect } from "react";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  document.querySelector<HTMLMetaElement>('meta[name="api-base"]')?.content ||
  "http://localhost:5050";

interface User {
  id: string;
  name: string;
  email: string;
}

export default function StorySiteStarter() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("user");
    if (saved) setUser(JSON.parse(saved));
  }, []);

  const handleSignup = async () => {
    const name = prompt("Name:");
    const email = prompt("Email:");
    const password = prompt("Password:");
    if (!name || !email || !password) return;

    const res = await fetch(`${API_BASE}/api/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });

    if (!res.ok) {
      alert(await res.text());
      return;
    }
    const data = await res.json();
    setUser(data);
    localStorage.setItem("user", JSON.stringify(data));
    alert(`Welcome, ${data.name}!`);
  };

  const handleCheckout = async (plan: string) => {
    if (!user) {
      alert("Please sign up first.");
      return handleSignup();
    }

    const res = await fetch(`${API_BASE}/api/stripe/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan, userId: user.id }),
    });

    if (!res.ok) {
      alert(await res.text());
      return;
    }
    const { url } = await res.json();
    window.location.href = url;
  };

  return (
    <div className="viking-page" style={{ fontFamily: "serif", color: "#fff", background: "#111" }}>
      <header style={{ textAlign: "center", padding: "20px" }}>
        <h1>ðŸ¹ Mead Hall</h1>
        {user ? (
          <p>Signed in as {user.name}</p>
        ) : (
          <button onClick={handleSignup}>Become a Member</button>
        )}
      </header>

      <main style={{ textAlign: "center" }}>
        <h2>Membership Plans</h2>
        <button onClick={() => handleCheckout("reader")}>ðŸ“– Reader Plan</button>
        <button onClick={() => handleCheckout("premium")}>âš”ï¸ Premium Plan</button>
        <button onClick={() => handleCheckout("annual")}>ðŸ›¡ï¸ Annual Plan</button>
      </main>
    </div>
  );
}












