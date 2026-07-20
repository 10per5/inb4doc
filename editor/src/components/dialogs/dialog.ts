import { isHugoIndex, HUGO_INDEX_HINT } from "@/utils/hugo-compat"
import { openHtmlDialogPromise } from "@/services/dialog-service"
import renderConfirmDialog from "@/eta/dialogs/confirm-dialog"
import renderPromptDialog from "@/eta/dialogs/prompt-dialog"
import renderCreateDialog from "@/eta/dialogs/create-dialog"

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
  const html = renderConfirmDialog({
    title: opts.title,
    message: opts.message,
    cancelLabel: opts.cancelLabel ?? "Cancel",
    confirmLabel: opts.confirmLabel ?? "Confirm",
    confirmClass: opts.confirmClass ?? "",
  })
  return openHtmlDialogPromise<boolean | null>({
    html,
    resolveEvent: "dialog:confirm",
    cancelEvent: "dialog:cancel",
  }) as Promise<boolean>
}

export function promptDialog(opts: PromptOptions): Promise<string | null> {
  const inputId = "inb4doc-prompt-input-" + Math.random().toString(36).slice(2)
  const html = renderPromptDialog({
    title: opts.title,
    label: opts.label,
    placeholder: opts.placeholder ?? "",
    value: opts.value ?? "",
    cancelLabel: opts.cancelLabel ?? "Cancel",
    confirmLabel: opts.confirmLabel ?? "Create",
    inputId,
  })
  return openHtmlDialogPromise<string>({
    html,
    resolveEvent: "dialog:confirm",
    cancelEvent: "dialog:cancel",
  })
}

export function promptCreateDialog(title: string, opts?: { defaultValue?: string }): Promise<CreateDialogResult | null> {
  const inputId = "inb4doc-create-input-" + Math.random().toString(36).slice(2)
  const checkId = "inb4doc-create-check-" + Math.random().toString(36).slice(2)
  const hintId = "inb4doc-create-hint-" + Math.random().toString(36).slice(2)
  const hint = opts?.defaultValue && isHugoIndex(opts.defaultValue) ? HUGO_INDEX_HINT : ""
  const html = renderCreateDialog({
    title,
    inputId,
    checkId,
    hintId,
    defaultValue: opts?.defaultValue ?? "",
    hint,
  })
  return openHtmlDialogPromise<CreateDialogResult>({
    html,
    resolveEvent: "dialog:confirm",
    cancelEvent: "dialog:cancel",
  })
}
