import { Plugin, PluginKey } from "prosemirror-state"

const _alertPluginKey = new PluginKey("alert-stub")

export const alertRemarkPlugin = new Plugin({
  key: _alertPluginKey,
})

export const alertSchema = new Plugin({
  key: new PluginKey("alert-schema-stub"),
})
