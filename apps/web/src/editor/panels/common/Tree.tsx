import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

import { CommitTextInput } from "./PanelComponents";

export interface EditorTreeNode {
  id: string;
  label: string;
  children?: readonly EditorTreeNode[];
  suffix?: ReactNode;
}

export function flattenTree(nodes: readonly EditorTreeNode[]): string[] {
  const result: string[] = [];
  const visit = (items: readonly EditorTreeNode[]) => {
    for (const item of items) { result.push(item.id); if (item.children !== undefined) visit(item.children); }
  };
  visit(nodes);
  return result;
}

export function Tree({
  nodes,
  selectedId,
  renamingId,
  onSelect,
  onRenameRequest,
  onRename,
  onRenameEnd,
  onContextMenu,
  onKeyDown,
}: {
  nodes: readonly EditorTreeNode[];
  selectedId: string | null;
  renamingId?: string | null;
  onSelect: (id: string) => void;
  onRenameRequest?: (id: string) => void;
  onRename?: (id: string, value: string) => void;
  onRenameEnd?: (id: string) => void;
  onContextMenu?: (id: string, event: MouseEvent<HTMLDivElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const renderNodes = (items: readonly EditorTreeNode[], depth: number): ReactNode => items.map((node) => <div key={node.id} role="none">
    <div role="treeitem" aria-selected={selectedId === node.id} aria-level={depth + 1}
      className={`editor-tree-row${selectedId === node.id ? " is-selected" : ""}`}
      style={{ paddingLeft: 7 + depth * 12 }} onClick={() => onSelect(node.id)}
      onDoubleClick={() => onRenameRequest?.(node.id)} onContextMenu={(event) => onContextMenu?.(node.id, event)}>
      <span className="editor-tree-dot" />
      {renamingId === node.id && onRename !== undefined
        ? <CommitTextInput value={node.label} onCommit={(value) => onRename(node.id, value)}
          onComplete={() => onRenameEnd?.(node.id)} onCancel={() => onRenameEnd?.(node.id)} />
        : <span>{node.label}</span>}
      {node.suffix}
    </div>
    {node.children === undefined ? null : <div role="group">{renderNodes(node.children, depth + 1)}</div>}
  </div>);
  return <div className="editor-tree" role="tree" tabIndex={0} onKeyDown={onKeyDown}>{renderNodes(nodes, 0)}</div>;
}
