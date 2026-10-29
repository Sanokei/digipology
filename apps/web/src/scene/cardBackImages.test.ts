import { expect, test } from "bun:test";
import { cardBackForGame } from "./cardBack";
import { retryCardBackImage, watchCardBackImage } from "./cardBackImages";

test("shared image loading retries a failed asset and drops late callbacks after its final consumer leaves", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "Image");
  const created: FakeImage[] = [];
  class FakeImage {
    naturalWidth = 1024; naturalHeight = 1536; decoding = ""; src = "";
    onload: (() => void) | null = null; onerror: (() => void) | null = null;
    constructor() { created.push(this); }
  }
  Object.defineProperty(globalThis, "Image", { configurable: true, value: FakeImage });
  const first: string[] = [], second: string[] = [];
  let a: (() => void) | undefined, b: (() => void) | undefined;
  try {
    const back = cardBackForGame("First Deal");
    a = watchCardBackImage(back, (state) => first.push(state.status));
    b = watchCardBackImage(back, (state) => second.push(state.status));
    expect(created).toHaveLength(1); created[0]!.onerror!();
    expect(first.at(-1)).toBe("failed"); expect(second.at(-1)).toBe("failed");
    retryCardBackImage(back); expect(created).toHaveLength(2);
    expect(first.at(-1)).toBe("loading"); created[1]!.onload!();
    expect(first.at(-1)).toBe("ready"); expect(second.at(-1)).toBe("ready");
    const late = created[1]!.onload!; a(); a = undefined; b(); b = undefined;
    const count = first.length + second.length; late();
    expect(first.length + second.length).toBe(count);
    a = watchCardBackImage(back, () => {}); expect(created).toHaveLength(3);
  } finally {
    a?.(); b?.();
    if (original) Object.defineProperty(globalThis, "Image", original); else Reflect.deleteProperty(globalThis, "Image");
  }
});
