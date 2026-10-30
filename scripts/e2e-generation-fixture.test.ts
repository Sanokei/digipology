import { expect, test } from "bun:test";
import { inspectRasterImage } from "digipology-protocol";
import { landscapeRasterFixture } from "./e2e-generation-fixture";

test("the landscape transport fixture is an actual completely encoded and independently decodable1536x1024 image", async () => {
  const bytes = await landscapeRasterFixture();
  expect(inspectRasterImage(bytes)).toEqual({ contentType: "image/webp", width: 1536, height: 1024 });
  const decoder = Bun.spawn(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", "pipe:0"], { stdin: bytes, stdout: "pipe", stderr: "pipe" });
  const [code, output] = await Promise.all([decoder.exited, new Response(decoder.stdout).json()]);
  expect(code).toBe(0); expect((output as { streams: unknown }).streams).toEqual([{ width: 1536, height: 1024 }]);
});
