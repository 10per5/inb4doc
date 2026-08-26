import { defineMarkPasteRule } from "@prosekit/core"
import type { PlainExtension } from "@prosekit/core"
import { defineEnterRule } from "@prosekit/extensions/enter-rule"
import { defineInputRule } from "@prosekit/extensions/input-rule"
import { InputRule } from "@prosekit/pm/inputrules"
import { TextSelection } from "prosemirror-state"

// Scheme-only autolinking: a bare URL typed at the cursor becomes a link
// when followed by a space or Enter, and pasted URLs become links. Bare
// domains, www.* hosts, emails and filename-like text (AGENTS.md — .md is a
// real ccTLD) never auto-link. Parse-time linkify stays off; this is the
// only autolinker in the app.

const TYPED_URL_RE = /(https?:\/\/[^\s]+)[ \u00a0]$/

const ENTER_URL_RE = /(https?:\/\/[^\s]+)$/

const PASTED_URL_RE = /(https?:\/\/[^\s]+)/g

function createTypedUrlRule(): PlainExtension {
  return defineInputRule(
    new InputRule(TYPED_URL_RE, (state, match, start) => {
      const href = match[1]
      if (!href) return null
      const link = state.schema.marks.link
      if (!link) return null
      // When a rule matches, ProseMirror skips the default text insertion —
      // the typed space only exists in the regex match, not in the doc. Add
      // the mark over the URL, then insert the space and move the cursor
      // after it so typing continues outside the link.
      const tr = state.tr.addMark(
        start,
        start + href.length,
        link.create({ href }),
      )
      tr.insert(start + href.length, state.schema.text(" "))
      tr.setSelection(TextSelection.create(tr.doc, start + href.length + 1))
      return tr
    }),
  )
}

function createUrlEnterRule(): PlainExtension {
  return defineEnterRule({
    regex: ENTER_URL_RE,
    handler: ({ state, from, match }) => {
      const href = match[1]
      if (!href) return null
      const link = state.schema.marks.link
      if (!link) return null
      // Enter's default block-split proceeds normally; only the mark is
      // applied over the URL before the split.
      const tr = state.tr.addMark(from, from + href.length, link.create({ href }))
      return tr.docChanged ? tr : null
    },
  })
}

function createPastedUrlRule(): PlainExtension {
  return defineMarkPasteRule({
    regex: PASTED_URL_RE,
    type: "link",
    getAttrs: (m) => (m[1] ? { href: m[1] } : false),
  })
}

export function createLinkAutolinkExtensions(): PlainExtension[] {
  return [createTypedUrlRule(), createUrlEnterRule(), createPastedUrlRule()]
}
