import type { ContentProvider } from "@/providers/provider";
import type { ProviderType } from "@/providers/index";
import { createProviderByType } from "@/providers/index";
import { RemoteProvider } from "@/providers/remote-provider";
import { connectionStore } from "@/stores/connection-store";
import { treeStore } from "@/stores/tree-store";
import { appEvents, AppEvent } from "@/stores/app-events";

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
  try { localStorage.setItem(LAST_PROVIDER_KEY, type) } catch {}
}

function loadLastProvider(): ProviderType | null {
  try {
    const v = localStorage.getItem(LAST_PROVIDER_KEY);
    if (v === "remote" || v === "filesystem" || v === "localStorage") return v;
  } catch {}
  return null;
}

/**
 * Initialize the provider: try last-used, then auto-detect, fall back to browser storage.
 * Loads the tree — on failure starts empty. Never throws.
 */
export async function initializeProvider(): Promise<void> {
  const last = loadLastProvider();
  const candidates: ProviderType[] = last
    ? [last, ...(["remote", "filesystem", "localStorage"] as ProviderType[]).filter((t) => t !== last)]
    : ["remote", "filesystem", "localStorage"];

  let provider: ContentProvider | null = null;
  for (const type of candidates) {
    const p = createProviderByType(type);
    if (await p.isAvailable()) {
      provider = p;
      break;
    }
  }
  if (!provider) provider = createProviderByType("localStorage");

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
  const remote = createProviderByType("remote") as RemoteProvider;
  const fs = createProviderByType("filesystem");
  const ls = createProviderByType("localStorage");

  const [remoteReachable, fsOk, lsOk] = await Promise.all([
    connectionStore.probe(),
    fs.isAvailable(),
    ls.isAvailable(),
  ]);
  const remoteFallback = remote.appFallback;
  const guiFallback = !remoteReachable && !remoteFallback && connectionStore.isInsideAppGui();

  return [
    {
      type: "remote",
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
      type: "filesystem",
      description: "Access local markdown files via the File System Access API (Chrome/Edge)",
      available: fsOk,
      reason: fsOk ? undefined : "Not supported in this browser (use Chrome or Edge)",
    },
    {
      type: "localStorage",
      description: "Store files in browser local storage — persists across sessions",
      available: lsOk,
    },
  ];
}

export function cacheKeyForProvider(name: string): string {
  const map: Record<string, string> = {
    remote: "remote",
    fs: "filesystem",
    localStorage: "localStorage",
  };
  return map[name] || name;
}

export function getProviderDisplayInfo(name: string): {
  icon: string;
  label: string;
  type: ProviderType;
} {
  const map: Record<string, { icon: string; label: string; type: ProviderType }> = {
    remote: { icon: "☁️", label: "Server (Remote)", type: "remote" },
    fs: { icon: "💻", label: "Local Files", type: "filesystem" },
    localStorage: { icon: "🗄️", label: "Browser Storage", type: "localStorage" },
  };
  return map[name] || { icon: "❓", label: name, type: name as ProviderType };
}
