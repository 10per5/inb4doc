import { Page, type PageData } from "@/entities/Page";

const STORAGE_KEY = "inb4doc-storage";
const pages = new Map<string, Page>();

function get(path: string): Page | undefined {
  return pages.get(path);
}

function getOrCreate(path: string): Page {
  let page = pages.get(path);
  if (!page) {
    page = new Page(path);
    pages.set(path, page);
  }
  return page;
}

function clearPath(path: string): void {
  pages.delete(path);
}

function clearAll(): void {
  pages.clear();
}

function getDirtyPaths(): string[] {
  return [...pages.values()].filter((p) => p.meta.dirty).map((p) => p.path);
}

function save(key?: string): void {
  const data: Record<string, PageData> = {};
  for (const [path, page] of pages) {
    data[path] = page.encode();
  }
  localStorage.setItem(key ? `inb4doc-cache-${key}` : STORAGE_KEY, JSON.stringify(data));
}

function load(key?: string): void {
  clearAll();
  try {
    const raw = localStorage.getItem(key ? `inb4doc-cache-${key}` : STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    for (const [path, pageData] of Object.entries(data)) {
      pages.set(path, Page.decode(path, pageData as PageData));
    }
  } catch {}
}

export const pageRepository = {
  get, getOrCreate, clearPath, clearAll, getDirtyPaths,
  save, load,
};

load();
