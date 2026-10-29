import { useEffect, useState } from "react";
import type { CardArtBrief } from "digipology-protocol";
import { downloadBlob } from "../editor/state/artwork";
import type { ArtworkDraft } from "./model";
import type { DraftArtworkController } from "./useDraftArtworkGeneration";

export function CardImageJobControl({ kind, targetId, name, draft, controller, disabled }: Omit<CardArtBrief, "brief"> & { name: string; draft: ArtworkDraft; controller: DraftArtworkController; disabled: boolean }) {
  const item = draft.artworkGeneration?.cardJobs?.find((j) => j.kind === kind && j.targetId === targetId);
  const [brief, setBrief] = useState(item?.brief ?? ""), [error, setError] = useState<string | null>(null);
  useEffect(() => { setBrief(item?.brief ?? ""); setError(null); }, [kind, targetId, item?.brief]);
  const target = { kind, targetId, brief: brief.trim() }, prepared = controller.preparedCardImage(target);
  const label = kind === "family-back" ? "back" : "illustration";
  const selected = item?.job.selectedAssetId;
  return <details className="card-image-job"><summary>Create {name} {label}</summary>
    <label>{name} {label} brief<textarea aria-label={`${name} ${label} brief`} rows={3} maxLength={2000} value={brief} disabled={disabled} onChange={(event) => setBrief(event.currentTarget.value)} /></label>
    <p>{item?.job.status === "ready" ? "Image ready" : item?.job.status === "unconfigured" ? "Waiting for image access" : item?.job.status === "running" ? "Creating and preparing…" : "Create from this game’s visual direction, or upload your own image."}</p>
    {!draft.artworkGeneration?.direction ? <p>Choose an art direction above first.</p> : null}
    {error || item?.job.message ? <p role="alert">{error ?? item?.job.message}</p> : null}
    <button type="button" disabled={disabled || !brief.trim() || !draft.artworkGeneration?.direction} onClick={() => { setError(null); void controller.retryCardArtwork(target, item?.job.status === "ready").catch((caught) => setError(caught instanceof Error ? caught.message : "This card image could not be created.")); }}>{item?.job.failureKind === "storage" ? "Retry saving card image" : item?.job.status === "ready" ? "Create another card image" : "Create / retry card image"}</button>
    {prepared && item?.job.failureKind === "storage" ? <button type="button" onClick={() => downloadBlob(new Blob([JSON.stringify({ kind: "digipology-card-image", version: 1, purpose: kind === "family-back" ? "card-back" : "card-illustration", artwork: { status: "ready", info: prepared.info, dataUrl: prepared.dataUrl } })], { type: "application/json" }), "card-image.artwork.json")}>Download prepared card image</button> : null}
    {selected ? <a href={`/api/ai/artwork/${encodeURIComponent(selected)}`} download>Download original card image</a> : null}
    {item?.job.assetId && item.job.assetId !== selected ? <a href={`/api/ai/artwork/${encodeURIComponent(item.job.assetId)}`} download>Download attempted original</a> : null}
  </details>;
}
