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

export function getLoadedChunkNames(): Set<string> {
  return loadedChunkNames(getFarmModuleSystem());
}

export class ModuleRegistry {
  private app: Application;

  constructor(app: Application) {
    this.app = app;
  }

  // Farm's runtime register() refuses to overwrite an already-known module id
  // (it warns and keeps the OLD factory) unless the chunk's self-evict prelude
  // deleted it first — a chunk fetched in the pre-injection window (served from
  // a precache/cache-skip before injectSelfEvicting ran, or re-executed against
  // a stale module map) registers without evicting and silently keeps the old
  // code. Evict the chunk's module ids up front by __farm_resource_pot__
  // membership, independent of the prelude, so the re-import installs fresh.
  //
  // The pot is the chunk's own filename (or its document.baseURI-resolved URL
  // when loaded as a native module, where document.currentScript is null), with
  // or without the content hash. Match on the hash-stripped stem so the old and
  // new versions of the same controller/service pot identify each other.
  private evictPotModules(ms: any, name: string): void {
    if (!ms?.modules) return;
    const stemOf = (pot: unknown): string => {
      const seg =
        String(pot ?? "").split("?")[0].split("#")[0].split("/").pop() ?? "";
      return seg.replace(/(?:-[a-f0-9]{8,})?\.js$/, "");
    };
    const stem = stemOf(name);
    for (const id of Object.keys(ms.modules)) {
      if (stemOf(ms.modules[id]?.__farm_resource_pot__) === stem) {
        ms.delete(id);
      }
    }
  }

  // Hot-swap for a chunk-graph activation.
  //   importNames  — non-controller chunk names whose modules must be
  //                  (re-)registered so downstream controllers pick up fresh
  //                  code. Only newly-emitted chunks have new URLs, so loaded
  //                  names are skipped.
  //   remountNames — controller chunk names to re-import AND re-register in the
  //                  Stimulus app, which disconnects and reconnects them and
  //                  re-runs their factories (and the dependency chain those
  //                  factories require). This is what applies a service change
  //                  to controllers that merely imported it.
  async swap(
    importNames: string[],
    remountNames: string[],
    urlForChunk: (name: string) => string | undefined,
    idForChunk: (name: string) => string | undefined
  ): Promise<string[]> {
    const ms = getFarmModuleSystem();
    const remounted: string[] = [];
    const seen = new Set<string>();

    const importChunk = async (
      name: string
    ): Promise<{ mod: Record<string, unknown>; chunkIds: string[] }> => {
      const url = urlForChunk(name);
      if (!url) return { mod: {}, chunkIds: [] };
      let mod: Record<string, unknown> | undefined;
      let chunkIds: string[] = [];

      // Capture exactly which module ids this chunk (re-)registers. The
      // self-evict prelude deletes every id the chunk owns, then register()
      // reinstalls all of them — so the ids seen here are the chunk's module
      // set. Production hashes those ids (e.g. "63fb2e80"), so the controller
      // can't be matched by name, and a view-only edit leaves the controller
      // module's factory unchanged — a changed-ids diff would miss it.
      const originalRegister = ms?.register;
      const prevReRegister = ms?.reRegisterModules ?? false;
      const restoreRegister = () => {
        if (ms && typeof originalRegister === "function") {
          ms.register = originalRegister;
        }
        if (ms) ms.reRegisterModules = prevReRegister;
      };
      if (ms && typeof originalRegister === "function") {
        ms.register = function (id: string, factory: unknown) {
          chunkIds.push(id);
          return originalRegister.call(ms, id, factory);
        };
      }
      // Force re-registration even if a stale copy still holds this chunk's ids
      // (the pre-injection window) and clear their module cache up front so the
      // prelude's deletion is a no-op and the fresh factories always install.
      if (ms) ms.reRegisterModules = true;
      this.evictPotModules(ms, name);
      try {
        mod = await import(url);
        // A css-only chunk (styles-*.js) is a set of idempotent style
        // injectors: register() installs the factories but nothing re-executes
        // them, so re-require each css module to run the injector and replace
        // the matching <style> in place.
        if (chunkIds.length > 0 && chunkIds.every((id) => id.endsWith(".css"))) {
          for (const id of chunkIds) ms?.require(id);
        }
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
      return { mod: mod ?? {}, chunkIds };
    };

    // Invalidate changed non-controller chunks (new names, so never loaded).
    for (const name of importNames) {
      if (seen.has(name)) continue;
      seen.add(name);
      if (loadedChunkNames(ms).has(name)) continue;
      try {
        await importChunk(name);
      } catch (err) {
        console.error(`[sw] invalidation import failed for "${name}":`, err);
        appEvents.emit(AppEvent.SWSwapFailed, { name });
      }
    }

    // Re-import + re-register affected controller chunks.
    for (const name of remountNames) {
      if (seen.has(name)) continue;
      seen.add(name);
      const id = idForChunk(name);
      const url = urlForChunk(name);
      if (!id || !url) continue;
      let mod: Record<string, unknown> | undefined;
      let chunkIds: string[] = [];
      try {
        (this.app as any).router.unloadIdentifier(id);
        const loaded = await importChunk(name);
        mod = loaded.mod;
        chunkIds = loaded.chunkIds;
        const CtrlClass = extractController(mod, id, chunkIds);
        this.app.register(id, CtrlClass);
        remounted.push(id);
      } catch (err) {
        console.error(`[sw] swap failed for "${name}":`, err, { url });
        appEvents.emit(AppEvent.SWSwapFailed, { name });
        // Don't leave the controller unloaded — re-register the previous
        // module so it reconnects.
        try {
          const fallback = extractController(mod ?? {}, id, chunkIds);
          this.app.register(id, fallback);
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
