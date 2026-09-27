import { useState } from "react";

const CONTROLS = [
  ["LMB drag", "Move a piece"],
  ["RMB drag", "Orbit the camera"],
  ["MMB drag", "Pan the camera"],
  ["Wheel", "Zoom; rotate while holding"],
  ["Q / E", "Rotate held or hovered piece 15°"],
  ["F", "Flip held or hovered card"],
  ["R", "Roll hovered die or shuffle hovered deck"],
  ["Alt / Option + click", "Ping the table"],
  ["Space", "Reset camera"],
  ["Right-click / hold", "Object actions and Ping here"],
] as const;

export function ControlsHelp() {
  const [open, setOpen] = useState(false);
  return <>
    <button className="controls-help-toggle" type="button" aria-label="Show table controls" onClick={() => setOpen(true)}>?</button>
    {!open ? null : <div className="controls-help-backdrop" onPointerDown={() => setOpen(false)}>
      <aside className="controls-help" role="dialog" aria-modal="true" aria-label="Table controls" onPointerDown={(event) => event.stopPropagation()}>
        <div className="panel-heading"><span>Controls</span><button type="button" aria-label="Close controls" onClick={() => setOpen(false)}>×</button></div>
        <dl>{CONTROLS.map(([binding, result]) => <div key={binding}><dt>{binding}</dt><dd>{result}</dd></div>)}</dl>
      </aside>
    </div>}
  </>;
}
