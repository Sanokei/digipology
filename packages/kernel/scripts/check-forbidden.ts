const forbidden = [
  ["random API", /Math[.]random/],
  ["wall clock", /\bDate\b/],
  ["timer", /\b(setTimeout|setInterval|queueMicrotask)\b/],
  ["network", /\b(fetch|WebSocket|XMLHttpRequest)\b/],
  ["DOM", /\b(document|window|HTMLElement|localStorage|indexedDB)\b/],
  ["platform API", /\b(Bun|process|Buffer|node:|bun:)/],
  ["noncanonical serializer", /JSON[.]stringify/],
] as const;

export async function findForbiddenApis(directory: string): Promise<string[]> {
  const glob = new Bun.Glob("**/*.ts");
  const violations: string[] = [];
  for await (const path of glob.scan({ cwd: directory, absolute: false })) {
    if (path.endsWith(".test.ts")) continue;
    const source = await Bun.file(`${directory}/${path}`).text();
    for (const [label, pattern] of forbidden) {
      if (pattern.test(source)) violations.push(`${path}: ${label}`);
    }
  }
  return violations;
}

if (import.meta.main) {
  const violations = await findForbiddenApis(`${import.meta.dir}/../src`);
  if (violations.length > 0) {
    throw new Error(`Forbidden kernel APIs found:\n${violations.join("\n")}`);
  }
}
