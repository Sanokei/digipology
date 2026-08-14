import { expect, test } from "bun:test";
import { findForbiddenApis } from "./check-forbidden";

test("kernel source contains no forbidden APIs", async () => {
  const violations = await findForbiddenApis(`${import.meta.dir}/../src`);
  if (violations.length > 0) {
    throw new Error(`Forbidden kernel APIs found:\n${violations.join("\n")}`);
  }
  expect(violations).toEqual([]);
});
