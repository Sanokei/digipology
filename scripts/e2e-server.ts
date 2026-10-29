import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { randomBytes } from "node:crypto";
import { startQualityServer } from "./quality-server";
import { startGenerationFixture } from "./e2e-generation-fixture";

const root = resolve(import.meta.dir, "..");
const temporary = await mkdtemp(join(tmpdir(), "digipology-e2e-"));
const configPath = join(temporary, "wrangler.json");
const quality = startQualityServer({ port: 8796 });
const unconfigured = process.env.E2E_AI_UNCONFIGURED === "1";
const modelFixture = unconfigured ? null : startGenerationFixture();
console.log(unconfigured
  ? "E2E leaves generation unconfigured; no model fixture or external provider is contacted."
  : "E2E uses a deterministic model fixture and real Lua quality/repair service; no external model is contacted.");
const config = {
  name: "digipology-e2e", main: join(root, "apps/worker/src/index.ts"),
  compatibility_date: "2026-08-13", compatibility_flags: ["nodejs_compat"],
  vars: { PUBLIC_ORIGIN: "http://127.0.0.1:8797", AI_BASE_URL: unconfigured ? "" : "http://127.0.0.1:8795/v1", AI_MODEL: unconfigured ? "" : "deterministic-test-fixture", AI_IMAGE_BASE_URL: unconfigured ? "" : "http://127.0.0.1:8795/v1", AI_IMAGE_MODEL: unconfigured ? "" : "deterministic-raster-fixture", AI_QUALITY_BASE_URL: "http://127.0.0.1:8796", EMAIL_FROM: "local@example.invalid" },
  d1_databases: [{ binding: "DB", database_name: "digipology", database_id: "00000000-0000-0000-0000-000000000001", migrations_dir: join(root, "apps/worker/migrations") }],
  r2_buckets: [{ binding: "RELEASES", bucket_name: "digipology-e2e" }],
  durable_objects: { bindings: [{ name: "ROOM", class_name: "RoomDO" }] },
  migrations: [{ tag: "v1", new_sqlite_classes: ["RoomDO"] }],
  assets: { directory: join(root, "apps/web/dist"), binding: "ASSETS", not_found_handling: "single-page-application", run_worker_first: ["/api/*"] },
};
await writeFile(configPath, JSON.stringify(config));
await writeFile(join(temporary, ".dev.vars"), `SESSION_SECRET=${randomBytes(32).toString("hex")}\nEMAIL_DEV_MODE=true\n`, { mode: 0o600 });
const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
const run = async (command: string[]) => {
  const code = await Bun.spawn(command, { cwd: root, env, stdout: "inherit", stderr: "inherit" }).exited;
  if (code !== 0) throw new Error(`E2E prerequisite failed (${command[0]}), exit ${code}`);
};
try {
  if (process.env.E2E_SKIP_BUILD !== "1") await run(["bun", "run", "--cwd", "apps/web", "build"]);
  const wrangler = join(root, "node_modules/.bin/wrangler");
  await run([wrangler, "d1", "migrations", "apply", "digipology", "--local", "--config", configPath, "--persist-to", join(temporary, "state")]);
  // Tests use a fixed build. An esbuild source watcher can rebuild mid-scenario
  // or deadlock after unrelated workspace writes; dev hot reload belongs in dev.
  const workerBuild = join(temporary, "worker-build");
  await run([wrangler, "deploy", "--dry-run", "--outdir", workerBuild, "--config", configPath]);
  await writeFile(configPath, JSON.stringify({ ...config, main: join(workerBuild, "index.js") }));
  console.log("E2E Worker compiled locally once; serving without source rebundling.");
  const server = Bun.spawn([wrangler, "dev", "--no-bundle", "--local", "--config", configPath, "--port", "8797", "--ip", "127.0.0.1", "--inspector-port", "9239", "--persist-to", join(temporary, "state")], { cwd: root, env, stdout: "inherit", stderr: "inherit" });
  const stop = () => server.kill("SIGTERM");
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  const exitCode = await server.exited;
  console.log(`Isolated E2E Worker exited: code=${exitCode}, signal=${server.signalCode ?? "none"}`);
  process.exitCode = exitCode;
} finally { await quality.stop(true); await modelFixture?.stop(true); await rm(temporary, { recursive: true, force: true }); }
