declare module "bun:test" {
  export function describe(name: string, body: () => void): void;
  export function test(
    name: string,
    body: () => void | Promise<void>,
  ): void;
  export function expect(actual: unknown): {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeUndefined(): void;
    toThrow(expected?: unknown): void;
  };
}

interface ImportMeta {
  readonly url: string;
}

declare class URL {
  constructor(input: string, base?: string | URL);
}

declare const Bun: {
  file(path: string | URL): { text(): Promise<string> };
};
