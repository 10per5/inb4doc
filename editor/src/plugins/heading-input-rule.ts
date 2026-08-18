import { InputRule, inputRules } from "prosemirror-inputrules"

export const fixedHeadingInputRule = inputRules({
  rules: [
    new InputRule(
      /^(?<hashes>#+)\s$/,
      (state, match) => {
        const level = match.groups?.hashes?.length || 1
        const heading = state.schema.nodes.heading.create({ level })
        return state.tr.replaceWith(match.index!, match.index! + match[0].length, heading)
      },
    ),
  ],
})
