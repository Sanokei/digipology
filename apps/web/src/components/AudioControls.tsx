import "./tableFeedback.css";

export function AudioControls({ muted, volume, toggleMuted, setVolume }: {
  muted: boolean; volume: number; toggleMuted(): void; setVolume(value: number): void;
}) {
  return <details className="table-audio">
    <summary aria-label="Sound settings">♫ <span>Sound</span></summary>
    <div className="table-audio__settings">
      <strong>Table sounds</strong>
      <button type="button" aria-pressed={muted} onClick={toggleMuted}>{muted ? "Unmute sound" : "Mute sound"}</button>
      <label>Volume <input aria-label="Sound volume" type="range" min="0" max="100" value={Math.round(volume * 100)} onChange={(event) => setVolume(Number(event.currentTarget.value) / 100)} /></label>
    </div>
  </details>;
}
