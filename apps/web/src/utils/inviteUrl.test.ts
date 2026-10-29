import { expect, test } from "bun:test";
import { inviteUrlForCode } from "./inviteUrl";

test("copied invites remain on production, local and custom preview hosts", () => {
  expect(inviteUrlForCode("abcd 2345", "https://play.digipology.com")).toBe("https://play.digipology.com/join/ABCD-2345");
  expect(inviteUrlForCode("ABCD-2345", "http://localhost:5173/table/old")).toBe("http://localhost:5173/join/ABCD-2345");
  expect(inviteUrlForCode("ABCD2345", "https://preview.example.test")).toBe("https://preview.example.test/join/ABCD-2345");
});
test("malformed invite codes and non-web origins do not become copyable links", () => {
  expect(() => inviteUrlForCode("short", "https://example.test")).toThrow("invite code");
  expect(() => inviteUrlForCode("ABCD2345", "javascript:alert(1)")).toThrow("HTTP");
});
