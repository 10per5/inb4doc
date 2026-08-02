import { Application, Controller } from "@hotwired/stimulus";
import { getFarmModuleSystem } from "$/farmfe-compat";
import { appEvents, AppEvent } from "@/stores/app-events";

type ControllerClass = new (...args: any[]) => Controller;

function isControllerClass(v: any): v is ControllerClass {
  if (typeof v !== "function" || !v.prototype) return false;
  if (v.prototype instanceof Controller || v === Controller) return true;
  let p = v.prototype;
  while (p && p !== Object.prototype) {
    if (
      typeof p.dispatch === "function" ||
      typeof p.connect === "function" ||
      "element" in p
    ) {
      return true;
    }
    p = Object.getPrototypeOf(p);
  }
  return false;
}

function extractController(
  mod: Record<string, unknown>,
  name?: string,
  chunkIds?: string[]
): ControllerClass {
  // The module ids the swapped chunk just re-registered. Primary path: works
  // with both dev's readable ids and production's opaque hashed ids, and covers
  // view-only edits (the controller's factory is unchanged, so a changed-ids
  // diff would miss it — but the whole chunk still re-registered).
  const ms = getFarmModuleSystem();
  if (ms && chunkIds?.length) {
    for (const id of chunkIds) {
      const ctrl = probeModule(ms, id);
      if (ctrl) return ctrl;
    }
  }

  if (mod.default && isControllerClass(mod.default)) {
    return mod.default as ControllerClass;
  }
  const found = Object.values(mod).find(isControllerClass);
  if (found) return found;

  if (ms && name && ms.modules) {
    const norm = name.replace(/[-_]controller$/, "");
    const matchKey = (k: string) => {
      const base = k
        .split("/")
        .pop()
        ?.replace(/\.ts$/, "")
        .replace(/[-_]controller$/, "");
      return base === norm;
    };
    const targetKey =
      Object.keys(ms.modules).find(
        (k) => k.includes("/controllers/") && matchKey(k)
      ) ?? Object.keys(ms.modules).find(matchKey);
    if (targetKey) {
      const ctrl = probeModule(ms, targetKey);
      if (ctrl) return ctrl;
    }
  }

  throw new Error(
    `No Stimulus controller found in module for "${name || "unknown"}"`
  );
}

// Require a registered module through Farm's runtime and, if its exports are a
// Stimulus controller class, return it. Returns null for non-controller modules.
function probeModule(ms: any, id: string): ControllerClass | null {
  try {
    const farmMod = ms.require(id);
    if (!farmMod) return null;
    if (farmMod.default && isControllerClass(farmMod.default)) {
      return farmMod.default as ControllerClass;
    }
    const found = Object.values(farmMod).find(isControllerClass);
    return (found as ControllerClass) ?? null;
  } catch {
    return null;
  }
}

// Chunk filenames the page has already executed (the app.js static import set
// plus anything the resource loader fetched since).
function loadedChunkNames(ms: any): Set<string> {
  return new Set(Object.keys(ms?.resourceLoader?._loadedResources ?? {}));
}

export class ModuleRegistry {
  private app: Application;
  private lastApplied = new Map<string, string>();

  constructor(app: Application) {
    this.app = app;
  }

  async swap(
    names: string[],
    _version: number,
    chunkUrls: Record<string, string>
  ): Promise<string[]> {
    const ms = getFarmModuleSystem();
    const remounted: string[] = [];

    for (const name of names) {
      const url = chunkUrls[name];
      if (!url) continue;
      if (this.lastApplied.get(name) === url) continue;

      // Baseline activation: this exact chunk is already loaded by app.js, so
      // nothing changed — record it and skip the remount.
      const chunkName = url.split("/").pop() ?? "";
      if (loadedChunkNames(ms).has(chunkName)) {
        this.lastApplied.set(name, url);
        continue;
      }

      let mod: Record<string, unknown> | undefined;
      let chunkIds: string[] = [];

      try {
        (this.app as any).router.unloadIdentifier(name);

        // Capture exactly which module ids this chunk (re-)registers. The
        // self-evict prelude deletes every id the chunk owns, then register()
        // reinstalls all of them — so the ids seen here are the chunk's module
        // set. Production hashes those ids (e.g. "63fb2e80"), so the controller
        // can't be matched by name, and a view-only edit leaves the controller
        // module's factory unchanged — a changed-ids diff would miss it.
        const originalRegister = ms?.register;
        const restoreRegister = () => {
          if (ms && typeof originalRegister === "function") {
            ms.register = originalRegister;
          }
        };
        if (ms && typeof originalRegister === "function") {
          ms.register = function (id: string, factory: unknown) {
            chunkIds.push(id);
            return originalRegister.call(ms, id, factory);
          };
        }
        try {
          mod = await import(url);
          // Farm's register() refuses to overwrite an already-registered module
          // id (it warns and keeps the OLD factory), so a chunk that executes
          // against a stale copy — or a module-cache hit that never re-executes —
          // silently leaves the old controller in place. If nothing was
          // re-registered, force a fresh execution.
          if (chunkIds.length === 0) {
            const sep = url.includes("?") ? "&" : "?";
            mod = await import(`${url}${sep}t=${Date.now()}`);
          }
        } finally {
          restoreRegister();
        }
        if (!mod) throw new Error(`No module loaded for "${name}"`);

        const CtrlClass = extractController(mod, name, chunkIds);
        this.app.register(name, CtrlClass);
        this.lastApplied.set(name, url);
        remounted.push(name);
      } catch (err) {
        console.error(`[sw] swap failed for "${name}":`, err, { chunkName });
        appEvents.emit(AppEvent.SWSwapFailed, { name });
        // Don't leave the controller unloaded — re-register the previous
        // module so it reconnects.
        try {
          const fallback = extractController(mod ?? {}, name, chunkIds);
          this.app.register(name, fallback);
        } catch {
          // no usable module — leave unloaded
        }
      }
    }

    return remounted;
  }

  has(name: string): boolean {
    return !!(this.app as any).router.modulesByIdentifier?.[name];
  }
}
