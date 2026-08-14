export const HOVER_INTENT_MS = 350;

export type ScheduleHover = (callback: () => void, delayMs: number) => unknown;
export type CancelHover = (handle: unknown) => void;

export interface HoverIntentModel {
  enter(): void;
  leave(): void;
  dispose(): void;
}

export function createHoverIntentModel(
  schedule: ScheduleHover,
  cancel: CancelHover,
  reveal: () => void,
): HoverIntentModel {
  let handle: unknown | null = null;

  const clear = () => {
    if (handle === null) return;
    cancel(handle);
    handle = null;
  };

  return {
    enter() {
      clear();
      handle = schedule(() => {
        handle = null;
        reveal();
      }, HOVER_INTENT_MS);
    },
    leave: clear,
    dispose: clear,
  };
}

export type CapsuleKeyboardAction = "quickplay" | null;

export function capsuleKeyboardAction(key: string): CapsuleKeyboardAction {
  return key === "Enter" ? "quickplay" : null;
}
