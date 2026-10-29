import { useEffect, useMemo, useState } from "react";
import { ReadingDialog } from "../components/RulebookDialog";
import { AudioControls } from "../components/AudioControls";
import { useTableAudio } from "../audio/useTableAudio";
import { parseSoundBundle } from "../audio/bundle";
import { KernelStore } from "../state/kernelStore";
import { SOUND_BUNDLE_LIMIT, type SoundBundle } from "digipology-protocol";

export function SoundBundleDialog({ onClose, onSave }: { onClose(): void; onSave(content: string): boolean }) {
  const store = useMemo(() => new KernelStore(), []);
  const [content, setContent] = useState<string | null>(null);
  const [bundle, setBundle] = useState<SoundBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audio = useTableAudio(store, false, "", content);
  useEffect(() => () => store.dispose(), [store]);
  return <ReadingDialog heading="Add a sound bundle" eyebrow="Presentation assets" closeLabel="Close sound import" bodyLabel="Sound bundle import" onClose={onClose}>
    <div className="sound-import"><p>Keep these clips and their credits with this game. Editable backups and published releases include the sounds. Your rules and starting position stay the same.</p>
      <label>Sound bundle JSON<input type="file" accept="application/json,.json" onChange={(event) => {
        const file = event.currentTarget.files?.[0]; if (!file) return;
        setError(null);
        void (async () => { try {
          if (file.size > SOUND_BUNDLE_LIMIT) throw new Error("Sound bundle exceeds 384 KiB.");
          const raw = await file.text(), next = parseSoundBundle(raw);
          setContent(raw); setBundle(next);
        } catch (caught) { setError(caught instanceof Error ? caught.message : "The sound bundle could not be read."); } })();
      }} /></label>
      {error ? <p role="alert">{error} Your current game sounds are preserved.</p> : null}
      {bundle ? <><h3>{bundle.title} · v{bundle.version}</h3><ul>{bundle.clips.map((clip) => <li key={clip.cue}>{clip.title} ({clip.cue}) · {clip.source.creator} · {clip.source.license}</li>)}</ul><p>A previous automated playtest will be marked out of date. Review your changes before publishing.</p><details><summary>Release file details</summary><code>runtime/presentation/table-sounds.json</code></details></> : <p>Download a portable bundle from a table’s Sound settings, or build one with the media harness.</p>}
      <div className="sound-import__audition"><AudioControls {...audio} /></div>
      <button type="button" disabled={!content || error !== null || audio.status.state !== "ready"} onClick={() => { try { if (content && onSave(content)) onClose(); else setError("The bundle could not be attached."); } catch (caught) { setError(caught instanceof Error ? caught.message : "The bundle could not be attached."); } }}>Use in this game</button>
    </div>
  </ReadingDialog>;
}
