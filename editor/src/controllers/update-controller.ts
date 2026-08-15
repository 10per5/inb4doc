import { Controller } from "@hotwired/stimulus";
import { appEvents, AppEvent } from "@/stores/app-events";
import { formatBytes } from "@/utils/format";
import {
  showProgressToast,
  showActionToast,
  type ProgressToastHandle,
} from "@/components/notification/toast";

const APPLY_FALLBACK_MS = 2500;
const UPDATED_MS = 800;
// Last-resort backstop: if a leftover-update notice never resolves (e.g. the SW
// is genuinely stuck), stop showing it rather than block forever. Real updates
// dismiss naturally via progress/apply events, and a moot update is resolved
// immediately, so this only fires in the stuck case.
const PENDING_MAX_MS = 30_000;

export default class UpdateController extends Controller {
  private toast: ProgressToastHandle | null = null;
  private unsubs: (() => void)[] = [];
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;

  connect(): void {
    this.unsubs = [
      appEvents.on(AppEvent.UpdateAvailable, () => this.onUpdate()),
      appEvents.on(AppEvent.SWInstallProgress, (data) => this.onProgress(data)),
      appEvents.on(AppEvent.SWUpdateReady, () => this.onReady()),
      appEvents.on(AppEvent.ModulesSwapped, () => this.onSwapped()),
      appEvents.on(AppEvent.SWUpdatePending, () => this.onPending()),
      appEvents.on(AppEvent.SWUpdateResolved, () => this.dismiss()),
      appEvents.on(AppEvent.UpdateRequiresReload, (data) =>
        this.onRequiresReload(data)
      ),
    ];
  }

  disconnect(): void {
    this.unsubs.forEach((fn) => fn());
    if (this.dismissTimer) clearTimeout(this.dismissTimer);
    this.toast?.remove();
    this.toast = null;
  }

  private onUpdate(): void {
    if (this.toast) this.toast.remove();
    this.toast = showProgressToast("Downloading update\u2026");
  }

  // A reload found an unfinished update (the upgrade-in-progress flag was still
  // set). The install is being retried; hold the notice until it resolves or a
  // stale-flag timeout clears it.
  private onPending(): void {
    if (this.toast) this.toast.remove();
    this.toast = showProgressToast("Finishing update\u2026");
    if (this.dismissTimer) clearTimeout(this.dismissTimer);
    this.dismissTimer = setTimeout(() => this.dismiss(), PENDING_MAX_MS);
  }

  private onProgress(data: { loaded: number; total: number }): void {
    if (!this.toast) return;
    this.toast.updateProgress(data.loaded, data.total);
    // `total` is the sum of every size the SW knows so far (an estimate that
    // converges to the real transfer); when nothing is known yet, or a file of
    // unknown size pushed `loaded` past the estimate, show just the actual
    // bytes transferred instead of a meaningless ratio.
    const label =
      data.total > 0 && data.loaded <= data.total
        ? `Downloading update\u2026 ${formatBytes(
            data.loaded,
            false
          )} / ${formatBytes(data.total, false)}`
        : `Downloading update\u2026 ${formatBytes(data.loaded, false)}`;
    this.toast.setMessage(label);
  }

  private onReady(): void {
    if (!this.toast) return;
    this.apply();
    this.toast.setMessage("Applying update\u2026");
    // An activation that swaps nothing (baseline skip) never emits
    // ModulesSwapped, so dismiss on a timer regardless.
    if (this.dismissTimer) clearTimeout(this.dismissTimer);
    this.dismissTimer = setTimeout(() => this.dismiss(), APPLY_FALLBACK_MS);
  }

  private onSwapped(): void {
    if (!this.toast) return;
    if (this.dismissTimer) clearTimeout(this.dismissTimer);
    this.toast.setMessage("Updated");
    this.dismissTimer = setTimeout(() => this.dismiss(), UPDATED_MS);
  }

  private onRequiresReload(_data: { reason: string }): void {
    // A change that cannot be applied in place (entry pot / shell / stateful
    // pot). Production builds ask first — the page may hold unsaved edits — and
    // let the user reload on their terms. Dev mode never emits this (it reloads
    // immediately in sw-registrar-service).
    if (this.toast) this.toast.remove();
    this.toast = null;
    if (this.dismissTimer) clearTimeout(this.dismissTimer);
    showActionToast("Update requires a reload to apply", "OK", () =>
      location.reload()
    );
  }

  private dismiss(): void {
    this.dismissTimer = null;
    this.toast?.remove();
    this.toast = null;
  }

  private async apply(): Promise<void> {
    if (!("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    reg?.waiting?.postMessage({ type: "SKIP_WAITING" });
  }
}
