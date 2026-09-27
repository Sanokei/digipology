import { useEffect, useRef, useState } from "react";
import { CHAT_TEXT_MAX_LENGTH } from "digipology-protocol";

import type { ChatModel } from "../pages/tableSocialModel";

export function TableChat({
  model,
  disabled,
  onOpen,
  onClose,
  onSend,
}: {
  model: ChatModel;
  disabled: boolean;
  onOpen(): void;
  onClose(): void;
  onSend(text: string): boolean;
}) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (model.open) listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [model.lines.length, model.open]);

  if (!model.open) return <button className="table-chat-toggle" type="button" onClick={onOpen} aria-label={model.unread > 0 ? `Open chat, ${model.unread} unread` : "Open chat"}>
    Chat{model.unread > 0 ? <span aria-hidden="true">{model.unread > 99 ? "99+" : model.unread}</span> : null}
  </button>;

  return <aside className="table-chat table-sheet" aria-label="Room chat">
    <div className="panel-heading"><span>Room chat</span><button type="button" aria-label="Close chat" onClick={onClose}>×</button></div>
    <div ref={listRef} className="table-chat__lines" aria-live="polite">
      {model.lines.length === 0 ? <p className="table-chat__empty">No messages yet.</p> : model.lines.map((line) => line.message.kind === "system"
        ? <p className="table-chat__system" key={line.id}>{line.message.text}</p>
        : <p key={line.id}><strong>{line.message.displayName}</strong><span>{line.message.text}</span></p>)}
    </div>
    <form onSubmit={(event) => {
      event.preventDefault();
      if (onSend(draft)) setDraft("");
    }}>
      <label className="sr-only" htmlFor="table-chat-input">Message</label>
      <input
        id="table-chat-input"
        value={draft}
        maxLength={CHAT_TEXT_MAX_LENGTH}
        disabled={disabled}
        placeholder="Message the table"
        autoComplete="off"
        onChange={(event) => setDraft(event.currentTarget.value)}
      />
      <button type="submit" disabled={disabled || draft.trim().length === 0}>Send</button>
    </form>
  </aside>;
}
