import type { CanonicalGameState } from "digipology-kernel";
import { gameProgress } from "../pages/gameProgress";
import "./tableFeedback.css";

export function GameProgressPanel({ state, playerId, onPlayAgain, opening = false, continuationError, continuationHint = "A new table starts a fresh round. Share its new invite with your players." }: { state: CanonicalGameState | null; playerId: string; onPlayAgain?(): void; opening?: boolean; continuationError?: string | null; continuationHint?: string }) {
  const progress = gameProgress(state);
  if (progress.status === null && progress.scores.length === 0) return null;
  return <aside className="game-progress" aria-label="Game progress">
    <p className="game-progress__eyebrow">{progress.winnerId ? "Game complete" : progress.currentPlayerId === playerId ? "Your turn" : "At the table"}</p>
    {progress.status ? <p className="game-progress__status" role="status">{progress.status}</p> : null}
    {progress.scores.length > 0 ? <ol aria-label="Scores">{progress.scores.map((score) => <li key={score.playerId} aria-current={progress.currentPlayerId === score.playerId ? "step" : undefined}>
      <span>{score.name}{score.playerId === playerId ? " (you)" : ""}</span><strong>{score.value}</strong>
    </li>)}</ol> : null}
    {progress.winnerId && onPlayAgain ? <div className="game-progress__continuation"><button type="button" disabled={opening} onClick={onPlayAgain}>{opening ? "Opening new table…" : "Play again"}</button><a href="/">Choose another game</a><small>{continuationHint}</small>{continuationError ? <p role="alert">{continuationError}</p> : null}</div> : null}
  </aside>;
}
