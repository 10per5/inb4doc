/**
 * editor-source — DOM toggling for source mode.
 *
 * Pure DOM — no Milkdown or editorContext imports.
 * Milkdown operations (parse/serialize) are injected by the caller.
 */

import { autoResize } from "@/utils/text"

export function showSourceMode(
  sourceEl: HTMLElement,
  wysiwygEl: HTMLElement,
  getMarkdown: () => string,
): void {
  sourceEl.style.display = "flex";
  wysiwygEl.style.display = "none";
  const ta = sourceEl.querySelector("textarea") as HTMLTextAreaElement;
  ta.value = getMarkdown();
  ta.oninput = () => autoResize(ta);
  autoResize(ta);
}

export function hideSourceMode(
  sourceEl: HTMLElement,
  wysiwygEl: HTMLElement,
): void {
  sourceEl.style.display = "none";
  wysiwygEl.style.display = "block";
}
