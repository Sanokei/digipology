import { useSyncExternalStore } from "react";
import type { KernelStore } from "./kernelStore";

export function useKernelStore(store: KernelStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
