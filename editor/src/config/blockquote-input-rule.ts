import { union, type Union } from "@prosekit/core"
import { defineWrappingInputRule } from "@prosekit/extensions/input-rule"
import {
  defineBlockquoteCommands,
  defineBlockquoteKeymap,
  defineBlockquoteSpec,
} from "@prosekit/extensions/blockquote"

/**
 * Blockquote input rule — replaces `@prosekit/extensions`' own rule.
 *
 * Upstream ships `/^>\s/`, which is wrong on two counts:
 *
 * 1. No `$`, so the pattern only has to *start* at the caret window — anything
 *    may follow the `> `.
 * 2. `^` does not mean "start of the textblock": prosemirror-inputrules matches
 *    against the last `MAX_MATCH` (500) characters before the caret, so `^` is
 *    the start of that sliding window.
 *
 * Combined, a `>` typed mid-paragraph (e.g. "Preferences > Storage panel")
 * turns the whole paragraph into a blockquote ~500 characters later — the
 * moment the sliding window happens to begin exactly at that `>` — and the `>`
 * itself is then deleted by the rule. Anchoring both ends restores the standard
 * prosemirror semantics: the rule fires only when the characters immediately
 * before the caret are exactly `> `, i.e. at the start of the block.
 */
export const BLOCKQUOTE_INPUT_RULE = /^>\s$/

export function defineBlockquoteInputRule() {
  return defineWrappingInputRule({
    regex: BLOCKQUOTE_INPUT_RULE,
    type: "blockquote",
  })
}

/**
 * Everything `defineBlockquote()` gives — spec, commands, keymap — with the
 * input rule above instead of the unanchored stock one.
 */
export function defineBlockquote() {
  return union(
    defineBlockquoteSpec(),
    defineBlockquoteCommands(),
    defineBlockquoteKeymap(),
    defineBlockquoteInputRule(),
  )
}
