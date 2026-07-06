import { diffLines } from "diff";
import { pressTwiceButton } from "@/components/ui/press-twice-button";

export type ExternalChangeAction = "discard" | "keep";

// ── Styles ──

const STYLES = `
#predoc-external-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4);
  z-index: 1000; display: flex; align-items: center; justify-content: center;
}
.predoc-external-window {
  background: var(--color-bg-primary); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.2);
  display: flex; flex-direction: column; max-height: 80vh;
  min-width: 420px; max-width: 560px;
}
.predoc-external-header {
  padding: 1rem 1.5rem 0; font-size: 1.1rem; font-weight: 600; flex-shrink: 0;
  color: var(--color-text-primary);
}
.predoc-external-body {
  padding: 0.5rem 1.5rem; overflow-y: auto; flex: 1;
  color: var(--color-text-primary);
}
.predoc-external-footer {
  display: flex; gap: 0.5rem; justify-content: flex-end;
  padding: 0.75rem 1.5rem 1rem; flex-shrink: 0;
}
.predoc-external-message {
  margin: 0 0 0.75rem; color: var(--color-text-secondary); font-size: 0.9rem; line-height: 1.5;
}
.predoc-external-message strong { color: var(--color-text-primary); }
.predoc-external-toggle {
  display: block; width: 100%; padding: 0.4rem; margin-bottom: 0.5rem;
  border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-bg-secondary);
  cursor: pointer; font-size: 0.85rem; color: var(--color-text-primary);
}
.predoc-external-toggle:hover { background: var(--color-bg-tertiary); }
.predoc-external-diff {
  border: 1px solid var(--color-border); border-radius: 4px;
  margin-bottom: 0.5rem; max-height: 300px; overflow-y: auto;
}
.predoc-external-diff-line {
  padding: 2px 8px; white-space: pre-wrap; font-family: monospace; font-size: 0.75rem;
}
`;

// ── Helpers ──

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

interface DiffLine {
  type: "same" | "added" | "removed";
  text: string;
}

function computeDiff(local: string, disk: string): DiffLine[] {
  const lineDiff = diffLines(local, disk);
  const result: DiffLine[] = [];
  for (const part of lineDiff) {
    const lines = part.value.split("\n");
    const type: "same" | "added" | "removed" =
      part.added ? "added" : part.removed ? "removed" : "same";
    for (let i = 0; i < lines.length - 1; i++) {
      result.push({ type, text: lines[i] });
    }
  }
  return result;
}

function renderDiffHtml(diffLines: DiffLine[]): string {
  const limited = diffLines.slice(0, 100);
  let html = "";
  for (const line of limited) {
    const bg = line.type === "added" ? "#d4edda" : line.type === "removed" ? "#f8d7da" : "#fafafa";
    const color = line.type === "added" ? "#155724" : line.type === "removed" ? "#721c24" : "#555";
    const prefix = line.type === "added" ? "+ " : line.type === "removed" ? "- " : "  ";
    html += `<div class="predoc-external-diff-line" style="background:${bg};color:${color}">${prefix}${escapeHtml(line.text)}</div>`;
  }
  if (diffLines.length > 100) {
    html += `<div style="padding:4px 8px;color:#888;font-style:italic;font-size:0.75rem">... and ${diffLines.length - 100} more lines</div>`;
  }
  if (diffLines.length === 0) {
    html = `<div style="padding:8px;color:#888;text-align:center;font-size:0.8rem">No differences</div>`;
  }
  return html;
}

// ── DOM builders ──

function buildOverlay(): HTMLDivElement {
  const existing = document.getElementById("predoc-external-overlay");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.id = "predoc-external-overlay";
  document.body.appendChild(el);
  return el;
}

function injectStyles(): void {
  if (document.getElementById("predoc-external-styles")) return;
  const style = document.createElement("style");
  style.id = "predoc-external-styles";
  style.textContent = STYLES;
  document.head.appendChild(style);
}

interface DialogElements {
  overlay: HTMLDivElement;
  body: HTMLElement;
  header: HTMLElement;
  footer: HTMLElement;
  toggleBtn: HTMLButtonElement;
  diffContainer: HTMLDivElement;
}

function buildDialog(path: string): DialogElements {
  const overlay = buildOverlay();

  const window = document.createElement("div");
  window.className = "predoc-external-window";

  const header = document.createElement("div");
  header.className = "predoc-external-header";
  header.textContent = "File changed on disk";

  const body = document.createElement("div");
  body.className = "predoc-external-body";

  const msg = document.createElement("p");
  msg.className = "predoc-external-message";
  msg.innerHTML = `<strong>${escapeHtml(path)}</strong> was updated externally. Your local changes will be lost if you discard.`;
  body.appendChild(msg);

  const toggleBtn = document.createElement("button");
  toggleBtn.className = "predoc-external-toggle";
  toggleBtn.textContent = "▸ View diff";
  body.appendChild(toggleBtn);

  const diffContainer = document.createElement("div");
  diffContainer.className = "predoc-external-diff";
  diffContainer.style.display = "none";
  body.appendChild(diffContainer);

  const footer = document.createElement("div");
  footer.className = "predoc-external-footer";
  footer.innerHTML = `<span id="external-discard-btn"></span><span id="external-keep-btn"></span>`;

  window.appendChild(header);
  window.appendChild(body);
  window.appendChild(footer);
  overlay.appendChild(window);

  return { overlay, body, header, footer, toggleBtn, diffContainer };
}

// ── Mount / entry point ──

export function mountExternalChangeDialog(
  path: string,
  localContent: string,
  diskContent: string,
): Promise<ExternalChangeAction> {
  injectStyles();

  const els = buildDialog(path);
  const diff = computeDiff(localContent, diskContent);

  let diffVisible = false;
  let resolved = false;

  return new Promise<ExternalChangeAction>((resolve) => {
    const finish = (action: ExternalChangeAction) => {
      if (resolved) return;
      resolved = true;
      els.overlay.remove();
      resolve(action);
    };

    els.toggleBtn.addEventListener("click", () => {
      diffVisible = !diffVisible;
      els.toggleBtn.textContent = diffVisible ? "▾ Hide diff" : "▸ View diff";
      els.diffContainer.style.display = diffVisible ? "block" : "none";
      if (diffVisible && !els.diffContainer.hasChildNodes()) {
        els.diffContainer.innerHTML = renderDiffHtml(diff);
      }
    });

    const discardBtn = pressTwiceButton({
      idleText: "Discard local",
      pendingText: "Press again",
      variant: "danger",
      onConfirm: () => finish("discard"),
    });
    document.getElementById("external-discard-btn")!.replaceWith(discardBtn);

    const keepBtn = pressTwiceButton({
      idleText: "Keep local",
      pendingText: "Press again",
      variant: "warning",
      onConfirm: () => finish("keep"),
    });
    document.getElementById("external-keep-btn")!.replaceWith(keepBtn);
  });
}
