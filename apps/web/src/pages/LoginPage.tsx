import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api/client";
import { SiteHeader } from "../components/SiteHeader";
import { loginAfterSubmit, type LoginState } from "./loginModel";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<LoginState>("entry");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState("sending"); setError(null);
    const result = await api.requestLink(email.trim());
    setState(loginAfterSubmit(result.ok));
    if (!result.ok) setError(result.error.message);
  }

  return (
    <div className="site-page">
      <SiteHeader />
      <main className="auth-page">
        <section className="dialog-card" aria-labelledby="login-title">
          <p className="eyebrow">Passwordless sign in</p>
          {state === "sent" ? (
            <>
              <h1 id="login-title">Check your email</h1>
              <p>If that address can receive a sign-in link, it’s on the way. You can close this tab after opening it.</p>
              <button className="text-button" type="button" onClick={() => setState("entry")}>Use another email</button>
            </>
          ) : (
            <>
              <h1 id="login-title">Welcome back</h1>
              <p>Enter your email and we’ll send a one-time sign-in link. No password needed.</p>
              <form className="stack-form" onSubmit={(event) => void submit(event)}>
                <label htmlFor="email">Email address</label>
                <input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.currentTarget.value)} />
                {error === null ? null : <p className="form-error" role="alert">{error}</p>}
                <button className="primary-button" type="submit" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Email me a link"}</button>
              </form>
            </>
          )}
          <Link className="text-link" to="/">Back home</Link>
        </section>
      </main>
    </div>
  );
}
