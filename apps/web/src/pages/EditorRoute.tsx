import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "react-router-dom";

const DesktopEditor = lazy(async () => ({ default: (await import("../editor/EditorPage")).EditorPage }));
const DESKTOP_EDITOR_QUERY = "(min-width: 900px) and (pointer: fine)";

export function isDesktopEditorEnvironment(matchMedia: Pick<Window, "matchMedia"> | undefined = typeof window === "undefined" ? undefined : window): boolean {
  return matchMedia?.matchMedia(DESKTOP_EDITOR_QUERY).matches ?? false;
}

export function EditorRoute() {
  const [desktop, setDesktop] = useState(isDesktopEditorEnvironment);
  useEffect(() => {
    const query = window.matchMedia(DESKTOP_EDITOR_QUERY);
    const update = () => setDesktop(query.matches);
    update(); query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  if (!desktop) return <main className="editor-mobile-gate"><div><p className="eyebrow">Desktop editor</p><h1>The editor needs a desktop browser — your games and drafts are waiting for you there</h1><p>You can keep playing and browsing from this device.</p><nav><Link className="primary-button" to="/">Back to play</Link><Link className="secondary-button" to="/games">Browse games</Link></nav></div></main>;
  return <Suspense fallback={<div className="table-loading">Opening your draft…</div>}><DesktopEditor /></Suspense>;
}
