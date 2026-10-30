import type { KeyboardEvent } from "react";
import type { CanonicalGameState } from "digipology-kernel";
import { gameProgress } from "../pages/gameProgress";
import "./tableFeedback.css";

function scrollStatus(event: KeyboardEvent<HTMLParagraphElement>) {
  if (event.altKey || event.metaKey || event.currentTarget.scrollHeight <= event.currentTarget.clientHeight) return;
  const element = event.currentTarget, page = element.clientHeight * 0.9;
  const top = event.key === "End" ? element.scrollHeight : event.key === "Home" ? 0
    : event.key === "PageDown" ? element.scrollTop + page : event.key === "PageUp" ? element.scrollTop - page
    : event.key === "ArrowDown" ? element.scrollTop + 24 : event.key === "ArrowUp" ? element.scrollTop - 24
    : event.key === " " ? element.scrollTop + (event.shiftKey ? -page : page) : null;
  if (top !== null) { event.preventDefault(); event.stopPropagation(); element.scrollTop = top; }
}

export function GameProgressPanel({ state, playerId, onPlayAgain, opening = false, continuationError, continuationHint = "A new table starts a fresh round. Share its new invite with your players.", compact = false }: { state: CanonicalGameState | null; playerId: string; onPlayAgain?(): void; opening?: boolean; continuationError?: string | null; continuationHint?: string; compact?: boolean }) {
  const progress = gameProgress(state);
  if (progress.status === null && progress.scores.length === 0) return null;
  return <aside className={`game-progress${compact ? " game-progress--compact" : ""}`} aria-label="Game progress">
    <p className="game-progress__eyebrow">{progress.winnerId ? "Game complete" : progress.currentPlayerId === playerId ? "Your turn" : "At the table"}</p>
    {progress.status ? <p className="game-progress__status" role="status" tabIndex={compact ? 0 : undefined} onKeyDown={compact ? scrollStatus : undefined}>{progress.status}</p> : null}
    {progress.scores.length > 0 ? <ol aria-label="Scores" tabIndex={compact ? 0 : undefined}>{progress.scores.map((score) => <li key={score.playerId} aria-current={progress.currentPlayerId === score.playerId ? "step" : undefined}>
      <span>{score.name}{score.playerId === playerId ? " (you)" : ""}</span><strong>{score.value}</strong>
    </li>)}</ol> : null}
    {progress.winnerId && onPlayAgain ? <div className="game-progress__continuation"><button type="button" disabled={opening} onClick={onPlayAgain}>{opening ? "Opening new table…" : "Play again"}</button><a href="/">Choose another game</a><small>{continuationHint}</small>{continuationError ? <p role="alert">{continuationError}</p> : null}</div> : null}
  </aside>;
}
