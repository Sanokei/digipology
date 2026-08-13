import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { SiteHeader } from "../components/SiteHeader";
import { normalizeJoinCode } from "../utils/joinCode";

export function HomePage() {
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState("");

  function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedCode = normalizeJoinCode(joinCode);
    if (normalizedCode.length > 0) {
      navigate(`/join/${encodeURIComponent(normalizedCode)}`);
    }
  }

  return (
    <div className="site-page home-page">
      <SiteHeader />
      <main className="home-main">
        <section className="home-intro" aria-labelledby="home-title">
          <p className="eyebrow">The table is ready</p>
          <h1 id="home-title">
            Play together.
            <br />
            <span>Make the rules yours.</span>
          </h1>
          <p className="home-intro__copy">
            Join a table in seconds, host a game night, or create a tabletop
            experience of your own—right in the browser.
          </p>
        </section>

        <section className="home-actions" aria-label="Start playing">
          <form className="join-panel" onSubmit={handleJoin}>
            <label htmlFor="join-code">Join table</label>
            <div className="join-panel__controls">
              <input
                id="join-code"
                autoComplete="off"
                inputMode="text"
                maxLength={32}
                onChange={(event) => setJoinCode(event.currentTarget.value)}
                placeholder="ENTER CODE"
                value={joinCode}
              />
              <button type="submit" aria-label="Join table with code">
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </form>

          <Link className="action-card action-card--primary" to="/table">
            <span className="action-card__index">01</span>
            <span>
              <strong>Host game</strong>
              <small>Open the table demo</small>
            </span>
            <span className="action-card__arrow" aria-hidden="true">
              ↗
            </span>
          </Link>
          <Link className="action-card" to="/games">
            <span className="action-card__index">02</span>
            <span>
              <strong>Browse games</strong>
              <small>Find something to play</small>
            </span>
            <span className="action-card__arrow" aria-hidden="true">
              →
            </span>
          </Link>
          <Link className="action-card" to="/create">
            <span className="action-card__index">03</span>
            <span>
              <strong>Create a game</strong>
              <small>Build your own tabletop</small>
            </span>
            <span className="action-card__arrow" aria-hidden="true">
              →
            </span>
          </Link>
        </section>
      </main>
      <footer className="home-footer">
        <span>Browser-native tabletop</span>
        <span>Private by default</span>
      </footer>
    </div>
  );
}
