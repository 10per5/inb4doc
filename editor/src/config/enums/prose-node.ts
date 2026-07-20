/**
 * ProseMirror node type names mapped to int enums.
 * Used in block-edit.ts for parentType comparisons.
 */
export enum ProseNodeType {
  Paragraph,
  Heading,
  BulletList,
  OrderedList,
  Blockquote,
  Table,
}

export const proseNodeTypeByName = new Map<string, ProseNodeType>([
  ["paragraph", ProseNodeType.Paragraph],
  ["heading", ProseNodeType.Heading],
  ["bullet_list", ProseNodeType.BulletList],
  ["ordered_list", ProseNodeType.OrderedList],
  ["blockquote", ProseNodeType.Blockquote],
  ["table", ProseNodeType.Table],
]);
