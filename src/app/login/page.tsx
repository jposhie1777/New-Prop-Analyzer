"use client";

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signIn = async (submitEvent: React.FormEvent) => {
    submitEvent.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const nextPath = new URLSearchParams(window.location.search).get("next") ?? "/";
      const response = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, next: nextPath }) });
      const body = (await response.json()) as { next?: string; error?: string };
      if (!response.ok) {
        setError(body.error ?? "Could not sign in");
        return;
      }
      window.location.assign(body.next ?? "/"); // full load so every request carries the new cookie
    } catch {
      setError("Network error, try again");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="page" style={{ maxWidth: 420 }}>
      <form className="card stack" style={{ gap: 12, marginTop: 40 }} onSubmit={signIn}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Pulse NBA</h1>
        <p className="faint small" style={{ margin: 0 }}>
          Private site. Enter the password to continue; this device stays signed in for a year.
        </p>
        <label className="stack" style={{ gap: 6 }}>
          <span className="small muted">Password</span>
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(changeEvent) => setPassword(changeEvent.target.value)} autoFocus />
        </label>
        {error ? <div className="negative small">{error}</div> : null}
        <button className="button primary" type="submit" disabled={busy || password.length === 0}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
