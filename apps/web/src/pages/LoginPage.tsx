import { type FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "../api/client";
import { loginAfterSubmit, type LoginState } from "./loginModel";

export function LoginPage({ restoreHistory }: { restoreHistory: boolean }) {
  const navigate = useNavigate();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<LoginState>("entry");
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (restoreHistory) navigate(-1);
    else navigate("/", { replace: true });
  }

  useEffect(() => {
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState("sending");
    setError(null);
    const result = await api.requestLink(email.trim());
    setState(loginAfterSubmit(result.ok));
    if (!result.ok) setError(result.error.message);
  }

  return (
    <div className="login-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="login-modal" role="dialog" aria-modal="true" aria-labelledby="login-title">
        <button ref={closeRef} className="login-modal__close" type="button" onClick={close} aria-label="Close sign in">×</button>
        <p className="play-section-eyebrow">Passwordless sign in</p>
        {state === "sent" ? (
          <>
            <h1 id="login-title">Check your email</h1>
            <p>If that address can receive a sign-in link, it’s on the way. You can keep browsing while you wait.</p>
            <button className="play-text-button" type="button" onClick={() => setState("entry")}>Use another email</button>
          </>
        ) : (
          <>
            <h1 id="login-title">Welcome back</h1>
            <p>Enter your email and we’ll send a one-time sign-in link. No password needed.</p>
            <form className="play-stack-form" onSubmit={(event) => void submit(event)}>
              <label htmlFor="email">Email address</label>
              <input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.currentTarget.value)} />
              {error ? <p className="play-inline-error" role="alert">{error}</p> : null}
              <button className="game-hero__cta" type="submit" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Email me a link"}</button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
