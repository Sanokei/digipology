import { expect, test } from "bun:test";
import { devProxyOrigin } from "./devProxyOrigin";

test("Vite forwards a same-origin browser request with the Worker's origin", () => {
  expect(devProxyOrigin("http://localhost:5173", "localhost:5173", "http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
  expect(devProxyOrigin("http://[::1]:5173", "[::1]:5173", "http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
});
test("cross-origin, missing and malformed Origins cannot gain same-origin status", () => {
  for (const origin of ["https://other.example", "null", "http://localhost:9999", "http://localhost:5173/path", undefined]) {
    expect(devProxyOrigin(origin, "localhost:5173", "http://127.0.0.1:8787")).toBe(origin);
  }
});
