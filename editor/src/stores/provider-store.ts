import type { ContentProvider } from "@/providers/provider";
import { ProviderType, createProviderByType } from "@/providers/index";
import { connectionStore } from "@/stores/connection-store";
import { treeStore } from "@/stores/tree-store";
import { createEmptyTreeIndex } from "@/utils/tree";
import { appEvents, AppEvent } from "@/stores/app-events";
import { hasFunc, AppFunc } from "$/build/build-mode";

const LAST_PROVIDER_KEY = "inb4doc-last-provider";

let globalProvider: ContentProvider | null = null;

export function setProvider(provider: ContentProvider) {
  globalProvider = provider;
}

export function getProvider(): ContentProvider {
  if (!globalProvider) throw new Error("ContentProvider not initialized");
  return globalProvider;
}

function saveLastProvider(type: ProviderType) {
  try { localStorage.setItem(LAST_PROVIDER_KEY, String(type)) } catch {}
}

function loadLastProvider(): ProviderType | null {
  try {
    const v = localStorage.getItem(LAST_PROVIDER_KEY);
    if (v != null) {
      const n = Number(v);
      if (n in ProviderType) return n as ProviderType;
    }
  } catch {}
  return null;
}

/**
 * Initialize the provider at app startup.
 *
 * Default rules:
 *   GuiDesktop / GuiMobile  →  try Mount first, then localStorage
 *   WebLocal                →  try Remote first, then localStorage
 *   All others              →  localStorage
 *
 * Filesystem is never auto-selected (requires user gesture for showDirectoryPicker).
 * If getTree() fails the provider falls back to an empty tree; the user can
 * switch providers explicitly via the provider dialog.
 */
export async function initializeProvider(): Promise<void> {
  const last = loadLastProvider();
  const defaultToRemote = hasFunc(AppFunc.DefaultToRemote);
  const useMount = hasFunc(AppFunc.MountProvider);

  const base: ProviderType[] = useMount
    ? [ProviderType.Mount, ProviderType.LocalStorage]
    : defaultToRemote
      ? [ProviderType.Remote, ProviderType.LocalStorage]
      : [ProviderType.LocalStorage];

  const candidates: ProviderType[] =
    (last != null && last !== ProviderType.Filesystem)
      ? [last, ...base.filter((t) => t !== last)]
      : base;

  let provider: ContentProvider | null = null;
  for (const type of candidates) {
    if (type === ProviderType.Mount || type === ProviderType.Remote) {
      // Mount and Remote don't need availability checks at creation time
      provider = createProviderByType(type);
      break;
    }
    const p = createProviderByType(type);
    if (await p.isAvailable()) {
      provider = p;
      break;
    }
  }
  if (!provider) provider = createProviderByType(ProviderType.LocalStorage);

  setProvider(provider);

  try {
    treeStore.setTree(await provider.getTree());
  } catch (e) {
    console.warn("[content] failed to load tree, starting empty:", e);
    treeStore.setTree(createEmptyTreeIndex());
  }
}

/** Switch to a different provider type. Loads its tree. Never throws. */
export async function switchProvider(type: ProviderType): Promise<void> {
  const provider = createProviderByType(type);
  setProvider(provider);
  saveLastProvider(type);

  treeStore.setTree(createEmptyTreeIndex());

  try {
    treeStore.setTree(await provider.getTree());
  } catch (e) {
    console.warn("[content] failed to load tree from new provider:", e);
  }

  const pdi = getProviderDisplayInfo(type);
  appEvents.emit(AppEvent.ProviderChanged, { type, icon: pdi.icon, label: pdi.label });
}

export async function getAvailableProviders(): Promise<
  {
    type: ProviderType;
    description: string;
    available: boolean;
    reason?: string;
  }[]
> {
  const useMount = hasFunc(AppFunc.MountProvider);
  const remote = createProviderByType(ProviderType.Remote);
  const mount = createProviderByType(ProviderType.Mount);
  const fs = createProviderByType(ProviderType.Filesystem);
  const ls = createProviderByType(ProviderType.LocalStorage);

  const [remoteReachable, mountAvailable, fsOk, lsOk] = await Promise.all([
    connectionStore.probe(),
    mount.isAvailable(),
    fs.isAvailable(),
    ls.isAvailable(),
  ]);

  const entries: {
    type: ProviderType;
    description: string;
    available: boolean;
    reason?: string;
  }[] = [];

  // Mount is only available in GUI Desktop builds
  if (useMount) {
    entries.push({
      type: ProviderType.Mount,
      description: "Files served by the inb4doc GUI (app:// scheme)",
      available: mountAvailable,
    });
  }

  entries.push({
    type: ProviderType.Remote,
    description: "Files served from a backend server via HTTP API",
    available: remoteReachable,
    reason: remoteReachable ? undefined : "No content server detected",
  });

  entries.push({
    type: ProviderType.Filesystem,
    description: "Access local markdown files via the File System Access API (Chrome/Edge)",
    available: fsOk,
    reason: fsOk ? undefined : "Not supported in this browser (use Chrome or Edge)",
  });

  entries.push({
    type: ProviderType.LocalStorage,
    description: "Store files in browser local storage — persists across sessions",
    available: lsOk,
  });

  return entries;
}

export function cacheKeyForProvider(type: ProviderType): string {
  return String(type);
}

export function getProviderDisplayInfo(type: ProviderType): {
  icon: string;
  label: string;
  type: ProviderType;
} {
  const map: Record<ProviderType, { icon: string; label: string; type: ProviderType }> = {
    [ProviderType.Remote]: { icon: "☁️", label: "Server (Remote)", type: ProviderType.Remote },
    [ProviderType.Mount]: { icon: "📦", label: "Mounted (GUI)", type: ProviderType.Mount },
    [ProviderType.Filesystem]: { icon: "💻", label: "Local Files", type: ProviderType.Filesystem },
    [ProviderType.LocalStorage]: { icon: "🗄️", label: "Browser Storage", type: ProviderType.LocalStorage },
  };
  return map[type] ?? { icon: "❓", label: String(type), type };
}
