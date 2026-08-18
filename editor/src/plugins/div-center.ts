import { Plugin, PluginKey } from "prosemirror-state"

const _divCenterPluginKey = new PluginKey("div-center-stub")

export const divCenterRemarkPlugin = new Plugin({
  key: _divCenterPluginKey,
})

export const divCenterSchema = new Plugin({
  key: new PluginKey("div-center-schema-stub"),
})
