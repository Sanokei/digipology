import { useEffect, useState } from "react";
import type { CardBackDefinition } from "../scene/cardBack";
import { retryCardBackImage, watchCardBackImage, type BackImageSnapshot } from "../scene/cardBackImages";

export function CardBackStatus({ definition }: { definition: CardBackDefinition }) {
  const [state, setState] = useState<BackImageSnapshot>({ status: "loading", image: null });
  useEffect(() => watchCardBackImage(definition, setState), [definition.key, definition.src]);
  const visible = Boolean(definition.issue) || state.status !== "ready";
  return <aside className="table-back-status" data-card-back-state={state.status} data-card-back-key={definition.key} hidden={!visible} role={state.status === "failed" || definition.issue ? "alert" : "status"}>
    {definition.issue ?? (state.status === "failed" ? "The card-back image could not load. A printed back keeps the game playable." : "Loading this game’s card artwork…")}
    {state.status === "failed" ? <button type="button" onClick={() => retryCardBackImage(definition)}>Retry card artwork</button> : null}
  </aside>;
}
