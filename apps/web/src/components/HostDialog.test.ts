import { expect, test } from "bun:test";
import { publicHostingAllowed } from "./HostDialog";

test("anonymous public hosting is gated while private hosting is available", () => {
  expect(publicHostingAllowed(false, "public")).toBe(false);
  expect(publicHostingAllowed(false, "private")).toBe(true);
  expect(publicHostingAllowed(true, "public")).toBe(true);
});
