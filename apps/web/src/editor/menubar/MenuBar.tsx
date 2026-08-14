import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Command, Search } from "lucide-react";

export type MenuAction =
  | { kind: "action"; label: string; shortcut?: string; disabled?: boolean; searchTerms?: string[]; onSelect: () => void }
  | { kind: "separator" }
  | { kind: "header"; label: string }
  | { kind: "submenu"; label: string; actions: MenuAction[] };

function closeMenus(): void {
  document.querySelectorAll<HTMLDetailsElement>(".editor-menu-dropdown[open]").forEach((menu) => menu.removeAttribute("open"));
}

function MenuItem({ action }: { action: MenuAction }): ReactNode {
  if (action.kind === "separator") return <hr />;
  if (action.kind === "header") return <div className="editor-menu-header">{action.label}</div>;
  if (action.kind === "submenu") return <div className="editor-menu-header">{action.label}{action.actions.map((child, index) => <MenuItem key={child.kind === "action" ? child.label : index} action={child} />)}</div>;
  return <button type="button" disabled={action.disabled} onClick={() => { action.onSelect(); closeMenus(); }}><span>{action.label}</span>{action.shortcut === undefined ? null : <kbd>{action.shortcut}</kbd>}</button>;
}

function MenuDropdown({ label, actions }: { label: string; actions: MenuAction[] }) {
  return <details className="editor-menu-dropdown"><summary>{label}</summary><div>{actions.map((action, index) => <MenuItem key={action.kind === "action" ? action.label : `${action.kind}-${index}`} action={action} />)}</div></details>;
}

interface IndexedAction {
  action: Extract<MenuAction, { kind: "action" }>;
  index: string;
}

function flatten(actions: readonly MenuAction[], parent = ""): IndexedAction[] {
  const result: IndexedAction[] = [];
  for (const action of actions) {
    if (action.kind === "action") result.push({ action, index: `${parent} ${action.label} ${action.searchTerms?.join(" ") ?? ""}`.toLowerCase() });
    else if (action.kind === "submenu") result.push(...flatten(action.actions, `${parent} ${action.label}`));
  }
  return result;
}

export function fuzzyCommandMatch(query: string, candidate: string): boolean {
  const needle = query.toLowerCase().replaceAll(/\s+/g, "");
  const haystack = candidate.toLowerCase().replaceAll(/\s+/g, "");
  let index = 0;
  for (const character of haystack) if (character === needle[index]) index += 1;
  return needle.length > 0 && index === needle.length;
}

export function MenuBar({ actions, status }: { actions: Record<"File" | "Edit" | "Window", MenuAction[]>; status: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const commands = useMemo(() => flatten([...actions.File, ...actions.Edit, ...actions.Window]), [actions]);
  const matches = query === "" ? commands.slice(0, 10) : commands.filter((command) => fuzzyCommandMatch(query, command.index)).slice(0, 12);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPaletteOpen(true); }
      if (event.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  useEffect(() => { if (paletteOpen) queueMicrotask(() => inputRef.current?.focus()); }, [paletteOpen]);
  return <header className="editor-menubar">
    <a href="/" className="editor-brand">DGP <span>Editor</span></a>
    <nav aria-label="Editor menu"><MenuDropdown label="File" actions={actions.File} /><MenuDropdown label="Edit" actions={actions.Edit} /><MenuDropdown label="Window" actions={actions.Window} /></nav>
    <button type="button" className="editor-command-button" onClick={() => setPaletteOpen(true)}><Command size={14} /> Commands <kbd>Ctrl K</kbd></button>
    <div className="editor-menu-status">{status}</div>
    {paletteOpen ? <div className="editor-palette-backdrop" role="presentation" onMouseDown={() => setPaletteOpen(false)}><section className="editor-palette" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(event) => event.stopPropagation()}>
      <label><Search size={16} /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search editor commands…" /></label>
      <div>{matches.map(({ action }) => <button type="button" key={action.label} disabled={action.disabled} onClick={() => { action.onSelect(); setPaletteOpen(false); setQuery(""); }}><span>{action.label}</span>{action.shortcut === undefined ? null : <kbd>{action.shortcut}</kbd>}</button>)}</div>
    </section></div> : null}
  </header>;
}
