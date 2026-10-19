import {
  defineBaseCommands,
  defineBaseKeymap,
  defineHistory,
  union,
} from "@prosekit/core";
import { defineBlockquote } from "./blockquote-input-rule";
import { defineBold } from "@prosekit/extensions/bold";
import { defineCode } from "@prosekit/extensions/code";
import { defineCodeBlock } from "@prosekit/extensions/code-block";
import { defineDoc } from "@prosekit/extensions/doc";
import { defineGapCursor } from "@prosekit/extensions/gap-cursor";
import { defineHardBreak } from "@prosekit/extensions/hard-break";
import { defineHeading } from "@prosekit/extensions/heading";
import { defineHorizontalRule } from "@prosekit/extensions/horizontal-rule";
import { defineImage } from "@prosekit/extensions/image";
import { defineItalic } from "@prosekit/extensions/italic";
import { defineLinkCommands, defineLinkSpec } from "@prosekit/extensions/link";
import { defineList } from "@prosekit/extensions/list";
import { defineModClickPrevention } from "@prosekit/extensions/mod-click-prevention";
import { defineParagraph } from "@prosekit/extensions/paragraph";
import { defineStrike } from "@prosekit/extensions/strike";
import { defineTable } from "@prosekit/extensions/table";
import { defineText } from "@prosekit/extensions/text";
import { defineUnderline } from "@prosekit/extensions/underline";
import { defineVirtualSelection } from "@prosekit/extensions/virtual-selection";

/**
 * Local replacement for @prosekit/basic's defineBasicExtension(): the
 * identical composition, except link contributes spec + commands ONLY.
 * Upstream defineLink() additionally unions fuzzy autolink rules
 * (input/enter/paste) whose regex treats any name.tld as a URL with an
 * OPTIONAL scheme — so typing "AGENTS.md " (`.md` is a real ccTLD)
 * silently created links. Scheme-only autolinking lives in
 * src/plugins/link-autolink.ts instead.
 */
export function defineBasicExtension() {
  return union(
    defineDoc(),
    defineText(),
    defineParagraph(),
    defineHeading(),
    defineList(),
    // Local: same union as @prosekit/extensions' defineBlockquote(), but the
    // input rule is anchored at both ends — the stock `/^>\s/` misfires on a
    // `>` typed mid-paragraph. See the note in ./blockquote-input-rule.
    defineBlockquote(),
    defineImage(),
    defineHorizontalRule(),
    defineHardBreak(),
    defineTable(),
    defineCodeBlock(),
    // `defineCode()` is intentionally first among the inline marks. ProseKit
    // merges this union into a schema whose mark ranks come out in the reverse
    // of the order listed here, so listing code first gives it the HIGHEST
    // rank. That matters for markdown output: prosemirror-markdown renders the
    // non-escaping `code` mark innermost only when it is last in `node.marks`
    // (i.e. highest rank), so `**`code`**` stays bold-wrapping-code. Moving this
    // line regresses that — see the rank assertion in
    // tests/markdown/roundtrip.test.ts.
    defineCode(),
    defineItalic(),
    defineBold(),
    defineUnderline(),
    defineStrike(),
    union(defineLinkSpec(), defineLinkCommands()),
    defineBaseKeymap(),
    defineBaseCommands(),
    defineHistory(),
    defineGapCursor(),
    defineVirtualSelection(),
    defineModClickPrevention(),
  );
}
