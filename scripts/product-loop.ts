import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface ProductTask { id: string; title: string; done: boolean; outcome: string; acceptance: string[]; }
const backlogPath = ".github/product-loop/backlog.json";
const statePath = ".product-loop";

export function nextTask(value: unknown): ProductTask | null {
  if (!Array.isArray(value)) throw new Error("The product backlog must be an array");
  const ids = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id) || ids.has(item.id) ||
        typeof item.title !== "string" || typeof item.outcome !== "string" || typeof item.done !== "boolean" ||
        !Array.isArray(item.acceptance) || item.acceptance.length === 0 || !item.acceptance.every((entry: unknown) => typeof entry === "string" && entry.trim() !== "")) {
      throw new Error("Invalid or duplicate product task");
    }
    ids.add(item.id);
  }
  return value.find((item: ProductTask) => !item.done) ?? null;
}

async function prepare() {
  const task = nextTask(JSON.parse(await readFile(backlogPath, "utf8")));
  await mkdir(statePath, { recursive: true });
  await writeFile(`${statePath}/task.json`, JSON.stringify(task, null, 2));
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `has_task=${task !== null}\ntask_id=${task?.id ?? ""}\n`);
  if (!task) { console.log("All queued milestones have been completed. Add the next product task before resuming."); return; }
  const instructions = await readFile(".github/product-loop/instructions.md", "utf8");
  await writeFile(`${statePath}/prompt.md`, `${instructions}\n\nSelected task: ${task.title}\n\n${task.outcome}\n\nAcceptance criteria:\n${task.acceptance.map((line) => `- ${line}`).join("\n")}\n`);
  console.log(`Prepared ${task.id}: ${task.title}`);
}

async function finish() {
  const task = JSON.parse(await readFile(`${statePath}/task.json`, "utf8")) as ProductTask;
  const result = JSON.parse(await readFile(`${statePath}/result.json`, "utf8"));
  if (typeof result.title !== "string" || !/^(feat|fix|refactor|perf|test|docs|chore)(\([\w-]+\))?: .+/.test(result.title) ||
      typeof result.summary !== "string" || typeof result.completed !== "boolean" || !Array.isArray(result.validation) || !Array.isArray(result.limitations)) throw new Error("Invalid iteration result");
  const backlog = JSON.parse(await readFile(backlogPath, "utf8")) as ProductTask[];
  if (nextTask(backlog)?.id !== task.id) throw new Error("Backlog changed during the iteration");
  if (result.completed) {
    backlog.find((item) => item.id === task.id)!.done = true;
    await writeFile(backlogPath, JSON.stringify(backlog, null, 2) + "\n");
  }
  const lines = [result.summary, "", "Validation:", ...result.validation.map((line: string) => `- ${line}`), "", "Limitations:", ...result.limitations.map((line: string) => `- ${line}`), "", `Product milestone: ${task.title} (${result.completed ? "completed" : "continuing"}).`];
  await writeFile(`${statePath}/pr-body.md`, lines.join("\n") + "\n");
  await writeFile(`${statePath}/commit-title.txt`, result.title.trim() + "\n");
}

if (import.meta.main) {
  if (process.argv[2] === "prepare") await prepare();
  else if (process.argv[2] === "finish") await finish();
  else throw new Error(`Usage: bun ${resolve("scripts/product-loop.ts")} prepare|finish`);
}
