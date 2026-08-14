import { useState, type ReactNode } from "react";
import { canonicalizeTransform, type EntityComponents } from "digipology-kernel";

import {
  EDITOR_COMPONENT_TYPES,
  componentDependents,
  useEditorSnapshot,
  type EditorStore,
} from "../../state";
import { CommitTextInput, ComponentCard, Field, NumberInput, PanelEmptyState } from "../common/PanelComponents";

function setPath(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let cursor = target;
  for (const segment of path.slice(0, -1)) {
    const next = cursor[segment];
    if (typeof next !== "object" || next === null || Array.isArray(next)) throw new TypeError("That field is unavailable.");
    cursor = next as Record<string, unknown>;
  }
  cursor[path.at(-1)!] = value;
}

function getPath(target: Record<string, unknown>, path: readonly string[]): unknown {
  let cursor: unknown = target;
  for (const segment of path) {
    if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function BoolField({ label, value, onCommit }: { label: string; value: boolean; onCommit: (value: boolean) => void }) {
  return <label className="editor-check"><input type="checkbox" checked={value} onChange={(event) => onCommit(event.currentTarget.checked)} />{label}</label>;
}

function ComponentFields({ type, component, store }: { type: string; component: Record<string, unknown>; store: EditorStore }) {
  const text = (label: string, path: string[], multiline = false) => <Field label={label}><CommitTextInput multiline={multiline}
    value={String(getPath(component, path) ?? "")}
    onCommit={(value) => store.updateComponent(type, `Updated ${type} ${label.toLowerCase()}`, (next) => setPath(next, path, value))} /></Field>;
  const bool = (label: string, path: string[]) => <BoolField label={label} value={getPath(component, path) === true}
    onCommit={(value) => store.updateComponent(type, `Updated ${type} ${label.toLowerCase()}`, (next) => setPath(next, path, value))} />;
  const number = (label: string, path: string[], options: { min?: number; max?: number; step?: number } = {}) => {
    const value = Number(getPath(component, path) ?? 0);
    return <Field label={label}><NumberInput label={label.slice(0, 1).toUpperCase()} value={value} {...options}
      onCommit={(nextValue) => store.updateComponent(type, `Updated ${type} ${label.toLowerCase()}`, (next) => setPath(next, path, nextValue))}
      onDragStart={() => store.beginCoalescedSceneCommand(`Adjusted ${type} ${label.toLowerCase()}`)}
      onPreview={(nextValue) => store.previewComponent(type, (next) => setPath(next, path, nextValue))}
      onDragEnd={() => store.endCoalescedSceneCommand()} /></Field>;
  };
  if (type === "transform") return <>
    <div className="editor-vector"><span>Position</span>{(["x", "y", "z"] as const).map((axis) => <span key={axis}>{number(axis, ["position", axis])}</span>)}</div>
    <div className="editor-vector"><span>Rotation</span>{(["x", "y", "z", "w"] as const).map((axis) => <span key={axis}>{number(axis, ["rotation", axis], { step: 0.01 })}</span>)}</div>
    <div className="editor-vector"><span>Scale</span>{(["x", "y", "z"] as const).map((axis) => <span key={axis}>{number(axis, ["scale", axis], { min: 0.0001 })}</span>)}</div>
  </>;
  if (type === "grabbable") return <>{bool("Enabled", ["enabled"])}<p className="editor-field-note">Held by: {String(component.heldBy ?? "nobody")}</p></>;
  if (type === "flippable") return bool("Flipped", ["flipped"]);
  if (type === "card") return <>{text("Face / back definition", ["definitionId"])}{bool("Face up", ["faceUp"])}</>;
  if (type === "container") return <>
    {text("Contents (entity ids, comma separated)", ["itemsText"])}
    {number("Capacity (-1 is unlimited)", ["capacityEditor"], { min: -1, step: 1 })}
    {text("Ordering", ["ordering"])}{text("Visibility", ["visibility"])}
  </>;
  if (type === "deck") return bool("Deck enabled", ["enabled"]);
  if (type === "counter") return <>{number("Value", ["value"])}{number("Default", ["default"])}{number("Step", ["step"])}{number("Minimum", ["minEditor"])}{number("Maximum", ["maxEditor"])}</>;
  if (type === "hand") return <>{text("Owner seat", ["owner"])}{bool("Canonical order", ["canonicalOrder"])}</>;
  if (type === "die") return <>{text("Definition", ["definitionId"])}{text("Current face", ["value"])}{number("Sides", ["sidesEditor"], { min: 2, max: 100, step: 1 })}</>;
  if (type === "zone") return <>
    <Field label="Shape"><select value={String(component.shape ?? "box")} onChange={(event) => store.updateComponent(type, "Changed zone shape", (next) => { next.shape = event.currentTarget.value; })}><option value="box">Box</option><option value="sphere">Sphere</option></select></Field>
    {text("Accepted tags", ["acceptedTagsText"])}{bool("Visible in play", ["visibleInPlay"])}<p className="editor-field-note">Bounds use the attached Transform scale.</p>
  </>;
  if (type === "snap-point") return <>{number("Radius", ["radius"], { min: 0 })}{number("Capacity", ["capacity"], { min: 1, step: 1 })}{text("Tags", ["tagsText"])}{text("Offsets / alignment JSON", ["alignmentText"], true)}</>;
  if (type === "text") return text("Content", ["value"], true);
  if (type === "button") return <>{text("Label", ["label"])}{bool("Enabled", ["enabled"])}</>;
  if (type === "script") return <>{text("Script id", ["scriptId"])}{text("Binding id", ["bindingId"])}{text("Binding props JSON", ["propsText"], true)}</>;
  return <pre className="editor-json-preview">{JSON.stringify(component, null, 2)}</pre>;
}

function prepareEditorFields(type: string, value: unknown): Record<string, unknown> {
  const component = structuredClone(value) as Record<string, unknown>;
  if (type === "container") {
    component.itemsText = Array.isArray(component.items) ? component.items.join(", ") : "";
    component.capacityEditor = component.capacity ?? -1;
  } else if (type === "counter") {
    component.minEditor = component.min;
    component.maxEditor = component.max;
  } else if (type === "die") {
    component.sidesEditor = Array.isArray(component.faces) ? component.faces.length : 6;
  } else if (type === "zone") {
    component.acceptedTagsText = Array.isArray(component.acceptedTags) ? component.acceptedTags.join(", ") : "";
  } else if (type === "snap-point") {
    component.tagsText = Array.isArray(component.tags) ? component.tags.join(", ") : "";
    component.alignmentText = JSON.stringify(component.alignment ?? {}, null, 2);
  } else if (type === "script") {
    component.propsText = JSON.stringify(component.props ?? {}, null, 2);
  }
  return component;
}

function normalizeEditorFields(type: string, component: Record<string, unknown>): void {
  if (type === "transform") {
    Object.assign(component, canonicalizeTransform(component));
  } else if (type === "container") {
    component.items = String(component.itemsText ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    component.capacity = Number(component.capacityEditor) < 0 ? null : Math.round(Number(component.capacityEditor));
    delete component.itemsText; delete component.capacityEditor;
  } else if (type === "counter") {
    component.min = component.minEditor === null ? null : Number(component.minEditor);
    component.max = component.maxEditor === null ? null : Number(component.maxEditor);
    delete component.minEditor; delete component.maxEditor;
  } else if (type === "die") {
    const sides = Math.round(Number(component.sidesEditor));
    component.faces = Array.from({ length: sides }, (_, index) => index + 1);
    if (typeof component.value === "string" && /^\d+$/.test(component.value)) component.value = Number(component.value);
    delete component.sidesEditor;
  } else if (type === "zone") {
    component.acceptedTags = String(component.acceptedTagsText ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    delete component.acceptedTagsText;
  } else if (type === "snap-point") {
    component.tags = String(component.tagsText ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    if (typeof component.alignmentText === "string") component.alignment = JSON.parse(component.alignmentText) as unknown;
    delete component.tagsText; delete component.alignmentText;
  } else if (type === "script") {
    if (typeof component.propsText === "string") component.props = JSON.parse(component.propsText) as unknown;
    delete component.propsText;
  }
}

export function InspectorPanel({ store }: { store: EditorStore }) {
  const snapshot = useEditorSnapshot(store);
  const entity = snapshot.selectedEntity;
  const [addType, setAddType] = useState("transform");
  if (entity === null) return <section className="editor-panel inspector-panel"><div className="editor-panel-heading">Inspector</div><PanelEmptyState>Select an entity in the Hierarchy to edit its components.</PanelEmptyState></section>;
  const components = entity.components as Record<string, unknown>;
  const attached = Object.keys(components).sort();
  const available = EDITOR_COMPONENT_TYPES.filter((type) => components[type] === undefined);
  const updatePrepared = (type: string, label: string, mutation: (component: Record<string, unknown>) => void, preview = false) => {
    const action = (component: Record<string, unknown>) => {
      const editable = prepareEditorFields(type, component);
      mutation(editable);
      normalizeEditorFields(type, editable);
      for (const key of Object.keys(component)) delete component[key];
      Object.assign(component, editable);
    };
    return preview ? store.previewComponent(type, action) : store.updateComponent(type, label, action);
  };
  const proxyStore = {
    beginCoalescedSceneCommand: (label: string) => store.beginCoalescedSceneCommand(label),
    endCoalescedSceneCommand: (label?: string) => store.endCoalescedSceneCommand(label),
    updateComponent: (type: string, label: string, mutate: (component: Record<string, unknown>) => void) => updatePrepared(type, label, mutate),
    previewComponent: (type: string, mutate: (component: Record<string, unknown>) => void) => updatePrepared(type, "Preview", mutate, true),
  } as EditorStore;
  return <section className="editor-panel inspector-panel">
    <div className="editor-panel-heading"><span>{entity.id}</span><small>{attached.length} components</small></div>
    <div className="editor-panel-scroll">
      {attached.map((type) => {
        const dependents = componentDependents(entity.components as EntityComponents, type);
        return <ComponentCard key={type} title={type} onRemove={() => {
          if (!store.removeComponent(type) && dependents.length > 0) store.log(`${type} is required by ${dependents.join(", ")}.`, "warning");
        }}><ComponentFields type={type} component={prepareEditorFields(type, components[type])} store={proxyStore} /></ComponentCard>;
      })}
      {available.length === 0 ? null : <div className="editor-add-component"><select aria-label="Component to add" value={available.includes(addType as typeof available[number]) ? addType : available[0]}
        onChange={(event) => setAddType(event.currentTarget.value)}>{available.map((type) => <option key={type} value={type}>{type}</option>)}</select>
        <button type="button" onClick={() => store.addComponent(available.includes(addType as typeof available[number]) ? addType : available[0]!)}>Add component</button></div>}
    </div>
  </section>;
}
