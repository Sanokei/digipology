import { useReducer, useState } from "react";
import type { OwnedGameDto } from "digipology-protocol/http";
import { api } from "../api/client";
import { ArtworkDialog } from "../components/ArtworkDialog";
import { artworkBlob } from "../editor/state/artwork";
import { Link } from "react-router-dom";
import {
  initialCoverPickerState,
  rasterizeAndUpload,
  reduceCoverPicker,
  type CoverCandidate,
} from "./coverPickerModel";

export function CoverPicker({
  game,
  onUploaded,
}: {
  game: Pick<OwnedGameDto, "slug" | "title" | "coverVersion">;
  onUploaded(): void;
}) {
  const [state, dispatch] = useReducer(reduceCoverPicker, initialCoverPickerState);
  const [artworkOpen, setArtworkOpen] = useState(false);

  async function generate() {
    dispatch({ type: "requested" });
    const result = await api.generateCovers(game.slug);
    if (!result.ok) {
      dispatch({ type: "failed", message: result.error.message });
      return;
    }
    dispatch({ type: "received", response: result.value });
  }

  async function pick(candidate: CoverCandidate, index: number) {
    dispatch({ type: "pick_requested", index });
    try {
      await rasterizeAndUpload(candidate.svg, async (png) => {
        const result = await api.uploadCover(game.slug, png);
        if (!result.ok) throw new Error(result.error.message);
        return result.value;
      });
      dispatch({ type: "pick_succeeded" });
      onUploaded();
    } catch (error) {
      dispatch({ type: "failed", message: error instanceof Error ? error.message : "Cover upload failed." });
    }
  }

  const busy = state.phase === "loading" || state.phase === "uploading";
  return <section className="cover-picker" aria-label={`Cover options for ${game.title}`}>
    <div className="cover-picker__header">
      <div><strong>Cover art</strong><small>{game.coverVersion === null ? "No cover uploaded" : `Cover version ${game.coverVersion}`}</small></div>
      <button className="secondary-button" type="button" disabled={busy} onClick={() => setArtworkOpen(true)}>Upload image</button>
    </div>
    {game.coverVersion !== null ? <Link to={`/games/${encodeURIComponent(game.slug)}`}>View artwork & credits</Link> : null}
    {artworkOpen ? <ArtworkDialog title={game.title} onClose={() => setArtworkOpen(false)} onSave={async (artwork) => {
      if (artwork?.status !== "ready") throw new Error("Choose an image first.");
      const result = await api.uploadCover(game.slug, artworkBlob(artwork), artwork.info.credits);
      if (!result.ok) throw new Error(result.error.message);
      onUploaded();
    }} /> : null}
    <details><summary>Shape patterns</summary><p>Simple geometric alternatives for your cover.</p><button className="secondary-button" type="button" disabled={busy} onClick={() => void generate()}>{state.candidates.length === 0 ? "Show patterns" : "Refresh patterns"}</button>
    {state.message === null ? null : <p className="cover-picker__status" role="status">{state.message}</p>}
    {state.candidates.length === 0 ? null : <div className="cover-picker__grid" aria-busy={busy}>
      {state.candidates.map((candidate, index) => <button
        className="cover-picker__candidate"
        type="button"
        disabled={busy}
        key={`${candidate.spec.seed}-${index}`}
        onClick={() => void pick(candidate, index)}
      >
        <img src={svgDataUrl(candidate.svg)} alt={`Cover option ${index + 1} for ${game.title}`} />
        <span>{state.uploadingIndex === index ? "Uploading…" : "Pick this cover"}</span>
      </button>)}
    </div>}
    </details>
  </section>;
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
