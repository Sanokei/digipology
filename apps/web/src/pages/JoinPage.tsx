import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { SiteHeader } from "../components/SiteHeader";
import { isJoinCode, normalizeJoinCode } from "../utils/joinCode";
import { guestDisplayName, saveGuestDisplayName, saveRoomSession } from "../utils/roomSession";
import { joinErrorKind, joinErrorView, type JoinErrorKind } from "./joinModel";

type JoinStep = "name" | "joining" | "error";

export function JoinPage() {
  const navigate = useNavigate();
  const { code = "" } = useParams();
  const normalizedCode = normalizeJoinCode(code);
  const { user, loading: authLoading } = useAuth();
  const [name, setName] = useState(() => guestDisplayName() ?? "");
  const [step, setStep] = useState<JoinStep>("joining");
  const [errorKind, setErrorKind] = useState<JoinErrorKind>("failed");
  const autoJoinStarted = useRef(false);

  const join = useCallback(async (displayName?: string) => {
    setStep("joining");
    if (displayName) saveGuestDisplayName(displayName);
    const result = await api.joinRoom({ code: normalizedCode, ...(displayName ? { displayName } : {}) });
    if (!result.ok) { setErrorKind(joinErrorKind(result.error.code)); setStep("error"); return; }
    const inviteUrl = result.value.inviteUrl ?? `https://play.digipology.com/join/${normalizedCode}`;
    saveRoomSession({
      ...result.value,
      joinCode: result.value.joinCode ?? normalizedCode,
      inviteUrl,
      gameTitle: "Digipology table",
    });
    navigate(`/table/${encodeURIComponent(result.value.roomId)}`, { replace: true });
  }, [navigate, normalizedCode]);

  useEffect(() => {
    if (authLoading) return;
    if (!isJoinCode(normalizedCode)) { setErrorKind("not_found"); setStep("error"); return; }
    const savedName = guestDisplayName();
    if (user === null && savedName === null) { setStep("name"); return; }
    if (autoJoinStarted.current) return;
    autoJoinStarted.current = true;
    void join(user === null ? savedName ?? undefined : undefined);
  }, [authLoading, join, normalizedCode, user]);

  function submitName(event: FormEvent) {
    event.preventDefault();
    const normalized = name.trim().replaceAll(/\s+/g, " ").slice(0, 64);
    if (normalized) void join(normalized);
  }

  if (step === "joining" || authLoading) return <JoinStatus title="Joining table" description="Checking the invite and finding your seat…" />;
  if (step === "name") return (
    <div className="site-page"><SiteHeader /><main className="auth-page"><section className="dialog-card">
      <p className="eyebrow">Joining {normalizedCode}</p><h1>What should we call you?</h1><p>Guests only need a display name. We’ll remember it for the next table you join.</p>
      <form className="stack-form" onSubmit={submitName}><label htmlFor="display-name">Display name</label><input id="display-name" autoFocus required maxLength={64} value={name} onChange={(event) => setName(event.currentTarget.value)} /><button className="primary-button" type="submit">Join table</button></form>
    </section></main></div>
  );
  const view = joinErrorView(errorKind);
  return (
    <div className="site-page"><SiteHeader /><main className="auth-page"><section className="dialog-card join-error">
      <p className="eyebrow">Invite {normalizedCode}</p><h1>{view.title}</h1><p>{view.message}</p>
      {view.action === "retry" ? <button className="primary-button" type="button" onClick={() => void join(user === null ? guestDisplayName() ?? undefined : undefined)}>{view.actionLabel}</button> : <Link className="button-link" to="/">{view.actionLabel}</Link>}
    </section></main></div>
  );
}

function JoinStatus({ title, description }: { title: string; description: string }) {
  return <div className="join-status"><div className="loading-spinner" /><p className="eyebrow">Room connection</p><h1>{title}</h1><p>{description}</p></div>;
}
