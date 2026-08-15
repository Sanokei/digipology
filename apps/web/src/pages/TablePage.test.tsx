import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import { HandStrip } from "../components/HandStrip";
import { TableTopBar } from "../components/TableTopBar";
import { playersPanelOpenByDefault } from "./TablePage";
import { openPromptsForPlayer } from "./TablePage";

test("375px table chrome exposes compact controls and the thumb hand tray", async () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <TableTopBar gameTitle="Pocket Table" playerCount={2} joinCode="ABCD-EFGH" inviteUrl="https://example.test/join" onPlayers={() => {}} onDiagnostics={() => {}} />
      <HandStrip items={[{ entityId: "card-1", label: "Ace" }]} />
    </MemoryRouter>,
  );
  expect(html).toContain("table-topbar__players-count");
  expect(html).toContain("Show 2 players");
  expect(html).toContain("hand-strip__cards");
  expect(html).toContain("Inspect Ace");
  expect(playersPanelOpenByDefault(false)).toBe(false);
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
