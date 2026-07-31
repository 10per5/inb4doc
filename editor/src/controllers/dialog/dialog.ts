import { isHugoIndex, HUGO_INDEX_HINT } from "@/utils/hugo-compat"
import { openDialog } from "@/services/dialog-service"

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  confirmClass?: string
}

export interface PromptOptions {
  title: string
  label?: string
  placeholder?: string
  value?: string
  confirmLabel?: string
  cancelLabel?: string
}

export interface CreateDialogResult {
  name: string
  asDirectory: boolean
}

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return openDialog<boolean>("confirm-dialog", {
    title: opts.title,
    message: opts.message,
    cancelLabel: opts.cancelLabel ?? "Cancel",
    confirmLabel: opts.confirmLabel ?? "Confirm",
    confirmClass: opts.confirmClass ?? "",
  }).promise as Promise<boolean>
}

export function promptDialog(opts: PromptOptions): Promise<string | null> {
  const inputId = "inb4doc-prompt-input-" + Math.random().toString(36).slice(2)
  return openDialog<string>("prompt-dialog", {
    title: opts.title,
    label: opts.label,
    placeholder: opts.placeholder ?? "",
    value: opts.value ?? "",
    cancelLabel: opts.cancelLabel ?? "Cancel",
    confirmLabel: opts.confirmLabel ?? "Create",
    inputId,
  }).promise
}

export function promptCreateDialog(title: string, opts?: { defaultValue?: string }): Promise<CreateDialogResult | null> {
  const inputId = "inb4doc-create-input-" + Math.random().toString(36).slice(2)
  const checkId = "inb4doc-create-check-" + Math.random().toString(36).slice(2)
  const hintId = "inb4doc-create-hint-" + Math.random().toString(36).slice(2)
  const hint = opts?.defaultValue && isHugoIndex(opts.defaultValue) ? HUGO_INDEX_HINT : ""
  return openDialog<CreateDialogResult>("create-dialog", {
    title,
    inputId,
    checkId,
    hintId,
    defaultValue: opts?.defaultValue ?? "",
    hint,
  }).promise
}
