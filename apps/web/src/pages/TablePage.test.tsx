import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import { HandStrip } from "../components/HandStrip";
import { ConnectionOverlay } from "../components/ConnectionOverlay";
import { InspectOverlay } from "../components/InspectOverlay";
import { TableTopBar } from "../components/TableTopBar";
import { TableHints, readCompletedTableHints } from "../components/TableHints";
import { TableChat } from "../components/TableChat";
import { ControlsHelp } from "../components/ControlsHelp";
import { DiceControls, openPromptsForPlayer, playersPanelOpenByDefault, RendererDiagnostics } from "./TablePage";

test("375px table chrome exposes compact controls and the thumb hand tray", async () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <TableTopBar gameTitle="Pocket Table" playerCount={2} joinCode="ABCD-EFGH" inviteUrl="https://example.test/join" onPlayers={() => {}} onDiagnostics={() => {}} />
      <HandStrip items={[{ entityId: "card-1", label: "Ace", color: "#e7dfc8" }]} />
    </MemoryRouter>,
  );
  expect(html).toContain("table-topbar__players-count");
  expect(html).toContain("Show 2 players");
  expect(html).toContain("hand-strip__cards");
  expect(html).toContain("Inspect Ace");
  expect(playersPanelOpenByDefault(false)).toBe(true);
  expect(playersPanelOpenByDefault(true)).toBe(true);

  const css = await Bun.file(new URL("../styles.css", import.meta.url)).text();
  expect(css).toContain("@media (max-width: 768px)");
  expect(css).toContain("min-height: 40px");
  expect(css).toContain("env(safe-area-inset-top)");
  expect(css).toContain("env(safe-area-inset-bottom)");
  expect(css).toContain(".table-sheet");
  expect(css).toContain("overscroll-behavior: none");
});

test("empty hand remains visible but does not intercept the table", () => {
  const html = renderToStaticMarkup(<HandStrip items={[]} />);
  expect(html).toContain("hand-strip--empty");
  expect(html).toContain("Your hand is empty");
});

test("only exposes the local player's open canonical prompts", () => {
  const state = {
    prompts: {
      mine: { id: "mine", kind: "choice", playerId: "p1", title: "Choose", status: "open", choices: ["run"] },
      theirs: { id: "theirs", kind: "confirm", playerId: "p2", title: "Ready?", status: "open" },
      done: { id: "done", kind: "confirm", playerId: "p1", title: "Done", status: "resolved" },
    },
  } as unknown as import("digipology-kernel").CanonicalGameState;
  expect(openPromptsForPlayer(state, "p1").map((prompt) => prompt.id)).toEqual(["mine"]);
});

test("connection overlays distinguish passthrough recovery, errors, synchronization, and ended rooms", () => {
  const render = (status: import("../net/roomClient").RoomClientStatus) => renderToStaticMarkup(
    <MemoryRouter><ConnectionOverlay status={status} onReload={() => {}} /></MemoryRouter>,
  );
  const reconnecting = render({ state: "reconnecting", message: "Reconnecting" });
  expect(reconnecting).toContain("connection-overlay--passthrough");
  expect(reconnecting).not.toContain("Reload table");

  const synchronizing = render({ state: "synchronizing", message: "Synchronizing Table", progress: { applied: 12, total: 60 } });
  expect(synchronizing).toContain("Synchronizing Table");
  expect(synchronizing).toContain("12 / 60 actions applied");
  expect(synchronizing).not.toContain("Reload table");

  const error = render({ state: "error", message: "The table connection could not be restored.", recoverable: true });
  expect(error).toContain("Reload table");
  expect(error).toContain("Leave table");
  expect(error).not.toContain("connection-overlay--passthrough");

  const ended = render({ state: "ended", message: "This table has ended." });
  expect(ended).toContain("This table has ended.");
  expect(ended).toContain("Leave table");
  expect(ended).not.toContain("Reload table");
});

test("first-use hints render for a new device and disappear after all gestures are remembered", () => {
  expect(readCompletedTableHints(null)).toEqual(new Set());
  const firstVisit = renderToStaticMarkup(<TableHints event={null} />);
  expect(firstVisit).toContain("table-hints");
  expect(firstVisit).toContain("LMB drag · Q/E or wheel rotate · F flip");
  const dismissed = renderToStaticMarkup(<TableHints event={null} initialCompleted={["drag", "primary", "actions"]} />);
  expect(dismissed).toBe("");
});

