export type LoginState = "entry" | "sending" | "sent";

export function loginAfterSubmit(ok: boolean): LoginState {
  return ok ? "sent" : "entry";
}
