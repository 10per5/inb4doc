/**
 * ProseMirror node type names mapped to int enums.
 * Used in block-edit.ts for parentType comparisons.
 */
export enum ProseNodeType {
  Paragraph,
  Heading,
  List,
  Blockquote,
  Table,
}

export const proseNodeTypeByName = new Map<string, ProseNodeType>([
  ["paragraph", ProseNodeType.Paragraph],
  ["heading", ProseNodeType.Heading],
  ["list", ProseNodeType.List],
  ["blockquote", ProseNodeType.Blockquote],
  ["table", ProseNodeType.Table],
]);
