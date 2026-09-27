import { expect, test } from "bun:test";
import { FACE_ICONS, faceSpecHash, parseFacePath, renderFaceSvg, validateFaceSpec, type FaceSpec } from "./index";

const VALID: FaceSpec = {
  background: { type: "linear-gradient", x1: 0, y1: 0, x2: 1000, y2: 1000, stops: [
    { offset: 0, color: "#ffffff" }, { offset: 1, color: "#123456" },
  ] },
  elements: [
    { type: "rect", x: 20, y: 20, w: 960, h: 960, r: 30, fill: "#abcdef", stroke: "#112233", strokeWidth: 4 },
    { type: "path", d: "M100 100 L900 100 Q950 500 900 900 C700 950 300 950 100 900 A80 80 0 0 1 100 100 Z", fill: "#654321" },
    { type: "text", x: 500, y: 530, text: "Safe & <plain> text", font: "sans", size: 80, weight: 700, align: "center" },
    { type: "group", translate: { x: 20, y: 30 }, rotate: 5, scale: { x: 0.8, y: 0.8 }, elements: [
      { type: "icon", name: "shield", x: 500, y: 500, size: 220, fill: "#ff0000" },
    ] },
  ],
};

test("validates every element family and all built-in icons", () => {
  const spec = structuredClone(VALID);
  spec.elements.push(
    { type: "circle", cx: 100, cy: 100, r: 20 },
    { type: "ellipse", cx: 200, cy: 100, rx: 30, ry: 20 },
    { type: "polygon", points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 20 }] },
    { type: "line", x1: 0, y1: 0, x2: 100, y2: 100, stroke: "#000000" },
    ...FACE_ICONS.map((name, index) => ({ type: "icon" as const, name, x: index, y: index, size: 10 })),
  );
  expect(validateFaceSpec(spec).ok).toBeTrue();
  expect(parseFacePath((VALID.elements[1] as { d: string }).d)).not.toBeNull();
});

test("rejects unknown keys, non-finite values, raw markup fields, bad paths, and limits", () => {
  const hostile = [
    { ...VALID, script: "alert(1)" },
    { background: "#ffffff", elements: [{ type: "rect", x: 0, y: 0, w: Number.NaN, h: 2 }] },
    { background: "url(https://evil.test)", elements: [] },
    { background: "#ffffff", elements: [{ type: "path", d: "M0 0 javascript:alert(1)" }] },
    { background: "#ffffff", elements: [{ type: "text", x: 0, y: 0, text: "bad\u0000text", font: "sans", size: 12 }] },
    { background: "#ffffff", elements: [{ type: "circle", cx: 0, cy: 0, r: 1 }, { type: "circle", cx: 0, cy: 0, r: 1 }] },
  ];
  for (const [index, value] of hostile.entries()) {
    const result = validateFaceSpec(value, index === hostile.length - 1 ? { maxElements: 1 } : {});
    expect(result.ok).toBeFalse();
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
  }
});

test("SVG serializer escapes text and emits no active or external content", () => {
  const svg = renderFaceSvg(VALID, 860, 1220);
  expect(svg).toContain("Safe &amp; &lt;plain&gt; text");
  expect(svg).toContain('viewBox="0 0 1000 1000"');
  expect(svg).not.toMatch(/<script|<foreignObject|\shref=|url\(https?:|onload=/i);
});

test("canonical face hashes ignore object insertion order but change with content", () => {
  const reordered = { elements: VALID.elements, background: VALID.background } as FaceSpec;
  expect(faceSpecHash(reordered)).toBe(faceSpecHash(VALID));
  expect(faceSpecHash({ ...VALID, elements: [...VALID.elements, { type: "circle", cx: 1, cy: 1, r: 1 }] })).not.toBe(faceSpecHash(VALID));
});
