export interface PathCommand { command: "M" | "L" | "Q" | "C" | "A" | "Z"; values: number[] }

const ARITY: Readonly<Record<PathCommand["command"], number>> = { M: 2, L: 2, Q: 4, C: 6, A: 7, Z: 0 };
const TOKEN = /([MLQCAZ])|(-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/gy;

export function parseFacePath(value: string): PathCommand[] | null {
  const commands: PathCommand[] = [];
  let index = 0;
  let current: PathCommand["command"] | null = null;
  while (index < value.length) {
    while (index < value.length && /[\s,]/.test(value[index]!)) index += 1;
    if (index === value.length) break;
    TOKEN.lastIndex = index;
    const token = TOKEN.exec(value);
    if (token === null || token.index !== index) return null;
    index = TOKEN.lastIndex;
    if (token[1] !== undefined) {
      current = token[1] as PathCommand["command"];
      if (current === "Z") { commands.push({ command: "Z", values: [] }); current = null; }
      continue;
    }
    if (current === null) return null;
    const arity = ARITY[current];
    const values = [Number(token[2])];
    while (values.length < arity) {
      while (index < value.length && /[\s,]/.test(value[index]!)) index += 1;
      TOKEN.lastIndex = index;
      const next = TOKEN.exec(value);
      if (next === null || next.index !== index || next[1] !== undefined) return null;
      values.push(Number(next[2]));
      index = TOKEN.lastIndex;
    }
    if (values.some((number) => !Number.isFinite(number))) return null;
    commands.push({ command: current, values });
    if (current === "M") current = "L";
  }
  return commands.length > 0 && commands[0]?.command === "M" ? commands : null;
}
