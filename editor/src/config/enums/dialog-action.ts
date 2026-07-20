/**
 * data-action values for generic dialogs (changes, prompt, create, image manager).
 */
export const DIALOG_ACTION_PREFIX = "dlg-";

export enum DialogAction {
  SaveAll,
  Close,
  PromptKeydown,
  CreateInput,
  CreateKeydown,
  Review,
  Copy,
  Delete,
}
