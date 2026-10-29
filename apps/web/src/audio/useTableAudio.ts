import { useEffect, useState } from "react";
import type { KernelStore } from "../state/kernelStore";
import { gameProgress } from "../pages/gameProgress";
import { TableAudio } from "./TableAudio";
import { cuesForEvents } from "./cues";

const KEY = "digipology.audio";
function preferences(): { volume: number; muted: boolean } {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return { volume: typeof value?.volume === "number" && Number.isFinite(value.volume) ? Math.max(0, Math.min(1, value.volume)) : 0.65, muted: value?.muted === true };
  } catch { return { volume: 0.65, muted: false }; }
}

export function useTableAudio(store: KernelStore, connected: boolean) {
  const [settings, setSettings] = useState(preferences);
  const [engine, setEngine] = useState<TableAudio | null>(null);
  useEffect(() => {
    const audio = new TableAudio();
    setEngine(audio);
    const unlock = () => { void audio.unlock(); };
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
      void audio.dispose();
    };
  }, [store]);
  useEffect(() => {
    engine?.setLevel(settings.volume, settings.muted);
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* Private browsing may reject storage. */ }
  }, [engine, settings]);
  useEffect(() => {
    if (!engine || !connected) return;
    let lastSequence = store.getSnapshot().state?.sequence ?? -1;
    let previousWinner = gameProgress(store.getSnapshot().state).winnerId;
    return store.subscribe(() => {
      const view = store.getSnapshot();
      const sequence = view.state?.sequence ?? -1;
      if (sequence <= lastSequence) return;
      lastSequence = sequence;
      const winner = gameProgress(view.state).winnerId;
      if (document.visibilityState === "visible") {
        if (winner && winner !== previousWinner) engine.play("victory");
        else for (const cue of cuesForEvents(view.events)) engine.play(cue);
      }
      previousWinner = winner;
    });
  }, [connected, engine, store]);
  return { ...settings, setVolume: (volume: number) => setSettings((current) => ({ ...current, volume })), toggleMuted: () => setSettings((current) => ({ ...current, muted: !current.muted })) };
}
