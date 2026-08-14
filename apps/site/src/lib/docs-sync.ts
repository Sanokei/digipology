import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface RepositoryDocFrontmatter {
  title: string;
  description: string;
}

export interface TransformedRepositoryDoc {
  data: RepositoryDocFrontmatter;
  body: string;
  output: string;
}

// This is intentionally explicit: everything else under /docs is publishable.
// Directory entries exclude their complete subtree.
export const repositoryDocExclusions = [
  "adr/",
  "runbooks/",
  "spec/",
  "releasing.md",
] as const;

const repositoryUrl = "https://github.com/Sanokei/digipology/blob/main/docs";

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function isPublishableRepositoryDoc(path: string): boolean {
  const normalized = normalizePath(path);
  if (!normalized.endsWith(".md")) return false;

  return !repositoryDocExclusions.some((exclusion) =>
    exclusion.endsWith("/")
      ? normalized.startsWith(exclusion)
      : normalized === exclusion,
  );
}

function parseScalar(value: string, field: string, sourcePath: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === "string") return parsed;
    } catch {}
  } else if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  } else if (trimmed && !/^[!&*>{[|]/.test(trimmed)) {
    return trimmed;
  }

  throw new Error(
    `Invalid docs frontmatter in ${sourcePath}: ${field} must be a non-empty string.`,
  );
}

export function parseRepositoryDoc(
  source: string,
  sourcePath: string,
): { data: RepositoryDocFrontmatter; body: string } {
  const normalized = source.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) {
    throw new Error(
      `Missing docs frontmatter in ${sourcePath}: title and description are required.`,
    );
  }

  const values = new Map<string, string>();
  const frontmatterBlock = match[1];
  if (frontmatterBlock === undefined) {
    throw new Error(`Invalid docs frontmatter in ${sourcePath}.`);
  }

  for (const line of frontmatterBlock.split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const field = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!field) {
      throw new Error(`Invalid docs frontmatter in ${sourcePath}: ${line}`);
    }
    const [, key, value] = field;
    if (key === undefined || value === undefined) {
      throw new Error(`Invalid docs frontmatter in ${sourcePath}: ${line}`);
    }
    if (values.has(key)) {
      throw new Error(
        `Invalid docs frontmatter in ${sourcePath}: duplicate ${key} field.`,
      );
    }
    values.set(key, parseScalar(value, key, sourcePath));
  }

  const title = values.get("title");
  const description = values.get("description");
  if (!title || !description) {
    throw new Error(
      `Invalid docs frontmatter in ${sourcePath}: title and description must be non-empty strings.`,
    );
  }

  return {
    data: { title, description },
    body: normalized.slice(match[0].length),
  };
}

function rewriteRelativeLinks(
  body: string,
  sourcePath: string,
  publishedPaths: ReadonlySet<string>,
): string {
  return body.replace(
    /(\]\()(<)?([^\s)>]+)(>)?(\s+(?:"[^"]*"|'[^']*'))?(\))/g,
    (match, open, angleOpen, target, angleClose, label, close) => {
      if (!target.startsWith("./") && !target.startsWith("../")) return match;

      const targetUrl = new URL(target, `https://docs.invalid/${sourcePath}`);
      const repositoryPath = decodeURIComponent(targetUrl.pathname.slice(1));
      let rewritten: string;

      if (repositoryPath.endsWith(".md") && publishedPaths.has(repositoryPath)) {
        rewritten = `/docs/${repositoryPath.slice(0, -3)}/${targetUrl.hash}`;
      } else {
        rewritten = `${repositoryUrl}/${repositoryPath}${targetUrl.hash}`;
      }

      return `${open}${angleOpen ?? ""}${rewritten}${angleClose ?? ""}${label ?? ""}${close}`;
    },
  );
}

export function transformRepositoryDoc(
  source: string,
  sourcePath: string,
  publishedPaths: ReadonlySet<string>,
): TransformedRepositoryDoc {
  const { data, body } = parseRepositoryDoc(source, sourcePath);
  const withoutHeading = body.replace(/^\s*#\s+[^\n]+\n+/, "");
  const transformedBody = rewriteRelativeLinks(
    withoutHeading,
    sourcePath,
    publishedPaths,
  ).trimStart();
  const output = [
    "---",
    `title: ${JSON.stringify(data.title)}`,
    `description: ${JSON.stringify(data.description)}`,
    "---",
    "",
    transformedBody,
  ].join("\n");

  return { data, body: transformedBody, output };
}

function collectMarkdownFiles(directory: string, root = directory): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return collectMarkdownFiles(path, root);
    if (!entry.isFile()) return [];
    return [normalizePath(relative(root, path))];
  });
}

function assertGeneratedDirectoryIsSafe(siteRoot: string, outputDirectory: string): void {
  const expected = resolve(siteRoot, "src/content/docs/repository");
  if (resolve(outputDirectory) !== expected) {
    throw new Error(`Refusing to replace unexpected docs directory: ${outputDirectory}`);
  }
  const fromSite = relative(siteRoot, outputDirectory);
  if (fromSite.startsWith(`..${sep}`) || fromSite === "..") {
    throw new Error(`Generated docs directory escaped the site: ${outputDirectory}`);
  }
}

export function syncRepositoryDocs(options?: {
  repositoryDocs?: string;
  siteRoot?: string;
}): string[] {
  const moduleSiteRoot = fileURLToPath(new URL("../..", import.meta.url));
  const siteRoot = resolve(options?.siteRoot ?? moduleSiteRoot);
  const repositoryDocs = resolve(
    options?.repositoryDocs ?? resolve(siteRoot, "../../docs"),
  );
  const outputDirectory = resolve(siteRoot, "src/content/docs/repository");
  assertGeneratedDirectoryIsSafe(siteRoot, outputDirectory);

  const published = collectMarkdownFiles(repositoryDocs)
    .filter(isPublishableRepositoryDoc)
    .sort((left, right) => left.localeCompare(right, "en"));
  const publishedPaths = new Set(published);

  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true });

  for (const sourcePath of published) {
    const inputFile = resolve(repositoryDocs, sourcePath);
    const outputFile = resolve(outputDirectory, sourcePath);
    const transformed = transformRepositoryDoc(
      readFileSync(inputFile, "utf8"),
      sourcePath,
      publishedPaths,
    );
    mkdirSync(dirname(outputFile), { recursive: true });
    writeFileSync(outputFile, transformed.output, "utf8");
  }

  return published;
}
