import { expect, test } from "bun:test";
import { loginAfterSubmit } from "./loginModel";

test("successful login request transitions to check-email", () => {
  expect(loginAfterSubmit(true)).toBe("sent");
  expect(loginAfterSubmit(false)).toBe("entry");
});
