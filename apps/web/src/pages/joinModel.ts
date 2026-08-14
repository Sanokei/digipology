export type JoinErrorKind = "not_found" | "full" | "ended" | "failed";

export interface JoinErrorView {
  title: string;
  message: string;
  action: "home" | "retry";
  actionLabel: string;
}

export function joinErrorKind(code: string): JoinErrorKind {
  switch (code) {
    case "not_found": return "not_found";
    case "full": return "full";
    case "ended": return "ended";
    default: return "failed";
  }
}

export function joinErrorView(kind: JoinErrorKind): JoinErrorView {
  switch (kind) {
    case "not_found": return { title: "Table not found", message: "Check the invite code or ask the host for a fresh link.", action: "home", actionLabel: "Try another code" };
    case "full": return { title: "Table is full", message: "Every seat is taken. You can try again if someone leaves.", action: "retry", actionLabel: "Try again" };
    case "ended": return { title: "This table has ended", message: "The session is over, but you can start a new table anytime.", action: "home", actionLabel: "Host a new table" };
    case "failed": return { title: "Couldn’t join", message: "The table may be temporarily unavailable. Your place has not been changed.", action: "retry", actionLabel: "Try again" };
  }
}
