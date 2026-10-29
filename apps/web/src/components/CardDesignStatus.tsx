import { useEffect, useMemo, useState } from "react";
import type { CardDesigns } from "digipology-protocol";
import { cardAssetImage } from "../scene/cardDesigns";
import { retryCardBackImage, watchCardBackImage, type BackImageSnapshot } from "../scene/cardBackImages";

/** One public status/retry for scoped images; never reads a private hand or face. */
export function CardDesignStatus({ designs }: { designs: CardDesigns }) {
  const images = useMemo(() => designs.assets.map((asset) => cardAssetImage(asset, asset.id)), [designs]);
  const [states, setStates] = useState<Record<string, BackImageSnapshot["status"]>>({});
  useEffect(() => {
    setStates({});
    const releases = images.map((image) => watchCardBackImage(image, (next) => setStates((previous) => ({ ...previous, [image.key]: next.status }))));
    return () => { for (const release of releases) release(); };
  }, [images]);
  const pending = designs.families.some((f) => !images.some((image) => image.key === designs.assets.find((a) => a.id === f.backAssetId)?.artwork.info.sha256));
  const failed = images.filter((image) => states[image.key] === "failed");
  const status = failed.length ? "failed" : images.some((image) => states[image.key] !== "ready") ? "loading" : pending ? "pending" : "ready";
  return <aside className="table-back-status" data-card-back-state={status} hidden={status === "ready"} role={status === "failed" ? "alert" : "status"}>
    {status === "failed" ? "Some card images could not load. Your rules and selected images are preserved." : status === "pending" ? "Some families are waiting for their card-back artwork." : "Loading this game’s card artwork…"}
    {failed.length ? <button type="button" onClick={() => { for (const image of failed) retryCardBackImage(image); }}>Retry card artwork</button> : null}
  </aside>;
}
