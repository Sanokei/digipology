import { useEffect, useId, useRef, useState } from "react";
import type { ReadyDraftArtwork } from "digipology-protocol";
import { ArtworkDialog } from "../components/ArtworkDialog";
import { PlayingCardBack } from "../components/PlayingCardFace";
import { artworkPackage, downloadBlob, verifyArtwork } from "../editor/state/artwork";
import { cardBackPackage } from "../scene/cardBack";
import { ART_PURPOSES, artworkJobsReady, artworkScope, jobKey, purposeLabel, type ArtPurpose, type ArtworkDraft, type ArtworkGenerationJob, type GameArtDirection } from "./model";
import type { DraftArtworkController } from "./useDraftArtworkGeneration";
import "./gameArtworkGeneration.css";

function jobLabel(job: ArtworkGenerationJob | undefined, selected: ReadyDraftArtwork | undefined): string {
  if (!job) return selected ? "Image selected" : "Artwork pending";
  switch (job.status) {
    case "pending": return "Waiting to create";
    case "running": return "Creating and preparing…";
    case "unconfigured": return "Waiting for image access";
    case "failed": return job.failureKind === "storage" ? "Needs saving" : "Needs attention";
    case "ready": return selected ? "Ready" : "Image missing";
    case "not-needed": return "Not needed for this game";
  }
}

function AssetPanel({ purpose, draft, controller, canGenerate, onReplace }: {
  purpose: ArtPurpose; draft: ArtworkDraft; controller: DraftArtworkController; canGenerate: boolean; onReplace(): void;
}) {
  const title = useId();
  const selected = controller.selectedImage(purpose);
  const prepared = controller.preparedImage(purpose);
  const job = draft.artworkGeneration?.jobs[jobKey(purpose)];
  const [previewError, setPreviewError] = useState<string | null>(null);
  useEffect(() => {
    let active = true; setPreviewError(null);
    if (selected) void verifyArtwork(selected).catch(() => { if (active) setPreviewError("The selected image could not be opened. Replace it or retry this image."); });
    return () => { active = false; };
  }, [selected?.info.sha256]);
  const running = controller.activity !== null;
  const ready = job?.status === "ready" && !!selected;
  const needed = job?.status !== "not-needed";
  const direction = draft.artworkGeneration?.direction;
  const selectedAssetId = job?.selectedAssetId ?? (selected?.info.generation?.originalSha256 === job?.originalSha256 ? job?.assetId : undefined);
  const canRetry = canGenerate && !!direction && !running && needed;
  const back = selected ? { key: selected.info.sha256, title: draft.title, src: selected.dataUrl, width: selected.info.width, height: selected.info.height, credits: selected.info.credits } : undefined;
  function downloadPrepared() {
    if (!prepared) return;
    downloadBlob(new Blob([purpose === "cover" ? artworkPackage(prepared) : cardBackPackage(prepared)], { type: "application/json" }), `${purpose}.artwork.json`);
  }
  return <section className="game-art-asset" aria-labelledby={title} data-art-purpose={purpose}>
    <header><h3 id={title}>{purposeLabel(purpose)}</h3><span className={`game-art-asset__state is-${job?.status ?? "pending"}`}>{previewError ? "Image needs attention" : jobLabel(job, selected)}</span></header>
    <div className="game-art-asset__preview">
      {selected && !previewError ? purpose === "cover"
        ? <img src={selected.dataUrl} alt={`${draft.title} cover`} onError={() => setPreviewError("The cover preview could not be opened. Replace it or retry this image.")} />
        : <span role="img" aria-label={`${draft.title} concealed card back`}><PlayingCardBack {...(back ? { definition: back } : {})} /></span>
        : <p>{needed ? `${purposeLabel(purpose)} ${job?.status === "running" ? "is being created" : "is pending"}` : "This game has no cards"}</p>}
    </div>
    <p className="game-art-asset__purpose">{purpose === "cover" ? "The first impression in your library and invitations." : "A separate design shared by this game’s concealed cards. It reveals no card identities."}</p>
    {selected && job?.status === "running" ? <p className="game-art-asset__hint">Your current image stays in use until its replacement is ready.</p> : null}
    {previewError || job?.message ? <p className="game-art-asset__error" role="alert">{previewError ?? job?.message}</p> : null}
    <div className="game-art-asset__actions">
      {needed ? <button type="button" disabled={!canRetry} onClick={() => void controller.retry(purpose, ready)}>{job?.failureKind === "storage" && prepared ? "Retry saving image" : ready ? `Create another ${purposeLabel(purpose).toLowerCase()}` : `Retry ${purposeLabel(purpose).toLowerCase()}`}</button> : null}
      <button type="button" disabled={running} onClick={onReplace}>Replace image…</button>
      {prepared && job?.failureKind === "storage" ? <button type="button" onClick={downloadPrepared}>Download generated result</button> : null}
    </div>
    {selected || job?.assetId || selectedAssetId ? <details className="game-art-asset__credits"><summary>Credits & original</summary>
      {selected ? <><p>{selected.info.credits.artist || "No artist credit added"}{selected.info.credits.license ? ` · ${selected.info.credits.license}` : ""}</p>
        {selected.info.credits.sourceUrl ? <a href={selected.info.credits.sourceUrl} target="_blank" rel="noreferrer">Public source page</a> : null}
        {selected.info.generation ? <p>Generated with {selected.info.generation.model}</p> : null}</> : null}
      {selectedAssetId ? <a href={`/api/ai/artwork/${encodeURIComponent(selectedAssetId)}`} download>Download original image</a> : null}
      {job?.assetId && job.assetId !== selectedAssetId ? <a href={`/api/ai/artwork/${encodeURIComponent(job.assetId)}`} download>Download attempted original</a> : null}
    </details> : null}
  </section>;
}

