import { Controller } from "@hotwired/stimulus";
import { appEvents, AppEvent } from "@/stores/app-events";
import { formatBytes } from "@/utils/format";
import {
  showProgressToast,
  type ProgressToastHandle,
} from "@/components/notification/toast";

const APPLY_FALLBACK_MS = 2500;
const UPDATED_MS = 800;

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

  private onProgress(data: { loaded: number; total: number }): void {
    if (!this.toast) return;
    this.toast.updateProgress(data.loaded, data.total);
    this.toast.setMessage(
      `Downloading update\u2026 ${formatBytes(data.loaded, false)} / ${formatBytes(data.total, false)}`
    );
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
