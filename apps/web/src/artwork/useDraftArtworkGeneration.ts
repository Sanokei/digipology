import { verifyArtwork } from "../editor/state/artwork";
import { attachCardDesigns, selectedCardImage, withCardImage } from "../editor/state/cardDesigns";
import { CARD_DESIGNS_PATH, parseCardDesigns, type CardArtBrief, type CardArtworkJob, type CardDesigns } from "digipology-protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReadyDraftArtwork } from "digipology-protocol";
import { rebuildDraftIntegrity } from "../editor/state/bundle";
import { attachCardBack } from "../editor/state/cardBack";
import { ART_PURPOSES, artworkJobsReady, artworkNeedsAutomaticReview, canResumeArtwork, canResumeCardArtwork, initialArtworkGeneration, jobKey, purposeLabel, selectedDraftImage, withManualArtwork, type ArtPurpose, type ArtworkApi, type ArtworkDraft, type GameArtDirection, type PreparedResult } from "./model";
import { prepareGeneratedArtwork } from "./prepareGeneratedArtwork";
import { acceptedArtworkReview } from "./review";

interface Options {
  draft: ArtworkDraft;
  api: ArtworkApi;
  enabled: boolean;
  /** Update in-memory state before persistence; must retain the rest of the draft. */
  onDraftChange(next: ArtworkDraft, label: string): void;
  persistDraft(next: ArtworkDraft): void | Promise<void>;
}

const requestKey = (draft: ArtworkDraft, purpose: ArtPurpose) => JSON.stringify([
  draft.id, draft.title, purpose, draft.artworkGeneration?.jobs[jobKey(purpose)].revision, draft.artworkGeneration?.direction,
]);

