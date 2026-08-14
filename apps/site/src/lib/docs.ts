export interface DocSummary {
  id: string;
  data: {
    title: string;
    description: string;
  };
}

export interface DocNavigation<T extends DocSummary> {
  docs: T[];
  previous: T | undefined;
  next: T | undefined;
}

export const featuredDocOrder = [
  "getting-started",
  "architecture",
  "lua-api",
  "actions",
] as const;

const orderById = new Map<string, number>(
  featuredDocOrder.map((id, index) => [id, index]),
);

export function orderDocs<T extends DocSummary>(docs: readonly T[]): T[] {
  return [...docs].sort((left, right) => {
    const leftOrder = orderById.get(docId(left.id)) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = orderById.get(docId(right.id)) ?? Number.MAX_SAFE_INTEGER;

    return (
      leftOrder - rightOrder ||
      left.data.title.localeCompare(right.data.title, "en") ||
      left.id.localeCompare(right.id, "en")
    );
  });
}

export function getDocNavigation<T extends DocSummary>(
  docs: readonly T[],
  activeId: string,
): DocNavigation<T> {
  const orderedDocs = orderDocs(docs);
  const activeIndex = orderedDocs.findIndex((doc) => doc.id === activeId);

  if (activeIndex === -1) {
    throw new Error(`Unknown documentation entry: ${activeId}`);
  }

  return {
    docs: orderedDocs,
    previous: orderedDocs[activeIndex - 1],
    next: orderedDocs[activeIndex + 1],
  };
}

export function docPath(id: string): string {
  return `/docs/${docId(id)}/`;
}

export function docId(collectionId: string): string {
  return collectionId.replace(/^repository\//, "");
}
