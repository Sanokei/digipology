import { CardImageJobControl } from "./CardImageJobControl";
import { useEffect, useState } from "react";
import { sha256 } from "digipology-canonical-json";
import { CARD_DESIGNS_PATH, cardImageBytes, parseCardDesigns, type CardDesigns, type ReadyDraftArtwork } from "digipology-protocol";
import { ArtworkDialog } from "../components/ArtworkDialog";
import { DesignedCardFace, PlayingCardBack } from "../components/PlayingCardFace";
import { emptyCardDesigns, attachCardDesigns, withCardImage } from "../editor/state/cardDesigns";
import { downloadBlob, verifyArtwork } from "../editor/state/artwork";
import { serializeEditorDraft } from "../editor/state/persistence";
import { cardAssetImage, designedCard } from "../scene/cardDesigns";
import type { ArtworkDraft } from "./model";
import type { DraftArtworkController } from "./useDraftArtworkGeneration";

type Target = { kind: "family-back" | "family-illustration" | "card-illustration"; id: string };
export function CardDesignEditor({ draft, controller }: { draft: ArtworkDraft; controller: DraftArtworkController }) {
  const content = draft.bundle.files.find((file) => file.path === CARD_DESIGNS_PATH)?.content;
  const [designs, setDesigns] = useState<CardDesigns | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decodeErrors, setDecodeErrors] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [selectedCard, setSelectedCard] = useState("");
  const [selectedFamily, setSelectedFamily] = useState("");
  const [target, setTarget] = useState<Target | null>(null);
  useEffect(() => {
    try { const doc = content ? parseCardDesigns(content) : null; setDesigns(doc); setDirty(false); setError(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The saved card designs could not be read."); }
  }, [content]);
  useEffect(() => {
    let active = true; setDecodeErrors([]);
    if (designs) void Promise.all(designs.assets.map(async (asset) => { try { await verifyArtwork(asset.artwork); return null; } catch { return asset.id; } })).then((ids) => { if (active) setDecodeErrors(ids.filter((id): id is string => id !== null)); });
    return () => { active = false; };
  }, [designs]);
  const busy = controller.activity !== null;
  const card = designs?.cards.find((item) => item.definitionId === selectedCard) ?? designs?.cards[0];
  const family = designs?.families.find((item) => item.id === selectedFamily) ?? designs?.families.find((item) => item.id === card?.familyId) ?? designs?.families[0];
  const damaged = designs?.assets.filter((asset) => { try { cardImageBytes(asset, sha256); return decodeErrors.includes(asset.id); } catch { return true; } }) ?? [];
  const safe = designs ? { ...designs, assets: designs.assets.filter((asset) => !damaged.includes(asset)) } : null;
  const preview = designedCard(safe, card?.definitionId);
  const backAsset = safe?.assets.find((asset) => asset.id === family?.backAssetId);
  const currentAsset = target && designs ? designs.assets.find((asset) => asset.id === (target.kind === "card-illustration" ? designs.cards.find((c) => c.definitionId === target.id)?.illustrationAssetId : target.kind === "family-back" ? designs.families.find((f) => f.id === target.id)?.backAssetId : designs.families.find((f) => f.id === target.id)?.illustrationAssetId)) : undefined;
  const patch = (update: (doc: CardDesigns) => void) => { if (!designs) return; const next = structuredClone(designs); update(next); setDesigns(next); setDirty(true); setError(null); };
  async function save(doc = designs) { if (!doc) return; try { await controller.saveCardDesigns(doc); setDirty(false); setError(null); } catch (caught) { setError(caught instanceof Error ? caught.message : "Card designs could not be saved."); } }
  function imageChange(doc: CardDesigns, t: Target, image?: ReadyDraftArtwork): CardDesigns {
    return withCardImage(doc, { kind: t.kind, targetId: t.id }, image);
  }

  function downloadPending(image?: ReadyDraftArtwork) {
    if (!designs) return;
    try {
      const next = structuredClone(controller.currentDraft());
      attachCardDesigns(next, target ? imageChange(designs, target, image) : designs);
      downloadBlob(new Blob([serializeEditorDraft(next)], { type: "application/json" }), "game-draft.editor.json");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Download could not be prepared."); }
  }
  return <section className="card-design-editor" aria-label="Cards and decks">
    <header><div><h3>Cards & decks</h3><p>Printed fronts, shared family illustrations and distinct backs. Your game chooses the design.</p></div></header>
    <p className="game-art-notice">Printed text changes presentation. Edit the game rules separately to change what a card does.</p>
    {error ? <p role="alert" className="game-art-notice is-error">{error}</p> : null}
    {!designs ? <button type="button" disabled={busy || !!content} onClick={() => { const doc = emptyCardDesigns(draft); setDesigns(doc); setDirty(true); }}>Set up cards & decks</button> : <>
      {damaged.length ? <div role="alert" className="game-art-notice is-error"><p>{damaged.length} saved card images are damaged. They will not render or publish. Replace the affected images or deliberately remove them.</p><button type="button" disabled={busy} onClick={() => { const next = structuredClone(designs); const ids = new Set(damaged.map((a) => a.id)); next.assets = next.assets.filter((a) => !ids.has(a.id)); for (const f of next.families) { if (f.backAssetId && ids.has(f.backAssetId)) delete f.backAssetId; if (f.illustrationAssetId && ids.has(f.illustrationAssetId)) delete f.illustrationAssetId; } for (const c of next.cards) if (c.illustrationAssetId && ids.has(c.illustrationAssetId)) delete c.illustrationAssetId; setDesigns(next); setDirty(true); }}>Remove damaged card images</button></div> : null}
      <div className="card-design-editor__grid">
        <div className="card-design-editor__form">
          <label>Card family<select aria-label="Card family" value={family?.id ?? ""} onChange={(e) => setSelectedFamily(e.currentTarget.value)}>{designs.families.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select></label>
          {family ? <>
            <label>Family name<input aria-label="Family name" maxLength={80} value={family.label} disabled={busy} onChange={(e) => patch((d) => { d.families.find((f) => f.id === family.id)!.label = e.currentTarget.value; })} /></label>
            <label>Family ink<input aria-label="Family ink" type="color" value={family.color} disabled={busy} onChange={(e) => patch((d) => { d.families.find((f) => f.id === family.id)!.color = e.currentTarget.value; })} /></label>
            <label><span>Illustrated fronts for this family</span><input type="checkbox" aria-label="Illustrated fronts for this family" checked={family.illustrated !== false} disabled={busy} onChange={(e) => patch((d) => { d.families.find((f) => f.id === family.id)!.illustrated = e.currentTarget.checked; })} /></label>
            <div className="card-design-editor__actions"><button type="button" disabled={busy} onClick={() => setTarget({ kind: "family-back", id: family.id })}>Family back image…</button><button type="button" disabled={busy} onClick={() => setTarget({ kind: "family-illustration", id: family.id })}>Family illustration…</button></div>
            <CardImageJobControl kind="family-back" targetId={family.id} name={family.label} draft={draft} controller={controller} disabled={busy || dirty} />
            <CardImageJobControl kind="family-illustration" targetId={family.id} name={family.label} draft={draft} controller={controller} disabled={busy || dirty} />
            {designs.decks.map((deck) => <label key={deck.entityId}>Deck: {deck.entityId}<select aria-label={`Family for deck ${deck.entityId}`} disabled={busy} value={deck.familyId} onChange={(e) => patch((d) => { d.decks.find((x) => x.entityId === deck.entityId)!.familyId = e.currentTarget.value; })}>{designs.families.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select></label>)}
          </> : null}
          <label>Printed card<select aria-label="Printed card" value={card?.definitionId ?? ""} onChange={(e) => setSelectedCard(e.currentTarget.value)}>{designs.cards.map((c) => <option key={c.definitionId} value={c.definitionId}>{c.title}</option>)}</select></label>
          {card ? <>
            <label>This card’s family<select aria-label="This card’s family" disabled={busy} value={card.familyId} onChange={(e) => patch((d) => { d.cards.find((c) => c.definitionId === card.definitionId)!.familyId = e.currentTarget.value; })}>{designs.families.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select></label>
            {([['title', 'Printed title', 120], ['typeLine', 'Card type', 120], ['cost', 'Cost / ingredients', 200], ['condition', 'Condition / activation', 600], ['rulesText', 'Printed effect', 6000], ['flavor', 'Flavor text', 1000]] as const).map(([key, label, max]) => <label key={key}>{label}<textarea aria-label={label} rows={key === "rulesText" ? 5 : 2} maxLength={max} disabled={busy} value={card[key]} onChange={(e) => patch((d) => { d.cards.find((c) => c.definitionId === card.definitionId)![key] = e.currentTarget.value; })} /></label>)}
            {card.fields.map((field, i) => <fieldset key={i}><legend>Printed detail {i + 1}</legend><label>Detail label<input value={field.label} maxLength={80} onChange={(e) => patch((d) => { d.cards.find((c) => c.definitionId === card.definitionId)!.fields[i]!.label = e.currentTarget.value; })} /></label><label>Detail value<textarea value={field.value} maxLength={600} onChange={(e) => patch((d) => { d.cards.find((c) => c.definitionId === card.definitionId)!.fields[i]!.value = e.currentTarget.value; })} /></label><button type="button" onClick={() => patch((d) => { d.cards.find((c) => c.definitionId === card.definitionId)!.fields.splice(i, 1); })}>Remove detail {i + 1}</button></fieldset>)}
            <button type="button" disabled={busy || card.fields.length >= 8} onClick={() => patch((d) => { d.cards.find((c) => c.definitionId === card.definitionId)!.fields.push({ label: "Detail", value: "" }); })}>Add printed detail</button>
            <CardImageJobControl kind="card-illustration" targetId={card.definitionId} name={card.title} draft={draft} controller={controller} disabled={busy || dirty} />
            <button type="button" disabled={busy} onClick={() => setTarget({ kind: "card-illustration", id: card.definitionId })}>This card’s illustration…</button><small>Uses its family illustration until you choose an individual image.</small>
          </> : null}
        </div>
        <div className="card-design-editor__previews">{preview ? <div><DesignedCardFace design={preview} /><p>Front · {preview.card.title}</p></div> : null}<div><PlayingCardBack {...(backAsset && family ? { definition: cardAssetImage(backAsset, family.label) } : {})} /><p>Back · {family?.label}</p></div></div>
      </div>
      {dirty ? <p role="status">Unsaved card edits. Save before creating images.</p> : null}
      <div className="card-design-editor__actions"><button type="button" disabled={busy || !dirty} onClick={() => void save()}>Save card designs</button>{dirty ? <button type="button" onClick={() => downloadPending()}>Download edited draft</button> : null}</div>
    </>}
    {target && designs ? <ArtworkDialog title={target.kind === "card-illustration" ? designs.cards.find((c) => c.definitionId === target.id)?.title ?? target.id : family?.label ?? target.id} purpose={target.kind === "family-back" ? "card-back" : "card-illustration"} imageProfile={target.kind === "family-back" ? "card-back" : "illustration"} allowRemove {...(currentAsset ? { artwork: currentAsset.artwork } : {})} onClose={() => setTarget(null)} onDownloadDraft={(image) => { if (image?.status === "unavailable") throw new Error("Replace the damaged image first."); downloadPending(image); }} onSave={async (image) => { if (image?.status === "unavailable") throw new Error("Choose a complete image."); const next = imageChange(designs, target, image); await controller.saveCardDesigns(next, { kind: target.kind, targetId: target.id }); setDesigns(next); setDirty(false); }} /> : null}
  </section>;
}
