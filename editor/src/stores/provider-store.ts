import type { ContentProvider } from "@/providers/provider";
import { ProviderType, createProviderByType } from "@/providers/index";
import { RemoteProvider } from "@/providers/remote-provider";
import { connectionStore } from "@/stores/connection-store";
import { treeStore } from "@/stores/tree-store";
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
 *   WebLocal / GuiDesktop  →  try remote first, fall back to localStorage
 *   All others             →  localStorage
 *
 * Filesystem is never auto-selected (requires user gesture for showDirectoryPicker).
 * Remote is tried directly without a probe — no silent network requests.
 * If getTree() fails the provider falls back to an empty tree; the user can
 * switch providers explicitly via the provider dialog.
 */
export async function initializeProvider(): Promise<void> {
  const last = loadLastProvider();

  const defaultToRemote = hasFunc(AppFunc.DefaultToRemote);
  const base: ProviderType[] = defaultToRemote
    ? [ProviderType.Remote, ProviderType.LocalStorage]
    : [ProviderType.LocalStorage];

  const host = connectionStore.getHost();
  const isLocalhostRemote = last === ProviderType.Remote &&
    ['localhost', '127.0.0.1', '0.0.0.0'].includes(host.toLowerCase());

  const candidates: ProviderType[] =
    (last != null && last !== ProviderType.Filesystem && !(isLocalhostRemote && !defaultToRemote))
      ? [last, ...base.filter((t) => t !== last)]
      : base;

  let provider: ContentProvider | null = null;
  for (const type of candidates) {
    if (type === ProviderType.Remote) {
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
    treeStore.setTree({});
  }
}

/** Switch to a different provider type. Loads its tree. Never throws. */
export async function switchProvider(type: ProviderType): Promise<void> {
  const provider = createProviderByType(type);
  setProvider(provider);
  saveLastProvider(type);

  treeStore.setTree({});

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
    appFallback?: boolean;
    guiFallback?: boolean;
    reason?: string;
  }[]
> {
  const remote = createProviderByType(ProviderType.Remote) as RemoteProvider;
  const fs = createProviderByType(ProviderType.Filesystem);
  const ls = createProviderByType(ProviderType.LocalStorage);

  const [remoteReachable, fsOk, lsOk] = await Promise.all([
    connectionStore.probe(),
    fs.isAvailable(),
    ls.isAvailable(),
  ]);
  const remoteFallback = remote.appFallback;
  const guiFallback = !remoteReachable && !remoteFallback && connectionStore.isInsideAppGui();

  return [
    {
      type: ProviderType.Remote,
      description: "Files served from a backend server via HTTP API",
      available: remoteReachable,
      appFallback: remoteFallback,
      guiFallback,
      reason: remoteReachable
        ? undefined
        : remoteFallback
          ? "inb4doc app://_/ endpoint is used"
          : guiFallback
            ? "ℹ️ inb4doc-gui local API is used"
            : "No content server detected",
    },
    {
      type: ProviderType.Filesystem,
      description: "Access local markdown files via the File System Access API (Chrome/Edge)",
      available: fsOk,
      reason: fsOk ? undefined : "Not supported in this browser (use Chrome or Edge)",
    },
    {
      type: ProviderType.LocalStorage,
      description: "Store files in browser local storage — persists across sessions",
      available: lsOk,
    },
  ];
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
    [ProviderType.Filesystem]: { icon: "💻", label: "Local Files", type: ProviderType.Filesystem },
    [ProviderType.LocalStorage]: { icon: "🗄️", label: "Browser Storage", type: ProviderType.LocalStorage },
  };
  return map[type] ?? { icon: "❓", label: String(type), type };
}
