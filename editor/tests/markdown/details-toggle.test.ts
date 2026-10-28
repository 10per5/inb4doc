import { EditorState, TextSelection } from "prosemirror-state";
import { wrapIn, lift } from "prosemirror-commands";
import { describe, expect, test } from "bun:test";
import { schema, serialize } from "../helpers/markdown";

/**
 * The details toolbar toggle: wrap the current block, then unwrap it again.
 *
 * `details` is isolating (so the block handle can anchor on a collapsed panel
 * whose children have no box), and the stock `lift` refuses to move content out
 * of an isolating node — this locks in the manual unwrap that replaces it.
 */

const detailsToggle = (state: EditorState, dispatch?: (tr: any) => void) => {
  const details = state.schema.nodes.details;
  const $from = state.selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type !== details) continue;
    if (!dispatch) return true;
    const start = $from.before(d);
    const node = $from.node(d);
    dispatch(state.tr.replaceWith(start, start + node.nodeSize, node.content));
    return true;
  }
  return wrapIn(details)(state, dispatch);
};

const docWith = (node: any) => schema.node("doc", null, [node]);
const para = (text: string) =>
  schema.node("paragraph", null, [schema.text(text)]);

describe("details toggle command", () => {
  test("wraps a paragraph and unwraps it again", () => {
    let state = EditorState.create({ schema, doc: docWith(para("hello")) });
    expect(detailsToggle(state, (tr) => (state = state.apply(tr)))).toBe(true);
    expect(state.doc.firstChild?.type.name).toBe("details");
    expect(detailsToggle(state, (tr) => (state = state.apply(tr)))).toBe(true);
    expect(serialize(state.doc)).toBe("hello");
  });

  test("the stock lift cannot unwrap the isolating node (why we unwrap by hand)", () => {
    const base = EditorState.create({
      schema,
      doc: docWith(schema.node("details", null, [para("hello")])),
    });
    const state = base.apply(
      base.tr.setSelection(TextSelection.near(base.doc.resolve(2))),
    );
    expect(lift(state, undefined)).toBe(false);
  });
});
