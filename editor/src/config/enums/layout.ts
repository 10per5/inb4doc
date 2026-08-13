/**
 * Layout presets — the derived combination of the Navtree/Meta panel toggles.
 * Int-based so the value in the LayoutChanged payload stays compact.
 */
export enum LayoutPreset {
  Focused,
  LeftPanel,
  RightPanel,
  TwoPanel,
}

/**
 * Viewport width buckets used to decide which chrome/columns are in flow.
 * MobileShrink is a keyboard-driven variant of Mobile: while the on-screen
 * keyboard is open the layout height is reduced to the visual viewport (the
 * area above the keys) so the fixed topbar/dock are not panned out of view.
 */
export enum LayoutWidth {
  Mobile,
  Tablet,
  Desktop,
  MobileShrink,
}