export function GameArtworkDialog({ draft, controller, canGenerate, onSignIn, onDownloadDraft, onClose }: {
  draft: ArtworkDraft; controller: DraftArtworkController; canGenerate: boolean; onSignIn?(): void; onDownloadDraft(): void; onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const title = useId();
  const direction = draft.artworkGeneration?.direction ?? null;
  const [edited, setEdited] = useState<GameArtDirection>(direction ?? { version: 1, style: "", coverPrompt: "", cardBackPrompt: "" });
  const [dirty, setDirty] = useState(false);
  const [manual, setManual] = useState<ArtPurpose | null>(null);
  const [directionError, setDirectionError] = useState<string | null>(null);
  const scope = artworkScope(draft);
  const purposes = ART_PURPOSES.filter((purpose) => purpose === "cover" || scope.needsBack);
  const done = purposes.filter((purpose) => !!controller.selectedImage(purpose) && (!draft.artworkGeneration || draft.artworkGeneration.jobs[jobKey(purpose)].status === "ready")).length;
  const busy = controller.activity !== null;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const current = dialog.current!; current.showModal();
    return () => { current.close(); previous?.focus(); };
  }, []);
  useEffect(() => { if (!dirty && direction) setEdited(direction); }, [direction, dirty]);
  useEffect(() => {
    const current = body.current!;
    let frame: number | null = null;
    const reveal = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && current.contains(focused)) focused.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    };
    const observer = new ResizeObserver(reveal); observer.observe(current); current.addEventListener("focusin", reveal);
    return () => { observer.disconnect(); current.removeEventListener("focusin", reveal); if (frame !== null) cancelAnimationFrame(frame); };
  }, []);
  async function saveDirection() {
    if (!edited.style.trim() || !edited.coverPrompt.trim() || (scope.needsBack && !edited.cardBackPrompt.trim())) { setDirectionError("Describe the visual style and the images this game needs."); return; }
    setDirectionError(null);
    await controller.saveDirection({ ...edited, style: edited.style.trim(), coverPrompt: edited.coverPrompt.trim(), cardBackPrompt: edited.cardBackPrompt.trim() });
    setDirty(false);
  }
  const manualImage = manual ? controller.selectedImage(manual) : undefined;
  return <>
    <dialog ref={dialog} className="game-art-dialog" aria-labelledby={title} onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <header className="game-art-dialog__header"><div><p className="game-art-eyebrow">Made for this game</p><h2 id={title}>Artwork for {draft.title}</h2><p className="game-art-progress" role="status">{done} of {purposes.length} images ready{controller.activity === "review" ? " · checking gameplay…" : busy ? " · creating artwork…" : ""}</p></div><button type="button" className="game-art-close" aria-label="Close game artwork" autoFocus onClick={onClose}>×</button></header>
      <div ref={body} className="game-art-dialog__body">
        <p className="game-art-intro">Your game chooses a visual direction, then creates a distinct cover{scope.needsBack ? " and card-back design" : ""}. You can keep playing while artwork is prepared.</p>
        {!canGenerate ? <p className="game-art-notice">Sign in to create or retry artwork.{onSignIn ? <button type="button" onClick={onSignIn}>Sign in</button> : null} Your saved images and draft remain available.</p> : null}
        {controller.storageMessage ? <div className="game-art-notice is-error" role="alert"><p>{controller.storageMessage}</p><button type="button" disabled={busy} onClick={() => void controller.retrySaving()}>Retry saving draft</button><button type="button" onClick={onDownloadDraft}>Download draft</button></div> : null}
        <div className="game-art-direction">
          <div><h3>Art direction</h3><p>{direction?.style || "The art plan has not been created yet. Your validated rules are saved."}</p></div>
          <button type="button" disabled={!canGenerate || busy} onClick={() => void controller.createDirection()}>{controller.activity === "direction" ? "Choosing a direction…" : direction ? "Rethink direction" : "Create art direction"}</button>
          {controller.directionMessage ? <p role="alert">{controller.directionMessage}</p> : null}
          <details><summary>Edit the direction & image briefs</summary><form onSubmit={(event) => { event.preventDefault(); void saveDirection(); }}>
            <label>Visual style<textarea rows={2} maxLength={1000} disabled={busy} value={edited.style} onChange={(event) => { setEdited({ ...edited, style: event.currentTarget.value }); setDirty(true); }} /></label>
            <label>Cover brief<textarea rows={4} maxLength={2000} disabled={busy} value={edited.coverPrompt} onChange={(event) => { setEdited({ ...edited, coverPrompt: event.currentTarget.value }); setDirty(true); }} /></label>
            {scope.needsBack ? <>
              <label>Card-back brief<textarea rows={4} maxLength={2000} disabled={busy} value={edited.cardBackPrompt} onChange={(event) => { setEdited({ ...edited, cardBackPrompt: event.currentTarget.value }); setDirty(true); }} /></label>
              <small>A deliberate symmetric motif, clear at card size. Keep card identities, tiny lettering and cover scenes out of the back.</small>
            </> : null}
            {directionError ? <p role="alert">{directionError}</p> : null}
            <button type="submit" disabled={busy || !dirty}>{canGenerate ? "Save direction & create changed images" : "Save art direction"}</button>
          </form></details>
        </div>
        {scope.multipleDecks ? <p className="game-art-notice">This generates one default back shared across the game. Separate artwork for each deck is still pending.</p> : null}
        <div className="game-art-assets">{purposes.map((purpose) => <AssetPanel key={purpose} purpose={purpose} draft={draft} controller={controller} canGenerate={canGenerate} onReplace={() => setManual(purpose)} />)}</div>
        {artworkJobsReady(draft) ? <section className="game-art-review" aria-label="Updated game checks">
          <h3>Game checks</h3>
          {controller.activity === "review" ? <p role="status">Checking the current draft with its finished artwork…</p>
            : controller.reviewMessage ? <><p role="alert">{controller.reviewMessage}</p><button type="button" disabled={!canGenerate || busy} onClick={() => void controller.retryReview()}>Retry game checks</button></>
              : draft.generationReview?.manifestHash === draft.bundle.integrity.manifestHash ? <p>Gameplay checks are up to date. Try a full game before inviting friends.</p>
                : <><p>The earlier playtest review is out of date. Check this version before inviting friends.</p><button type="button" disabled={!canGenerate || busy} onClick={() => void controller.retryReview()}>Check current draft</button></>}
        </section> : null}
      </div>
      <footer className="game-art-dialog__footer"><button type="button" onClick={onDownloadDraft}>Download editable draft</button><span>Rules, art briefs and completed images are kept together.</span><button type="button" onClick={onClose}>Back to game</button></footer>
    </dialog>
    {manual ? <ArtworkDialog title={draft.title} purpose={manual} allowRemove={false} {...(manualImage ? { artwork: manualImage } : {})} onClose={() => setManual(null)} onSave={async (next) => {
      if (next?.status !== "ready") throw new Error("Choose a complete image to replace this artwork.");
      await controller.replaceImage(manual, next);
    }} /> : null}
  </>;
}
