/**
 * Slash menu command identifiers used in block-edit.ts.
 * Maps to Milkdown editor commands for block-level operations.
 */
export const SLASH_CMD_PREFIX = "sc-";

export enum SlashCommand {
  Heading,
  BulletList,
  OrderedList,
  TodoList,
  Blockquote,
  ThematicBreak,
  CodeBlock,
  MathBlock,
  Table,
  Image,
  Video,
}
