import { useCallback, useEffect, useRef, useState } from "react";
import type { ReadyDraftArtwork } from "digipology-protocol";
import { rebuildDraftIntegrity } from "../editor/state/bundle";
import { attachCardBack } from "../editor/state/cardBack";
import { ART_PURPOSES, artworkJobsReady, initialArtworkGeneration, jobKey, purposeLabel, selectedDraftImage, type ArtPurpose, type ArtworkApi, type ArtworkDraft, type GameArtDirection, type PreparedResult } from "./model";
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
  const active = useRef<ArtPurpose | "direction" | "review" | null>(null);
  const attempted = useRef(new Set<string>());
  const reviewed = useRef(new Set<string>());
  const prepared = useRef(new Map<ArtPurpose, PreparedResult>());
  const preparedOwner = useRef(draft.id);
  if (preparedOwner.current !== draft.id) { prepared.current.clear(); preparedOwner.current = draft.id; }
  const [activity, setActivity] = useState<ArtPurpose | "direction" | "review" | null>(null);
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
      else { attachCardBack(next, result.artwork); rebuildDraftIntegrity(next); }
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

  const runJob = useCallback(async (purpose: ArtPurpose) => {
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
      try { artwork = await prepareGeneratedArtwork(response.value, purpose); }
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

  useEffect(() => {
    if (!enabled || active.current !== null || !draft.artworkGeneration?.direction) return;
    const next = ART_PURPOSES.find((purpose) => {
      const job = draft.artworkGeneration!.jobs[jobKey(purpose)];
      // A reloaded running request resumes through the same idempotent API key.
      return (job.status === "pending" || job.status === "running") && !attempted.current.has(requestKey(draft, purpose));
    });
    if (next) void runJob(next);
  }, [draft, activity, enabled, runJob]);

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
  }, [applyPrepared, updateJob]);

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

  const replaceImage = useCallback(async (purpose: ArtPurpose, artwork: ReadyDraftArtwork) => {
    const next = structuredClone(current.current);
    next.artworkGeneration ??= initialArtworkGeneration(next);
    const job = next.artworkGeneration.jobs[jobKey(purpose)];
    job.revision += 1; job.status = "ready"; job.outputSha256 = artwork.info.sha256;
    delete job.message; delete job.failureKind; delete job.assetId; delete job.selectedAssetId; delete job.originalSha256;
    prepared.current.delete(purpose);
    if (purpose === "cover") next.artwork = artwork;
    else { attachCardBack(next, artwork); rebuildDraftIntegrity(next); }
    await commit(next, `Replaced ${purposeLabel(purpose).toLowerCase()} image`);
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
    if (enabled && active.current === null && artworkJobsReady(draft) && draft.generationReview?.manifestHash !== hash && !reviewed.current.has(hash)) void runReview();
  }, [draft, enabled, activity, runReview]);

  const selectedImage = (purpose: ArtPurpose) => selectedDraftImage(draft, purpose);
  const retrySaving = async () => {
    for (const purpose of ART_PURPOSES) {
      const result = prepared.current.get(purpose);
      if (result && current.current.artworkGeneration?.jobs[jobKey(purpose)].failureKind === "storage") await applyPrepared(purpose, result);
    }
    return commit(current.current, "Saved artwork draft");
  };
  return { activity, storageMessage, directionMessage, reviewMessage, retryReview: runReview, retry, createDirection, saveDirection, replaceImage,
    selectedImage, preparedImage: (purpose: ArtPurpose) => prepared.current.get(purpose)?.artwork,
    retrySaving, currentDraft: () => current.current };
}

export type DraftArtworkController = ReturnType<typeof useDraftArtworkGeneration>;
