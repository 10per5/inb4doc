/**
 * editor-source — DOM toggling for source mode.
 *
 * Pure DOM — no Milkdown or editorContext imports.
 * Milkdown operations (parse/serialize) are injected by the caller.
 */

import { autoResize } from "@/utils/text"

export function toggleSourceMode(
  sourceEl: HTMLElement,
  wysiwygEl: HTMLElement,
  sourceMode: boolean,
  getMarkdown: () => string,
  setEditorContent: (content: string) => void,
): boolean {
  const newMode = !sourceMode;
  if (newMode) {
    const md = getMarkdown();
    sourceEl.style.display = "flex";
    wysiwygEl.style.display = "none";
    const ta = sourceEl.querySelector("textarea") as HTMLTextAreaElement;
    ta.value = md;
    ta.oninput = () => autoResize(ta);
    autoResize(ta);
  } else {
    sourceEl.style.display = "none";
    wysiwygEl.style.display = "block";
  }
  return newMode;
}

export function applySourceContent(
  textarea: HTMLTextAreaElement,
  setEditorContent: (content: string) => void,
): boolean {
  if (!textarea) return false;
  setEditorContent(textarea.value);
  return true;
}
