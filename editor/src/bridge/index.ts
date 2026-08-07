/**
 * Pure, reusable bridge utilities shared by every native bridge type.
 *
 * Nothing here binds to a specific native host. Per-host wiring lives under
 * bridge/<type>/ — e.g. the desktop Saucer GUI in bridge/desktop/, and a
 * future mobile bridge in bridge/mobile/.
 */
export { showToast } from "@/components/notification/toast"
export { openFind, findNext, findPrev } from "./find"
