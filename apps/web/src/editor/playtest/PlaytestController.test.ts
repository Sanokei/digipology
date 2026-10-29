import { expect, test } from "bun:test";
import { createDiceGameEditorDraft } from "../state/bundle";
import { PlaytestController } from "./PlaytestController";

test("stopping during asynchronous setup prevents a late runtime from reopening the playtest", async () => {
  const controller = new PlaytestController();
  const draft = createDiceGameEditorDraft("stopped-start", "2026-01-01T00:00:00Z");
  const pending = controller.start(draft, { playerCount: 2 });
  controller.stop();
  await pending;
  expect(controller.getSnapshot().status).toBe("stopped");
  expect(controller.projection.getSnapshot().players).toEqual([]);
  await controller.start(draft, { playerCount: 2 });
  expect(controller.getSnapshot().status).toBe("playing");
  expect(controller.projection.getSnapshot().players).toHaveLength(2);
  controller.sendAction({ type: "die.roll", payload: { entityId: "die" } });
  controller.stop();
  await controller.start(draft, { playerCount: 2 });
  expect(controller.projection.getSnapshot().state?.entities.score?.components.counter?.value).toBe(0);
  controller.dispose();
});
