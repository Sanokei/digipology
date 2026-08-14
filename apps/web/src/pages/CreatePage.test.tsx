import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ValidationReport } from "./CreatePage";

test("create form renders client and server validation reports as escaped readable text", () => {
  const html = renderToStaticMarkup(<ValidationReport report={[
    { check: "manifest_hash", ok: false, detail: "expected <script>" },
    { check: "kernel_load", ok: true },
  ]} />);
  expect(html).toContain("manifest hash");
  expect(html).toContain("expected &lt;script&gt;");
  expect(html).toContain("kernel load");
  expect(html).not.toContain("<script>");
});

