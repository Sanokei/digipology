import { createContext, useContext, type ReactNode } from "react";

import type { PlaytestController } from "./PlaytestController";

const Context = createContext<PlaytestController | null>(null);

export function PlaytestProvider({ controller, children }: { controller: PlaytestController; children: ReactNode }) {
  return <Context.Provider value={controller}>{children}</Context.Provider>;
}

export function usePlaytestController(): PlaytestController {
  const value = useContext(Context);
  if (value === null) throw new Error("Playtest panels require PlaytestProvider.");
  return value;
}