/** Owns presentation jobs only. No rule generation or gameplay restart. */
export function useDraftArtworkGeneration({ draft, api, enabled, onDraftChange, persistDraft }: Options) {
  const current = useRef(draft); current.current = draft;
  const callbacks = useRef({ api, onDraftChange, persistDraft }); callbacks.current = { api, onDraftChange, persistDraft };
  const epoch = useRef(0);
  const mounted = useRef(true);
  const active = useRef<ArtPurpose | "cards" | "direction" | "review" | null>(null);
  const attempted = useRef(new Set<string>());
  const reviewed = useRef(new Set<string>());
  const prepared = useRef(new Map<ArtPurpose, PreparedResult>());
  const cardPrepared = useRef(new Map<string, PreparedResult>());
  const preparedOwner = useRef(draft.id);
  if (preparedOwner.current !== draft.id) { prepared.current.clear(); cardPrepared.current.clear(); preparedOwner.current = draft.id; }
  const [activity, setActivity] = useState<ArtPurpose | "cards" | "direction" | "review" | null>(null);
  const [storageMessage, setStorageMessage] = useState<string | null>(null);
  const [directionMessage, setDirectionMessage] = useState<string | null>(null);
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);
  const [, refresh] = useState(0);

  useEffect(() => {
    mounted.current = true;
    setActivity(null); setStorageMessage(null); setDirectionMessage(null); setReviewMessage(null);
    return () => {
      mounted.current = false;
      epoch.current += 1;
      active.current = null;
      attempted.current.clear();
      reviewed.current.clear();
    };
  }, [draft.id]);

  const commit = useCallback(async (next: ArtworkDraft, label: string): Promise<boolean> => {
    next.updatedAt = new Date().toISOString();
    current.current = next;
    try {
      callbacks.current.onDraftChange(next, label);
      await callbacks.current.persistDraft(next);
      if (mounted.current) setStorageMessage(null);
      return true;
    } catch {
      if (mounted.current) setStorageMessage("Your artwork is available in this tab, but browser storage could not save it. Download the draft or free storage and retry saving. Your rules have not been regenerated.");
      return false;
    }
  }, []);

  const updateJob = useCallback(async (purpose: ArtPurpose, mutate: (job: NonNullable<ArtworkDraft["artworkGeneration"]>["jobs"]["cover"]) => void, label: string) => {
    const next = structuredClone(current.current);
    next.artworkGeneration ??= initialArtworkGeneration(next);
    mutate(next.artworkGeneration.jobs[jobKey(purpose)]);
    return commit(next, label);
  }, [commit]);

  const applyPrepared = useCallback(async (purpose: ArtPurpose, result: PreparedResult): Promise<void> => {
    // Retain decoded bytes even if bundle admission or local storage fails.
    prepared.current.set(purpose, result);
    refresh((value) => value + 1);
    const next = structuredClone(current.current);
    next.artworkGeneration ??= initialArtworkGeneration(next);
    const job = next.artworkGeneration.jobs[jobKey(purpose)];
    Object.assign(job, { assetId: result.original.assetId, originalSha256: result.original.originalSha256 });
    try {
      if (purpose === "cover") next.artwork = result.artwork;
      else { attachCardBack(next, result.artwork); rebuildDraftIntegrity(next); next.artworkGeneration.reviewManifestHash = next.bundle.integrity.manifestHash; }
    } catch (error) {
      job.status = "failed"; job.failureKind = "storage";
      job.message = `${error instanceof Error ? error.message : "This image could not be attached."} The generated result is retained in this tab; download it or retry saving.`;
      await commit(next, `Retained ${purposeLabel(purpose).toLowerCase()} result`);
      return;
    }
    Object.assign(job, { status: "ready", selectedAssetId: result.original.assetId, outputSha256: result.artwork.info.sha256 });
    delete job.message; delete job.failureKind;
    if (!await commit(next, `Applied ${purposeLabel(purpose).toLowerCase()} artwork`) && mounted.current && current.current.id === next.id) {
      // Keep selected pixels + original locator in memory. A storage retry reuses
      // this exact result and never makes a second provider request.
      const retained = structuredClone(next);
      const retainedJob = retained.artworkGeneration!.jobs[jobKey(purpose)];
      retainedJob.status = "failed"; retainedJob.failureKind = "storage";
      retainedJob.message = "This image is ready in this tab but could not be saved. Retry saving or download the draft.";
      current.current = retained;
      callbacks.current.onDraftChange(retained, "Retained unsaved artwork");
    }
  }, [commit]);

  const runJob = useCallback(async (purpose: ArtPurpose, deliberateRepair = false) => {
    if (!enabled || active.current !== null) return;
    const starting = current.current;
    const generation = starting.artworkGeneration;
    if (!generation?.direction || generation.jobs[jobKey(purpose)].status === "not-needed") return;
    const key = requestKey(starting, purpose);
    const version = epoch.current;
    attempted.current.add(key);
    active.current = purpose; setActivity(purpose);
    const stillCurrent = () => mounted.current && version === epoch.current && requestKey(current.current, purpose) === key;
    try {
      const selected = selectedDraftImage(starting, purpose);
      if (!deliberateRepair && selected) {
        try { await verifyArtwork(selected); }
        catch { await updateJob(purpose, (job) => { job.status = "failed"; job.failureKind = "decode"; job.message = "The saved image could not be opened. Deliberately retry, replace or remove it to repair the artwork."; }, "Saved artwork needs repair"); return; }
      }
      await updateJob(purpose, (job) => { job.status = "running"; delete job.message; delete job.failureKind; }, `Creating ${purposeLabel(purpose).toLowerCase()} artwork`);
      if (!stillCurrent()) return;
      const response = await callbacks.current.api.generateDraftArtwork({ draftId: starting.id, title: starting.title, purpose,
        direction: generation.direction, revision: generation.jobs[jobKey(purpose)].revision });
      if (!stillCurrent()) return;
      if (!response.ok) {
        const unconfigured = /(?:unconfigured|missing_image_model|image_model_required)/.test(response.error.code);
        await updateJob(purpose, (job) => { job.status = unconfigured ? "unconfigured" : "failed"; job.failureKind = response.error.code === "artwork_cache_invalid" ? "decode" : "provider"; job.message = response.error.message; }, "Artwork needs attention");
        return;
      }
      let artwork: ReadyDraftArtwork;
      try { artwork = await prepareGeneratedArtwork(response.value, purpose, true); }
      catch (error) {
        if (!stillCurrent()) return;
        await updateJob(purpose, (job) => {
          job.status = "failed"; job.failureKind = "decode"; job.assetId = response.value.assetId;
          job.originalSha256 = response.value.originalSha256;
          job.message = error instanceof Error ? error.message : "The generated image could not be decoded. Retry this image.";
        }, "Artwork could not be prepared");
        return;
      }
      if (stillCurrent()) await applyPrepared(purpose, { original: response.value, artwork });
    } catch {
      if (stillCurrent()) await updateJob(purpose, (job) => { job.status = "failed"; job.failureKind = "provider"; job.message = "The artwork request was interrupted. Retry this image; completed work is reused."; }, "Artwork request interrupted");
    } finally {
      if (mounted.current && version === epoch.current) { active.current = null; setActivity(null); }
    }
  }, [applyPrepared, enabled, updateJob]);

  const cardKey = (target: CardArtBrief) => `${target.kind}:${target.targetId}`;
  const currentCardDesigns = (source: ArtworkDraft) => {
    const content = source.bundle.files.find((f) => f.path === CARD_DESIGNS_PATH)?.content;
    return content ? parseCardDesigns(content) : null;
  };
  const cardRequestKey = (source: ArtworkDraft, target: CardArtworkJob) => JSON.stringify([source.id, source.title, source.artworkGeneration?.direction, target.kind, target.targetId, target.brief, target.job.revision]);
  const updateCardJob = useCallback(async (target: CardArtBrief, mutate: (job: CardArtworkJob["job"]) => void) => {
    const next = structuredClone(current.current);
    const item = next.artworkGeneration?.cardJobs?.find((j) => cardKey(j) === cardKey(target));
    if (!item) throw new Error("The card image job was removed.");
    mutate(item.job); await commit(next, "Updated card artwork job");
  }, [commit]);
  const applyCardPrepared = useCallback(async (target: CardArtBrief, result: PreparedResult) => {
    cardPrepared.current.set(cardKey(target), result); refresh((n) => n + 1);
    const next = structuredClone(current.current), designs = currentCardDesigns(next);
    const item = next.artworkGeneration?.cardJobs?.find((j) => cardKey(j) === cardKey(target));
    if (!item || !designs) throw new Error("The card artwork target no longer exists.");
    item.job.assetId = result.original.assetId; item.job.originalSha256 = result.original.originalSha256;
    try { attachCardDesigns(next, withCardImage(designs, target, result.artwork)); }
    catch (error) {
      item.job.status = "failed"; item.job.failureKind = "storage";
      item.job.message = `${error instanceof Error ? error.message : "The card image could not be attached."} The exact generated result is retained in this tab for download or retry.`;
      await commit(next, "Retained generated card artwork"); return;
    }
    Object.assign(item.job, { status: "ready", selectedAssetId: result.original.assetId, outputSha256: result.artwork.info.sha256 });
    delete item.job.message; delete item.job.failureKind;
    next.artworkGeneration!.reviewManifestHash = next.bundle.integrity.manifestHash;
    if (!await commit(next, "Applied generated card artwork")) {
      item.job.status = "failed"; item.job.failureKind = "storage"; item.job.message = "Card artwork is ready in this tab. Retry saving or download the editable draft.";
      current.current = next; callbacks.current.onDraftChange(next, "Retained unsaved card artwork");
    }
  }, [commit]);
  const runCardJob = useCallback(async (target: CardArtworkJob, deliberateRepair = false) => {
    if (!enabled || active.current !== null) return;
    const starting = current.current, direction = starting.artworkGeneration?.direction;
    if (!direction) throw new Error("Choose an art direction before creating card images.");
    const designs = currentCardDesigns(starting), key = cardRequestKey(starting, target), version = epoch.current;
    const subjectName = target.kind === "card-illustration" ? designs?.cards.find((c) => c.definitionId === target.targetId)?.title : designs?.families.find((f) => f.id === target.targetId)?.label;
    if (!subjectName) return;
    active.current = "cards"; setActivity("cards"); attempted.current.add(key);
    const stillCurrent = () => mounted.current && version === epoch.current && current.current.id === starting.id && current.current.artworkGeneration?.cardJobs?.some((j) => cardRequestKey(current.current, j) === key);
    try {
      const selected = selectedCardImage(designs, target);
      if (!deliberateRepair && selected) {
        try { await verifyArtwork(selected); }
        catch { await updateCardJob(target, (job) => { job.status = "failed"; job.failureKind = "decode"; job.message = "The saved card image could not be opened. Deliberately retry, replace or remove it to repair this family."; }); return; }
      }
      await updateCardJob(target, (job) => { job.status = "running"; delete job.message; delete job.failureKind; });
      const purpose = target.kind === "family-back" ? "card-back" : "card-illustration";
      const response = await callbacks.current.api.generateDraftArtwork({ draftId: starting.id, title: starting.title, purpose, direction, revision: target.job.revision,
        subject: { kind: target.kind === "card-illustration" ? "card" : "family", id: target.targetId, name: subjectName.trim(), brief: target.brief } });
      if (!stillCurrent()) return;
      if (!response.ok) { await updateCardJob(target, (job) => { job.status = /unconfigured|missing_image_model/.test(response.error.code) ? "unconfigured" : "failed"; job.failureKind = "provider"; job.message = response.error.message; }); return; }
      let artwork: ReadyDraftArtwork;
      try { artwork = await prepareGeneratedArtwork(response.value, purpose, true); }
      catch (error) { if (stillCurrent()) await updateCardJob(target, (job) => { job.status = "failed"; job.failureKind = "decode"; job.assetId = response.value.assetId; job.originalSha256 = response.value.originalSha256; job.message = error instanceof Error ? error.message : "This card image could not be decoded."; }); return; }
      if (stillCurrent()) await applyCardPrepared(target, { original: response.value, artwork });
    } catch (error) { if (stillCurrent()) await updateCardJob(target, (job) => { job.status = "failed"; job.failureKind = "provider"; job.message = error instanceof Error ? error.message : "The card artwork request was interrupted. Retry reuses completed work."; }); }
    finally { if (mounted.current && version === epoch.current) { active.current = null; setActivity(null); } }
  }, [enabled, updateCardJob, applyCardPrepared]);
  const retryCardArtwork = useCallback(async (target: CardArtBrief, another = false) => {
    if (!enabled || active.current) throw new Error("Sign in and wait for the current artwork operation before retrying.");
    if (!current.current.artworkGeneration?.direction) throw new Error("Choose an art direction before creating card images.");
    const next = structuredClone(current.current), generation = next.artworkGeneration!;
    generation.cardJobs ??= [];
    let item = generation.cardJobs.find((j) => cardKey(j) === cardKey(target));
    if (!item) { if (generation.cardJobs.length >= 64) throw new Error("At most 64 scoped image jobs; share family illustrations for larger games."); item = { ...target, job: { status: "pending", revision: 0 } }; generation.cardJobs.push(item); }
    const saved = cardPrepared.current.get(cardKey(target));
    if (!another && saved && item.job.failureKind === "storage" && item.brief === target.brief) { await applyCardPrepared(target, saved); return; }
    if (another || item.brief !== target.brief || item.job.failureKind === "decode") { item.job.revision++; cardPrepared.current.delete(cardKey(target)); }
    item.brief = target.brief; item.job.status = "pending"; delete item.job.message; delete item.job.failureKind;
    await commit(next, "Queued game-specific card image"); await runCardJob(item, true);
  }, [enabled, commit, runCardJob, applyCardPrepared]);

  useEffect(() => {
    if (!enabled || active.current !== null || !draft.artworkGeneration?.direction) return;
    const next = ART_PURPOSES.find((purpose) => {
      const job = draft.artworkGeneration!.jobs[jobKey(purpose)];
      // A reloaded running request resumes through the same idempotent API key.
      return canResumeArtwork(draft, purpose) && (job.status === "pending" || job.status === "running") && !attempted.current.has(requestKey(draft, purpose));
    });
    if (next) void runJob(next);
    else {
      const target = draft.artworkGeneration.cardJobs?.find((j) => canResumeCardArtwork(draft, j) && ["pending", "running"].includes(j.job.status) && !attempted.current.has(cardRequestKey(draft, j)));
      if (target) void runCardJob(target);
    }
  }, [draft, activity, enabled, runJob, runCardJob]);

  const retry = useCallback(async (purpose: ArtPurpose, another = false) => {
    if (active.current !== null) return;
    const saved = prepared.current.get(purpose);
    const job = current.current.artworkGeneration?.jobs[jobKey(purpose)];
    if (!another && saved && job?.failureKind === "storage") { await applyPrepared(purpose, saved); return; }
    if (another) prepared.current.delete(purpose);
    attempted.current.delete(requestKey(current.current, purpose));
    await updateJob(purpose, (next) => {
      if (another || next.failureKind === "decode") next.revision += 1;
      next.status = "pending"; delete next.message; delete next.failureKind;
    }, `Queued ${purposeLabel(purpose).toLowerCase()} artwork`);
    // Explicit retry may repair a broken saved selection that auto-resume must preserve.
    await runJob(purpose, true);
  }, [applyPrepared, runJob, updateJob]);

  const saveDirection = useCallback(async (direction: GameArtDirection) => {
    const next = structuredClone(current.current);
    next.artworkGeneration ??= initialArtworkGeneration(next);
    const previous = next.artworkGeneration.direction;
    next.artworkGeneration.direction = direction;
    for (const purpose of ART_PURPOSES) {
      const job = next.artworkGeneration.jobs[jobKey(purpose)];
      if (job.status === "not-needed") continue;
      const changed = !previous || previous.style !== direction.style || (purpose === "cover" ? previous.coverPrompt !== direction.coverPrompt : previous.cardBackPrompt !== direction.cardBackPrompt);
      if (changed) {
        job.revision += 1; job.status = "pending";
        delete job.message; delete job.failureKind;
        prepared.current.delete(purpose);
      }
    }
    if (previous?.style !== direction.style) for (const item of next.artworkGeneration.cardJobs ?? []) { item.job.revision++; item.job.status = "pending"; delete item.job.message; delete item.job.failureKind; cardPrepared.current.delete(cardKey(item)); }
    await commit(next, "Updated this game’s art direction");
  }, [commit]);

  const createDirection = useCallback(async () => {
    if (!enabled || active.current !== null) return;
    const starting = current.current;
    const version = epoch.current;
    active.current = "direction"; setActivity("direction"); setDirectionMessage(null);
    try {
      const rulebook = starting.bundle.files.find((file) => file.path === "runtime/rules.md")?.content ?? "";
      const result = await callbacks.current.api.generateArtDirection({ title: starting.title, rulebook });
      if (!mounted.current || epoch.current !== version || current.current.id !== starting.id) return;
      if (current.current.title !== starting.title || current.current.bundle.integrity.manifestHash !== starting.bundle.integrity.manifestHash) {
        setDirectionMessage("Your game changed while its art direction was being chosen. Retry to use the current rules.");
        return;
      }
      if (!result.ok) { setDirectionMessage(result.error.message); return; }
      await saveDirection(result.value);
    } catch { if (mounted.current && epoch.current === version) setDirectionMessage("Art direction could not be created. Retry without regenerating your game."); }
    finally { if (mounted.current && epoch.current === version) { active.current = null; setActivity(null); } }
  }, [enabled, saveDirection]);

  const replaceImage = useCallback(async (purpose: ArtPurpose, artwork: ReadyDraftArtwork | undefined) => {
    const next = withManualArtwork(current.current, purpose, artwork);
    prepared.current.delete(purpose);
    if (!await commit(next, `${artwork ? "Replaced" : "Removed"} ${purposeLabel(purpose).toLowerCase()} image`)) {
      throw new Error("Your artwork is available in this tab, but browser storage could not save it. Download the draft or free storage and retry saving.");
    }
  }, [commit]);

  const saveCardDesigns = useCallback(async (designs: CardDesigns, manualTarget?: Pick<CardArtBrief, "kind" | "targetId">) => {
    if (active.current) throw new Error("Wait for the current artwork operation, then save card designs.");
    const next = structuredClone(current.current), previous = currentCardDesigns(next); attachCardDesigns(next, designs);
    for (const target of next.artworkGeneration?.cardJobs ?? []) {
      const selected = selectedCardImage(designs, target), old = selectedCardImage(previous, target);
      if (selected?.info.sha256 !== old?.info.sha256 || (manualTarget && cardKey(manualTarget as CardArtBrief) === cardKey(target))) {
        target.job = { status: selected ? "ready" : "not-needed", revision: target.job.revision + 1, ...(selected ? { outputSha256: selected.info.sha256 } : {}) };
        cardPrepared.current.delete(cardKey(target));
      }
    }
    if (!await commit(next, "Edited printed cards and deck artwork")) throw new Error("Card designs are available in this tab but could not be saved. Download the editable draft or retry saving.");
  }, [commit]);

  const runReview = useCallback(async () => {
    if (!enabled || active.current !== null || !artworkJobsReady(current.current)) return;
    const starting = current.current;
    const manifestHash = starting.bundle.integrity.manifestHash;
    const version = epoch.current;
    reviewed.current.add(manifestHash);
    const review = callbacks.current.api.reviewArtworkDraft;
    if (!review) { setReviewMessage("Updated game checks are unavailable. The earlier review remains marked as out of date."); return; }
    active.current = "review"; setActivity("review"); setReviewMessage(null);
    const stillCurrent = () => mounted.current && version === epoch.current && current.current.id === starting.id && current.current.bundle.integrity.manifestHash === manifestHash;
    try {
      const result = await review.call(callbacks.current.api, starting.bundle);
      if (!stillCurrent()) return;
      if (!result.ok) { setReviewMessage(result.error.message); return; }
      const generationReview = acceptedArtworkReview(manifestHash, result.value);
      const next = structuredClone(current.current);
      next.generationReview = generationReview;
      await commit(next, "Checked the draft with its artwork");
    } catch (error) {
      if (stillCurrent()) setReviewMessage(error instanceof Error ? error.message : "Updated game checks could not finish. The previous review is preserved.");
    } finally {
      if (mounted.current && version === epoch.current) { active.current = null; setActivity(null); }
    }
  }, [commit, enabled]);

  useEffect(() => {
    const hash = draft.bundle.integrity.manifestHash;
    if (enabled && active.current === null && artworkNeedsAutomaticReview(draft) && !reviewed.current.has(hash)) void runReview();
  }, [draft, enabled, activity, runReview]);

  const selectedImage = (purpose: ArtPurpose) => selectedDraftImage(draft, purpose);
  const retrySaving = async () => {
    for (const purpose of ART_PURPOSES) {
      const result = prepared.current.get(purpose);
      if (result && current.current.artworkGeneration?.jobs[jobKey(purpose)].failureKind === "storage") await applyPrepared(purpose, result);
    }
    for (const item of current.current.artworkGeneration?.cardJobs ?? []) {
      const saved = cardPrepared.current.get(cardKey(item));
      if (saved && item.job.failureKind === "storage") await applyCardPrepared(item, saved);
    }
    return commit(current.current, "Saved artwork draft");
  };
  return { saveCardDesigns, retryCardArtwork, preparedCardImage: (target: CardArtBrief) => cardPrepared.current.get(cardKey(target))?.artwork, activity, storageMessage, directionMessage, reviewMessage, retryReview: runReview, retry, createDirection, saveDirection, replaceImage,
    selectedImage, preparedImage: (purpose: ArtPurpose) => prepared.current.get(purpose)?.artwork,
    retrySaving, currentDraft: () => current.current };
}

export type DraftArtworkController = ReturnType<typeof useDraftArtworkGeneration>;
