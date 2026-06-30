type HotkeyHandler = () => void;

const SHIFT = 1;
const CTRL = 2;
const META = 4;

interface Binding {
  mods: number;
  key: string;
  handler: HotkeyHandler;
}

/**
 * Alternatively, consider https://wangchujiang.com/hotkeys-js/
 */
export class HotkeyManager {
  private bindings: Binding[] = [];

  register(key: string, handler: HotkeyHandler): void {
    const parts = key.split("+").map((s) => s.trim().toLowerCase());
    let mods = 0;
    let targetKey = "";
    for (const p of parts) {
      if (p === "ctrl") mods |= CTRL;
      else if (p === "shift") mods |= SHIFT;
      else if (p === "meta" || p === "cmd") mods |= META;
      else targetKey = p;
    }
    if (!targetKey) return;
    this.bindings.push({ mods, key: targetKey, handler });
  }

  handle(e: KeyboardEvent): boolean {
    let mods = 0;
    if (e.ctrlKey) mods |= CTRL;
    if (e.shiftKey) mods |= SHIFT;
    if (e.metaKey) mods |= META;

    const key = e.key.toLowerCase();
    for (const b of this.bindings) {
      if (b.mods === mods && b.key === key) {
        e.preventDefault();
        b.handler();
        return true;
      }
    }
    return false;
  }

  attach(): void {
    document.addEventListener("keydown", (e) => this.handle(e));
  }
}

export const hotkeys = new HotkeyManager();
hotkeys.attach();

