import type { CanonicalGameState } from "digipology-kernel";
import { gameProgress } from "../pages/gameProgress";
import "./tableFeedback.css";

export function GameProgressPanel({ state, playerId }: { state: CanonicalGameState | null; playerId: string }) {
  const progress = gameProgress(state);
  if (progress.status === null && progress.scores.length === 0) return null;
  return <aside className="game-progress" aria-label="Game progress">
    <p className="game-progress__eyebrow">{progress.winnerId ? "Game complete" : progress.currentPlayerId === playerId ? "Your turn" : "At the table"}</p>
    {progress.status ? <p className="game-progress__status" role="status">{progress.status}</p> : null}
    {progress.scores.length > 0 ? <ol aria-label="Scores">{progress.scores.map((score) => <li key={score.playerId} aria-current={progress.currentPlayerId === score.playerId ? "step" : undefined}>
      <span>{score.name}{score.playerId === playerId ? " (you)" : ""}</span><strong>{score.value}</strong>
    </li>)}</ol> : null}
  </aside>;
}
