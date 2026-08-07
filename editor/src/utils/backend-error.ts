/**
 * Backend error → toast mapping.
 *
 * Backends report failures with real HTTP status codes ("Forbidden" 403,
 * "Not found" 404, "Content too large" 413, "Write failed" 500) — both the
 * remote HTTP server (RemoteProvider) and the embedded GUI C++ backend
 * (gui/src/scheme.cpp, exposed via the native bridge as gui/src/bridge.cpp).
 * These previously vanished in the JS fetch path — a failed PUT/DELETE
 * resolved fine and the editor kept showing "All files saved".
 *
 * Only common, user-relevant failures get a toast. Everything else is logged
 * and stays silent to avoid toast overload.
 */
import { showToast, type ToastType } from "@/components/notification/toast"

export interface BackendError extends Error {
  status?: number
}

export function backendError(status: number, message: string): BackendError {
  const err = new Error(message) as BackendError
  err.status = status
  return err
}

const TOAST_BY_STATUS: Record<number, { message: string; type: ToastType }> = {
  403: { message: "Forbidden — target is outside the content folder", type: "danger" },
  404: { message: "File not found", type: "warning" },
  413: { message: "Content too large to save", type: "warning" },
  500: { message: "Write failed — could not save to disk", type: "danger" },
}

export function surfaceBackendError(error: unknown): boolean {
  const status = (error as BackendError)?.status
  const mapped = status ? TOAST_BY_STATUS[status] : undefined
  if (mapped) {
    showToast(mapped.message, { type: mapped.type })
    return true
  }
  console.warn("Unsurfaced backend error:", error)
  return false
}
