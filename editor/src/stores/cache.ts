import * as diff from "diff";
import { loadStorage, saveStorage } from "@/utils/storage";
import { serializeFrontmatter } from "@/utils/frontmatter";
import type { MetaPanelData } from "@/components/panels/meta-panel";

class Cache {
  private patches: Map<string, string> = new Map();
  private bodies: Map<string, string> = new Map();
  private baselines: Map<string, string> = new Map();
  private dirty: Set<string> = new Set();
  private frontmatterCache: Map<string, MetaPanelData> = new Map();
  private serverTimes: Map<string, number> = new Map();

  constructor() {
    this.load();
  }

  private load() {
    const storage = loadStorage();
    for (const [path, patch] of storage.patches) {
      this.patches.set(path, patch);
      this.dirty.add(path);
    }
    for (const [path, time] of storage.lastServerTime ?? []) {
      this.serverTimes.set(path, time);
    }
    for (const [path, fm] of storage.frontmatter ?? []) {
      this.frontmatterCache.set(path, fm as MetaPanelData);
      this.dirty.add(path);
    }
    for (const [path, body] of storage.bodies ?? []) {
      this.bodies.set(path, body);
    }
    for (const [path, baseline] of storage.baselines ?? []) {
      this.baselines.set(path, baseline);
    }
  }

  sync() {
    const patches: [string, string][] = [...this.patches.entries()];
    const lastServerTime: [string, number][] = [...this.serverTimes.entries()];
    const frontmatter: [string, Record<string, string | number | undefined>][] = [];
    const bodies: [string, string][] = [];
    const baselines: [string, string][] = [];
    for (const path of this.dirty) {
      const fm = this.frontmatterCache.get(path);
      if (fm) frontmatter.push([path, { ...fm }]);
      const body = this.bodies.get(path);
      if (body !== undefined) bodies.push([path, body]);
      const baseline = this.baselines.get(path);
      if (baseline !== undefined) baselines.push([path, baseline]);
    }
    saveStorage({ patches, lastServerTime, frontmatter, bodies, baselines });
  }

  setBody(path: string, body: string) {
    this.bodies.set(path, body);
    const baseline = this.baselines.get(path);
    if (baseline !== undefined) {
      const patch = diff.createPatch(path, baseline, body, "", "", { context: 3 });
      this.patches.set(path, patch);
    } else {
      this.patches.delete(path);
    }
    this.dirty.add(path);
    if (this.getBodyDelta(path) === 0) {
      this.dirty.delete(path);
      this.patches.delete(path);
    }
  }

  getBody(path: string): string | undefined {
    return this.bodies.get(path);
  }

  cacheBody(path: string, body: string) {
    this.bodies.set(path, body);
  }

  setBaseline(path: string, originalBody: string) {
    this.baselines.set(path, originalBody);
    const patch = this.patches.get(path);
    if (patch) {
      const result = diff.applyPatch(originalBody, patch);
      if (typeof result === "string") {
        this.bodies.set(path, result);
        this.dirty.add(path);
      } else {
        this.patches.delete(path);
        this.dirty.delete(path);
      }
    }
  }

  getBaseline(path: string): string | undefined {
    return this.baselines.get(path);
  }

  deletePatch(path: string) {
    this.patches.delete(path);
    this.bodies.delete(path);
    this.dirty.delete(path);
  }

  hasPatch(path: string): boolean {
    return this.patches.has(path);
  }

  getBodyDelta(path: string): number {
    const body = this.bodies.get(path);
    const baseline = this.baselines.get(path);
    if (body !== undefined && baseline !== undefined) return body.length - baseline.length;
    if (body !== undefined) return body.length;
    return 0;
  }

  reconstructContent(path: string): string | undefined {
    const body = this.bodies.get(path);
    if (body === undefined) return undefined;
    const fm = this.frontmatterCache.get(path);
    if (fm) {
      return "---\n" + serializeFrontmatter(fm) + "\n---\n\n" + body;
    }
    return body;
  }

  setFrontmatter(path: string, data: MetaPanelData) {
    this.frontmatterCache.set(path, data);
  }

  removeFrontmatter(path: string) {
    this.frontmatterCache.delete(path);
  }

  getFrontmatter(path: string): MetaPanelData | undefined {
    return this.frontmatterCache.get(path);
  }

  setServerTime(path: string, time: number) {
    this.serverTimes.set(path, time);
  }

  getServerTime(path: string): number | undefined {
    return this.serverTimes.get(path);
  }

  addDirty(path: string) {
    this.dirty.add(path);
  }

  removeDirty(path: string) {
    this.dirty.delete(path);
  }

  isDirty(path: string): boolean {
    return this.dirty.has(path);
  }

  getDirtyPaths(): string[] {
    return [...this.dirty];
  }

  getDirtyCount(): number {
    return this.dirty.size;
  }

  forEachDirty(fn: (path: string, md?: string) => void) {
    for (const path of this.dirty) {
      fn(path, this.reconstructContent(path));
    }
  }

  clearPath(path: string) {
    this.patches.delete(path);
    this.bodies.delete(path);
    this.baselines.delete(path);
    this.dirty.delete(path);
    this.frontmatterCache.delete(path);
    this.serverTimes.delete(path);
  }

  clearAll() {
    this.patches.clear();
    this.bodies.clear();
    this.baselines.clear();
    this.dirty.clear();
    this.frontmatterCache.clear();
    this.serverTimes.clear();
  }

  saveState(key: string) {
    try {
      const state = {
        patches: [...this.patches.entries()],
        bodies: [...this.bodies.entries()],
        baselines: [...this.baselines.entries()],
        dirty: [...this.dirty],
        frontmatter: [...this.frontmatterCache.entries()],
        serverTimes: [...this.serverTimes.entries()],
      }
      localStorage.setItem(`inb4doc-cache-${key}`, JSON.stringify(state))
    } catch {}
  }

  restoreState(key: string) {
    this.clearAll()
    try {
      const raw = localStorage.getItem(`inb4doc-cache-${key}`)
      if (!raw) return
      const state = JSON.parse(raw)
      for (const [k, v] of state.patches ?? []) this.patches.set(k, v)
      for (const [k, v] of state.bodies ?? []) this.bodies.set(k, v)
      for (const [k, v] of state.baselines ?? []) this.baselines.set(k, v)
      for (const k of state.dirty ?? []) this.dirty.add(k)
      for (const [k, v] of state.frontmatter ?? []) this.frontmatterCache.set(k, v as MetaPanelData)
      for (const [k, v] of state.serverTimes ?? []) this.serverTimes.set(k, v)
    } catch {}
  }
}

export const cache = new Cache();
