import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { api } from "../api/client";
import type { PublicRoomDto } from "../api/types";
import { HostDialog } from "../components/HostDialog";
import { SiteHeader } from "../components/SiteHeader";
import { isJoinCode, normalizeJoinCode } from "../utils/joinCode";

export function relativeCreatedTime(createdAt: string, now = Date.now()): string {
  const elapsed = Math.max(0, now - new Date(createdAt).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function HomePage() {
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<PublicRoomDto[]>([]);
  const [roomsError, setRoomsError] = useState<string | null>(null);
  const [hosting, setHosting] = useState(false);

  useEffect(() => {
    void api.listPublicRooms().then((result) => result.ok
      ? setRooms(result.value.rooms)
      : setRoomsError(result.error.message));
  }, []);

  function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedCode = normalizeJoinCode(joinCode);
    if (!isJoinCode(normalizedCode)) { setJoinError("Enter an eight-character invite code."); return; }
    navigate(`/join/${encodeURIComponent(normalizedCode)}`);
  }

  return (
    <div className="site-page home-page">
      <SiteHeader />
      <main className="home-main">
        <section className="home-intro" aria-labelledby="home-title">
          <p className="eyebrow">The table is ready</p>
          <h1 id="home-title">Play together.<br /><span>Make the rules yours.</span></h1>
          <p className="home-intro__copy">Join a table in seconds or host a game night—right in the browser.</p>
        </section>
        <section className="home-actions" aria-label="Start playing">
          <form className="join-panel" onSubmit={handleJoin}>
            <label htmlFor="join-code">Join table</label>
            <div className="join-panel__controls">
              <input id="join-code" autoComplete="off" inputMode="text" maxLength={160} onChange={(event) => { setJoinCode(event.currentTarget.value); setJoinError(null); }} placeholder="ABCD-EFGH OR INVITE LINK" value={joinCode} />
              <button type="submit" aria-label="Join table with code"><span aria-hidden="true">→</span></button>
            </div>
            {joinError === null ? null : <p className="inline-error" role="alert">{joinError}</p>}
          </form>
          <button className="action-card action-card--primary" type="button" onClick={() => setHosting(true)}>
            <span className="action-card__index">01</span><span><strong>Host game</strong><small>Start a private or public table</small></span><span className="action-card__arrow" aria-hidden="true">↗</span>
          </button>
          <section className="public-rooms" aria-labelledby="public-rooms-title">
            <div className="section-heading"><div><span className="action-card__index">02</span><h2 id="public-rooms-title">Public rooms</h2></div><Link to="/games">Browse games</Link></div>
            {roomsError === null ? null : <p className="inline-error">Couldn’t load public rooms. {roomsError}</p>}
            {rooms.length === 0 && roomsError === null ? <p className="empty-copy">No public tables are open yet. Host the first one.</p> : null}
            <div className="room-list">{rooms.map((room) => (
              <Link className="room-row" key={room.joinCode} to={`/join/${normalizeJoinCode(room.joinCode)}`}>
                <span><strong>{room.gameTitle}</strong><small>{relativeCreatedTime(room.createdAt)}</small></span>
                <span className="room-row__count">{room.players}/{room.maxPlayers}</span><span aria-hidden="true">→</span>
              </Link>
            ))}</div>
          </section>
        </section>
      </main>
      <footer className="home-footer"><span>Browser-native tabletop</span><span>Private by default</span></footer>
      {hosting ? <HostDialog onClose={() => setHosting(false)} /> : null}
    </div>
  );
}
