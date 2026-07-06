export function cleanMarkdown(text: string): string {
  const result = text
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^```\w*\n?/gm, '')
    .replace(/\n?```$/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .trim();
  return result;
}

function getFirstTextNode(root: Node): Text | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  return walker.nextNode() ? (walker.currentNode as Text) : null;
}

function elementTextForMatch(el: Element): string {
  if (el instanceof HTMLPreElement && el.dataset.language) {
    return "```" + el.dataset.language + "\n" + (el.textContent || '');
  }
  return el.textContent || '';
}

export function findProseMirrorElement(text: string): Element | null {
  const pm = document.querySelector('.ProseMirror');
  if (!pm) {
    return null;
  }

  const cleaned = cleanMarkdown(text);
  if (!cleaned) {
    return null;
  }

  const walker = document.createTreeWalker(pm, NodeFilter.SHOW_ELEMENT, null);
  let best: Element | null = null;
  let candidates: { tag: string; len: number; text: string }[] = [];
  while (walker.nextNode()) {
    const el = walker.currentNode as Element;
    const content = elementTextForMatch(el);
    if (content.includes(cleaned)) {
      if (!best || content.length <= (best.textContent?.length || Infinity)) {
        best = el;
      }
      candidates.push({
        tag: el.tagName.toLowerCase() + (el instanceof HTMLPreElement ? "[lang=" + (el.dataset.language || '') + "]" : ''),
        len: content.length,
        text: JSON.stringify(content.slice(0, 80)),
      });
    }
  }
  return best;
}

export function findTextInElement(el: Element, query: string): { node: Text; offset: number } | null {
  const q = query.toLowerCase().trim();
  if (!q) return null;

  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const text = node.textContent || '';
    const lower = text.toLowerCase();
    let idx = 0;
    while (idx < lower.length) {
      idx = lower.indexOf(q, idx);
      if (idx >= 0) {
        return { node, offset: idx };
      }
      break;
    }
  }
  return null;
}

export function findTextInProseMirror(query: string, matchIndex?: number, snippetText?: string): { node: Text; offset: number } | null {
  const q = query.toLowerCase().trim();
  if (!q) {
    return null;
  }

  const proseMirror = document.querySelector('.ProseMirror');
  if (!proseMirror) {
    return null;
  }


  if (snippetText) {
    const el = findProseMirrorElement(snippetText);
    if (el) {
      const inElement = findTextInElement(el, q);
      if (inElement) {
        return inElement;
      }
      const pre = el instanceof HTMLPreElement
        ? el
        : el.closest('pre[data-language]') as HTMLElement | null;
      if (pre) {
        const inAttr = findQueryInAttributes(pre, q);
        if (inAttr) {
          return inAttr;
        }
      }
      const first = getFirstTextNode(el);
      if (first) return { node: first, offset: 0 };
    } else {
    }
  } else {
  }

  const skip = matchIndex ?? 0;
  let skipCount = 0;

  const walker = document.createTreeWalker(proseMirror, NodeFilter.SHOW_TEXT, null);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const text = node.textContent || '';
    const lower = text.toLowerCase();
    let idx = 0;
    while (idx < lower.length) {
      idx = lower.indexOf(q, idx);
      if (idx < 0) break;
      if (skipCount === skip) {
        return { node, offset: idx };
      }
      skipCount++;
      idx += q.length;
    }
  }
  return null;
}

function findQueryInAttributes(el: Element, q: string): { node: Text; offset: number } | null {
  if (el instanceof HTMLPreElement && el.dataset.language) {
    const lang = el.dataset.language.toLowerCase();
    const idx = lang.indexOf(q);
    if (idx >= 0) {
      const first = getFirstTextNode(el);
      if (first) return { node: first, offset: 0 };
    }
  } else {
  }
  return null;
}
