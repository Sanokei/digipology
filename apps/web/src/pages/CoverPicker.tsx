import { useReducer } from "react";
import type { OwnedGameDto } from "digipology-protocol/http";
import { api } from "../api/client";
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
      <button className="secondary-button" type="button" disabled={busy} onClick={() => void generate()}>
        {state.candidates.length === 0 ? "Generate covers" : "Regenerate"}
      </button>
    </div>
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
  </section>;
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