test("inspect renders a definition face without exposing a hidden card", () => {
  const face = renderToStaticMarkup(<InspectOverlay item={{ entityId: "card-secret", label: "Ace of Moons", color: "#abcdef", kind: "card", hidden: false }} onDismiss={() => {}} />);
  expect(face).toContain("Ace of Moons");
  expect(face).toContain("--inspect-color:#abcdef");
  const hidden = renderToStaticMarkup(<InspectOverlay item={{ entityId: "card-secret", label: "Face-down card", color: "#abcdef", kind: "card", hidden: true }} onDismiss={() => {}} />);
  expect(hidden).toContain("Face-down card back");
  expect(hidden).toContain("DIGIPOLOGY");
  expect(hidden).not.toContain("Ace of Moons");
  expect(hidden).not.toContain("#abcdef");
});

test("dice controls use player-language definition labels and disambiguate duplicates", () => {
  const dice = [
    { id: "die_raw_a", components: { die: { definitionId: "red", value: 1 } } },
    { id: "die_raw_b", components: { die: { definitionId: "red", value: 2 } } },
  ] as import("digipology-kernel").EntityRecord[];
  const html = renderToStaticMarkup(<DiceControls dice={dice} definitions={{ red: { label: "Red die" } }} disabled={false} onRoll={() => {}} />);
  expect(html).toContain("Roll Red die 1");
  expect(html).toContain("Roll Red die 2");
  expect(html).not.toContain("die_raw");
});

test("passthrough overlays and motion affordances have safe CSS", async () => {
  const css = await Bun.file(new URL("../styles.css", import.meta.url)).text();
  expect(css).toMatch(/\.connection-overlay--passthrough\s*\{[^}]*pointer-events:\s*none/s);
  expect(css).toMatch(/\.connection-overlay--passthrough \.reconnect-card\s*\{[^}]*pointer-events:\s*auto/s);
  expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  expect(css).not.toContain(".hand-inspect");
  // Drag-to-table needs the vertical axis, but the tray must still scroll
  // horizontally on touch, so the cards may never claim both axes.
  expect(css).toMatch(/\.hand-strip__cards button\s*\{[^}]*touch-action:\s*pan-x/s);
});

test("renderer diagnostics expose the mounted adapter, fallback, and tier", () => {
  const html = renderToStaticMarkup(<dl><RendererDiagnostics status={{
    requested: "lite",
    mounted: "webgl",
    reason: "webgpu",
    fallback: { from: "lite", to: "webgl", error: "adapter unavailable" },
    tier: "low",
  }} /></dl>);
  expect(html).toContain("Renderer");
  expect(html).toContain("webgl");
  expect(html).toContain("Selected because");
  expect(html).toContain("Fallback");
  expect(html).toContain("Lite failed to start: adapter unavailable");
  expect(html).toContain("Tier");
  expect(html).toContain("low");
});

test("room chat renders untrusted messages as text and exposes its unread badge", () => {
  const collapsed = renderToStaticMarkup(<TableChat
    model={{ open: false, unread: 3, nextId: 1, lines: [] }}
    disabled={false}
    onOpen={() => {}}
    onClose={() => {}}
    onSend={() => true}
  />);
  expect(collapsed).toContain("3 unread");
  const open = renderToStaticMarkup(<TableChat
    model={{
      open: true,
      unread: 0,
      nextId: 2,
      lines: [{
        id: 1,
        message: { type: "chat_message", protocolVersion: 1, kind: "player", playerId: "p2", displayName: "Bob", text: "<img src=x onerror=alert(1)>" },
      }],
    }}
    disabled={false}
    onOpen={() => {}}
    onClose={() => {}}
    onSend={() => true}
  />);
  expect(open).toContain("&lt;img src=x onerror=alert(1)&gt;");
  expect(open).not.toContain("<img src=x");
  expect(renderToStaticMarkup(<ControlsHelp />)).toContain("Show table controls");
});
