import { useEffect, useState } from "react";
import type { KernelStore } from "../state/kernelStore";
import { gameProgress } from "../pages/gameProgress";
import { TableAudio, type AudioStatus } from "./TableAudio";
import { cuesForEvents } from "./cues";
import type { SoundCue } from "digipology-protocol";

const KEY = "digipology.audio";
function preferences(): { volume: number; muted: boolean } {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return { volume: typeof value?.volume === "number" && Number.isFinite(value.volume) ? Math.max(0, Math.min(1, value.volume)) : 0.65, muted: value?.muted === true };
  } catch { return { volume: 0.65, muted: false }; }
}

export function useTableAudio(store: KernelStore, connected: boolean, playerId: string, bundleOverride?: string | null) {
  const [settings, setSettings] = useState(preferences);
  const [engine, setEngine] = useState<TableAudio | null>(null);
  const [status, setStatus] = useState<AudioStatus>({ state: "loading", bundle: null, error: null });
  const [retry, setRetry] = useState(0);
  const [content, setContent] = useState(store.getSnapshot().soundBundle);
  useEffect(() => { setContent(store.getSnapshot().soundBundle); return store.subscribe(() => setContent(store.getSnapshot().soundBundle)); }, [store]);
  useEffect(() => {
    let active = true;
    const audio = new TableAudio((next) => { if (active) setStatus(next); });
    setEngine(audio);
    const unlock = () => { void audio.unlock(); };
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);
    const visibility = () => audio.setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", visibility); visibility();
    return () => {
      active = false;
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
      document.removeEventListener("visibilitychange", visibility);
      void audio.dispose();
    };
  }, [store]);
  useEffect(() => { if (engine) void engine.loadBundle(bundleOverride === undefined ? content : bundleOverride); }, [engine, content, bundleOverride, retry]);
  useEffect(() => {
    engine?.setLevel(settings.volume, settings.muted);
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* Private browsing may reject storage. */ }
  }, [engine, settings]);
  useEffect(() => {
    if (!engine || !connected) return;
    let lastSequence = store.getSnapshot().state?.sequence ?? -1;
    let previousWinner = gameProgress(store.getSnapshot().state).winnerId;
    let before = store.getSnapshot().state;
    const unsubscribe = store.subscribe(() => {
      const view = store.getSnapshot();
      const sequence = view.state?.sequence ?? -1;
      if (sequence <= lastSequence) return;
      lastSequence = sequence;
      const winner = gameProgress(view.state).winnerId;
      if (document.visibilityState === "visible") {
        if (winner && winner !== previousWinner) engine.play("victory");
        else for (const cue of cuesForEvents(view.events, { before, after: view.state, playerId })) engine.play(cue);
      }
      previousWinner = winner;
      before = view.state;
    });
    return () => { unsubscribe(); engine.stopVoices(); };
  }, [connected, engine, store, playerId]);
  return { ...settings, status, retrySounds: () => setRetry((value) => value + 1), testSound: async (cue?: SoundCue) => { await engine?.unlock(); engine?.play(cue ?? status.bundle?.clips[0]?.cue ?? "card"); }, setVolume: (volume: number) => setSettings((current) => ({ ...current, volume })), toggleMuted: () => setSettings((current) => ({ ...current, muted: !current.muted })) };
}
