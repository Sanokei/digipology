import { useEffect, useId, useRef, useState } from "react";
import { normalizeArtworkCredits, type DraftArtwork, type ReadyDraftArtwork } from "digipology-protocol";
import { artworkPackage, downloadBlob, EMPTY_CREDITS, prepareArtwork, verifyArtwork } from "../editor/state/artwork";
import "./artwork.css";

export function ArtworkDialog({ title, artwork, onSave, onClose, onDownloadDraft }: {
  title: string; artwork?: DraftArtwork; onSave(value: DraftArtwork | undefined): Promise<void>;
  onClose(): void; onDownloadDraft?(value: DraftArtwork | undefined): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const operation = useRef(0);
  const [selected, setSelected] = useState<ReadyDraftArtwork | null>(artwork?.status === "ready" ? artwork : null);
  const [credits, setCredits] = useState(artwork?.status === "ready" ? artwork.info.credits : artwork?.credits ?? EMPTY_CREDITS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(artwork?.status === "unavailable" ? "Saved artwork could not be read. Replace it, or remove it to publish." : null);
  const [decodeFailed, setDecodeFailed] = useState(false);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const current = dialog.current!; current.showModal();
    return () => { operation.current += 1; current.close(); previous?.focus(); };
  }, []);
  async function choose(file: File) {
    const id = ++operation.current;
    setBusy(true); setError(null);
    try {
      const next = await prepareArtwork(file, credits);
      if (id !== operation.current) return;
      setSelected(next); setDecodeFailed(false);
      // Raw image preparation must not overwrite credits edited while decoding.
      // A saved artwork package deliberately restores its own persisted credits.
      if (file.name.toLowerCase().endsWith(".json") || file.type === "application/json") setCredits(next.info.credits);
    } catch (caught) { if (id === operation.current) setError(caught instanceof Error ? caught.message : "The image could not be opened."); }
    finally { if (id === operation.current) setBusy(false); }
  }
  function candidate(): ReadyDraftArtwork {
    const clean = normalizeArtworkCredits(credits);
    if (!clean) throw new Error("Use short credits and a public HTTPS source page.");
    if (!selected || decodeFailed) throw new Error("Choose an image that can be opened.");
    return { ...selected, info: { ...selected.info, credits: clean } };
  }
  async function save(remove = false) {
    setBusy(true); setError(null);
    try {
      const next = remove ? undefined : candidate();
      if (next) await verifyArtwork(next);
      await onSave(next); onClose();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Artwork could not be saved. Retry or download the draft."); }
    finally { setBusy(false); }
  }
  function download() {
    try {
      const next = selected ? candidate() : artwork;
      if (onDownloadDraft) onDownloadDraft(next);
      else if (next?.status === "ready") downloadBlob(new Blob([artworkPackage(next)], { type: "application/json" }), "cover.artwork.json");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The download could not be prepared."); }
  }
  return <dialog ref={dialog} className="artwork-dialog" aria-labelledby={heading} onCancel={(event) => { event.preventDefault(); onClose(); }} onPointerDown={(event) => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }}>
    <header><div><p>Make it yours</p><h2 id={heading}>Artwork for {title}</h2></div><button type="button" aria-label="Close artwork" autoFocus onClick={onClose}>×</button></header>
    {busy ? <p className="artwork-status" role="status">Preparing or saving artwork…</p> : null}
    {error ? <p className="artwork-error" role="alert">{error}</p> : null}
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="artwork-dialog__body">
      <div className="artwork-editor">
        <div className="artwork-preview">{selected ? <img src={selected.dataUrl} alt={`${title} artwork preview`} onError={() => { setDecodeFailed(true); setError("This saved image could not be decoded. Replace it, or remove it to publish."); }} /> : <p>Choose your cover image</p>}
          {selected ? <small>{selected.info.width} × {selected.info.height} · {selected.info.contentType.replace("image/", "").toUpperCase()}</small> : null}</div>
        <div className="artwork-fields">
          <label>Image or saved artwork<input type="file" accept="image/png,image/jpeg,image/webp,application/json,.json" disabled={busy} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void choose(file); }} /></label>
          <p>Fits a portrait crop. Transparent areas use a cream background. PNG, JPEG or WebP, up to 8 MiB and 16 megapixels.</p>
          <label>Artist / credit<input maxLength={120} value={credits.artist} onChange={(event) => setCredits({ ...credits, artist: event.currentTarget.value })} /></label>
          <label>License / usage note<input maxLength={80} value={credits.license} onChange={(event) => setCredits({ ...credits, license: event.currentTarget.value })} /></label>
          <label>Public source page<input type="url" maxLength={512} placeholder="https://…" value={credits.sourceUrl} onChange={(event) => setCredits({ ...credits, sourceUrl: event.currentTarget.value })} /></label>
        </div>
      </div>
      </div>
      <footer><button type="submit" disabled={busy || !selected || decodeFailed}>Save artwork</button>{onDownloadDraft && artwork ? <button type="button" disabled={busy} onClick={() => void save(true)}>Remove artwork</button> : null}<button type="button" disabled={busy || (!selected && !onDownloadDraft)} onClick={download}>{onDownloadDraft ? "Download draft" : "Save with credits"}</button></footer>
    </form>
  </dialog>;
}
