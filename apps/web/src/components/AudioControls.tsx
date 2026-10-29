import "./tableFeedback.css";
import type { SoundCue } from "digipology-protocol";
import type { AudioStatus } from "../audio/TableAudio";
import { downloadBlob } from "../editor/state/artwork";

export function AudioControls({ muted, volume, toggleMuted, setVolume, status, retrySounds, testSound }: {
  muted: boolean; volume: number; toggleMuted(): void; setVolume(value: number): void;
  status: AudioStatus; retrySounds(): void; testSound(cue?: SoundCue): Promise<void>;
}) {
  return <details className="table-audio">
    <summary aria-label="Sound settings">♫ <span>Sound</span></summary>
    <div className="table-audio__settings" data-audio-state={status.state} data-sound-pack={status.bundle ? `${status.bundle.id}@${status.bundle.version}` : "simple"}>
      <strong>Table sounds</strong>
      <button type="button" aria-pressed={muted} onClick={toggleMuted}>{muted ? "Unmute sound" : "Mute sound"}</button>
      <label>Volume <input aria-label="Sound volume" type="range" min="0" max="100" value={Math.round(volume * 100)} onChange={(event) => setVolume(Number(event.currentTarget.value) / 100)} /></label>
      <p role="status">{status.state === "loading" ? "Loading source sounds…" : status.state === "locked" ? "Click Test sound to enable playback." : status.state === "ready" ? `${status.bundle?.title} · v${status.bundle?.version}` : "Source sounds unavailable. Simple tones are active."}</p>
      <button type="button" disabled={muted || volume === 0 || status.state === "loading" || status.state === "unavailable"} onClick={() => void testSound()}>Test sound</button>
      {status.error ? <><p role="alert">{status.error}</p><button type="button" onClick={retrySounds}>Retry source sounds</button></> : null}
      {status.bundle ? <>
        <p className="table-audio__note">{status.bundle.clips.length} source clips; other cues use simple tones. Sounds pause in background tabs.</p>
        <details className="sound-credits"><summary>Sources and credits</summary>{status.bundle.clips.map((clip) => <div key={clip.cue}>
          <strong>{clip.title}</strong><p>{clip.cue} · {clip.source.creator}</p>
          <a href={clip.source.url} target="_blank" rel="noopener noreferrer">Original source</a>{" · "}<a href={clip.source.licenseUrl} target="_blank" rel="noopener noreferrer">{clip.source.license}</a>
          <button type="button" disabled={muted || volume === 0} onClick={() => void testSound(clip.cue)}>Preview {clip.cue} sound</button>
        </div>)}</details>
        <button type="button" onClick={() => downloadBlob(new Blob([JSON.stringify(status.bundle, null, 2) + "\n"], { type: "application/json" }), `${status.bundle!.id}-v${status.bundle!.version}.sounds.json`)}>Download sound bundle</button>
      </> : null}
    </div>
  </details>;
}
