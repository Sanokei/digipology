import { useEffect, useState } from "react";
import { sha256 } from "digipology-canonical-json";
import { parseCardDesigns } from "digipology-protocol";
import { verifyArtwork } from "../editor/state/artwork";
/** A good header is insufficient: real decode is part of publication readiness. */
export function useCardArtworkIssue(content: string | null | undefined) {
  const [result, setResult] = useState<{ content: string | null | undefined; issue: string | null }>({ content: undefined, issue: null });
  useEffect(() => {
    let active = true;
    void (async () => {
      try { if (content) for (const asset of parseCardDesigns(content, sha256).assets) await verifyArtwork(asset.artwork); if (active) setResult({ content, issue: null }); }
      catch (error) { if (active) setResult({ content, issue: error instanceof Error ? error.message : "Replace or remove damaged card images before publishing." }); }
    })();
    return () => { active = false; };
  }, [content]);
  return result.content === content ? result.issue : content ? "Checking card images…" : null;
}
