import { union } from "@prosekit/core";
import type { Node as ProseNode, Schema } from "prosemirror-model";
import { createSchemaExtension } from "@/config/editor-schema";
import { createMarkdownBridge } from "@/config/editor-markdown";
import { createMathExtension } from "@/plugins/math";

/**
 * Shared markdown test harness.
 *
 * The editor's schema is built from ProseKit extensions; `createSchemaExtension`
 * returns an `Extension` whose `.schema` getter exposes the composed
 * ProseMirror schema (the same one the live editor uses). We build one schema
 * for the whole test process and reuse a parser/serializer bridge.
 *
 * NOTE: tests require `bun test` (Bun's runtime). Under Bun, `prosemirror-model`
 * must resolve to its ESM build so that `orderedmap` is a single module
 * instance — see `tsconfig.json`.
 */
export const schema: Schema = (() => {
  // The live editor unions its schema extension with createMathExtension(),
  // which contributes the `mathInline`/`mathBlock` nodes the markdown parser
  // and serializer reference. Include both so tests cover real documents.
  const extension = union(createSchemaExtension(), createMathExtension());
  if (!extension.schema) {
    throw new Error("editor extension did not produce a schema");
  }
  return extension.schema as Schema;
})();

const bridge = createMarkdownBridge(schema);

/** Parse markdown into a ProseMirror document (including fixups). */
export function parse(md: string): ProseNode {
  return bridge.parse(md);
}

/** Serialize a document back to markdown (no trailing-newline cleanup). */
export function serialize(doc: ProseNode): string {
  return bridge.serialize(doc);
}

/**
 * Mirror of `getMarkdown()`'s normalization: CRLF → LF and collapse any run of
 * trailing newlines down to a single one. This is what a save writes.
 */
export function normalizeMarkdown(md: string): string {
  return md.replace(/\r\n/g, "\n").replace(/\n+$/, "\n");
}

/** Parse → serialize, i.e. a single load/save normalization pass. */
export function roundtrip(md: string): string {
  return serialize(parse(md));
}

/** Build a paragraph node (empty when `text` is empty). */
export function paragraph(text = ""): ProseNode {
  return schema.node(
    "paragraph",
    null,
    text ? [schema.text(text)] : [],
  );
}

/** Build a doc from the given block nodes. */
export function doc(...blocks: ProseNode[]): ProseNode {
  return schema.node("doc", null, blocks);
}
