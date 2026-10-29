import { expect, test } from "bun:test";
import { nextTask } from "./product-loop";

const task = { id: "real-playthrough", title: "Full game", done: false, outcome: "Reach a winner", acceptance: ["Two real clients agree"] };
test("the loop selects unfinished work in priority order and stops when its queue is complete", () => {
  expect(nextTask([{ ...task, id: "finished", done: true }, task])?.id).toBe(task.id);
  expect(nextTask([{ ...task, done: true }])).toBeNull();
  expect(nextTask([])).toBeNull();
});
test("ambiguous or malformed backlog entries cannot enter unattended execution", () => {
  expect(() => nextTask([task, task])).toThrow("Invalid");
  expect(() => nextTask([{ ...task, acceptance: [] }])).toThrow("Invalid");
  expect(() => nextTask([{ ...task, id: "x\nother=value" }])).toThrow("Invalid");
});
