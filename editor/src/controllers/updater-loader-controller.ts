import { Controller } from "@hotwired/stimulus";
import { appEvents, AppEvent } from "@/stores/app-events";
import { formatBytes } from "@/utils/format";
import { hasFunc, AppFunc } from "$/build/build-mode";
import renderUpdaterLoader from "@/eta/views/controller/updater-loader";

// Thin-shell first-run loader (GuiDesktop / GuiMobile). The installed shell
// ships only the eager boot set; the first updater pull downloads the whole
// editor into the writable data dir. This controller swaps the skeleton for a
// dedicated loading view (header, description, endless loader, progress bar,
// status) for the duration of that first pull — bigger and calmer than the
// update toast used for subsequent updates.
export default class extends Controller {
  static targets = ["root", "fill", "status", "counter"];

  declare readonly rootTarget: HTMLElement;
  declare readonly fillTarget: HTMLElement;
  declare readonly statusTarget: HTMLElement;
  declare readonly counterTarget: HTMLElement;

  private shown = false;
  private unsubs: (() => void)[] = [];
  private probeTimer: ReturnType<typeof setTimeout> | null = null;

  connect(): void {
    if (hasFunc(AppFunc.FullBundle)) return;
    this.element.innerHTML = renderUpdaterLoader({} as Record<string, unknown>);
    this.rootTarget.hidden = true;

    this.unsubs = [
      appEvents.on(AppEvent.SWInstallProgress, (data) => this.onProgress(data)),
      appEvents.on(AppEvent.SWUpdateReady, () => this.onReady()),
      appEvents.on(AppEvent.ModulesSwapped, () => this.hide()),
    ];

    // First run has no transfer yet, so don't wait for events: probe the
    // updater storage a tick after boot (the native bridge — desktop saucer /
    // mobile NativeBridge shim — is installed during init()).
    this.probeTimer = setTimeout(() => {
      void this.probe();
    }, 100);
  }

  disconnect(): void {
    this.unsubs.forEach((fn) => fn());
    if (this.probeTimer) clearTimeout(this.probeTimer);
  }

  private async probe(): Promise<void> {
    const exposed = (window as any).saucer?.exposed as
      | Record<string, unknown>
      | undefined;
    if (typeof exposed?.updaterHas !== "function") return; // nothing to download
    try {
      const raw = (await (exposed.updaterHas as (p: string) => Promise<string>)(
        "index.html"
      )) as string;
      let data: unknown = raw;
      if (typeof raw === "string") {
        try {
          data = (JSON.parse(raw) as { data?: unknown })?.data ?? JSON.parse(raw);
        } catch {
          data = raw;
        }
      }
      // Data dir empty => the live editor isn't there yet => this is the first
      // run. Show the loader; the transfer + reload handles the rest.
      if (data !== true && data !== "true") this.show();
    } catch {
      // Unknown state — the update events below still drive the loader.
    }
  }

  private show(): void {
    if (this.shown) return;
    this.shown = true;
    this.rootTarget.hidden = false;
    this.statusTarget.textContent = "Downloading the editor…";
  }

  private onProgress(data: { loaded: number; total: number; done: boolean }): void {
    this.show();
    const { loaded, total } = data;
    const known = total > 0 && loaded <= total;
    this.fillTarget.classList.toggle("is-indeterminate", !known);
    if (known) {
      const pct = Math.min(100, Math.round((loaded / total) * 100));
      this.fillTarget.style.width = `${pct}%`;
      this.counterTarget.textContent = `${pct}%`;
      this.statusTarget.textContent = `Downloading the editor… ${formatBytes(
        loaded,
        false
      )} / ${formatBytes(total, false)}`;
    } else {
      this.counterTarget.textContent = "…";
      this.statusTarget.textContent = `Downloading the editor… ${formatBytes(
        loaded,
        false
      )}`;
    }
  }

  private onReady(): void {
    this.show();
    this.statusTarget.textContent = "Applying the editor…";
  }

  private hide(): void {
    this.shown = false;
    this.rootTarget.hidden = true;
  }
}
