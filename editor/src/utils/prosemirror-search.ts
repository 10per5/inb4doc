function _debug(...args: any[]) {
  console.log("[pm-search]", ...args);
}

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
  _debug("cleanMarkdown", JSON.stringify(text), "→", JSON.stringify(result));
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
    _debug("findProseMirrorElement: no .ProseMirror element");
    return null;
  }

  const cleaned = cleanMarkdown(text);
  if (!cleaned) {
    _debug("findProseMirrorElement: cleaned text empty");
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
  _debug("findProseMirrorElement candidates:", candidates);
  _debug("findProseMirrorElement best:", best ? best.tagName.toLowerCase() + (best instanceof HTMLPreElement ? "[lang=" + (best.dataset.language || '') + "]" : '') : null);
  return best;
}

export function findTextInElement(el: Element, query: string): { node: Text; offset: number } | null {
  const q = query.toLowerCase().trim();
  if (!q) return null;

  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  let textNodes = 0;
  while (walker.nextNode()) {
    textNodes++;
    const node = walker.currentNode as Text;
    const text = node.textContent || '';
    const lower = text.toLowerCase();
    let idx = 0;
    while (idx < lower.length) {
      idx = lower.indexOf(q, idx);
      if (idx >= 0) {
        _debug("findTextInElement found", JSON.stringify(q), "at offset", idx, "in text node, parent:", node.parentElement?.tagName);
        return { node, offset: idx };
      }
      break;
    }
  }
  _debug("findTextInElement: query", JSON.stringify(q), "NOT found in element", el.tagName, "with", textNodes, "text nodes");
  return null;
}

export function findTextInProseMirror(query: string, matchIndex?: number, snippetText?: string): { node: Text; offset: number } | null {
  const q = query.toLowerCase().trim();
  if (!q) {
    _debug("findTextInProseMirror: empty query after trim");
    return null;
  }

  const proseMirror = document.querySelector('.ProseMirror');
  if (!proseMirror) {
    _debug("findTextInProseMirror: no .ProseMirror");
    return null;
  }

  _debug("findTextInProseMirror entry:", { query: JSON.stringify(q), matchIndex, snippetText: JSON.stringify(snippetText) });

  if (snippetText) {
    _debug("findTextInProseMirror: trying element path with snippetText");
    const el = findProseMirrorElement(snippetText);
    _debug("findTextInProseMirror: findProseMirrorElement returned", el ? el.tagName.toLowerCase() + " (textContent starts with: " + JSON.stringify((el.textContent || '').slice(0, 60)) + ")" : null);
    if (el) {
      const inElement = findTextInElement(el, q);
      if (inElement) {
        _debug("findTextInProseMirror: matched via findTextInElement");
        return inElement;
      }
      _debug("findTextInProseMirror: findTextInElement failed, trying pre ancestor");
      const pre = el instanceof HTMLPreElement
        ? el
        : el.closest('pre[data-language]') as HTMLElement | null;
      _debug("findTextInProseMirror: pre ancestor:", pre ? pre.tagName.toLowerCase() + "[lang=" + (pre.dataset.language || '') + "]" : null);
      if (pre) {
        const inAttr = findQueryInAttributes(pre, q);
        if (inAttr) {
          _debug("findTextInProseMirror: matched via findQueryInAttributes on pre");
          return inAttr;
        }
        _debug("findTextInProseMirror: findQueryInAttributes returned null");
      }
      const first = getFirstTextNode(el);
      _debug("findTextInProseMirror: falling back to getFirstTextNode", first ? "found" : "null");
      if (first) return { node: first, offset: 0 };
    } else {
      _debug("findTextInProseMirror: findProseMirrorElement returned null, falling to global");
    }
  } else {
    _debug("findTextInProseMirror: no snippetText, using global TreeWalker");
  }

  const skip = matchIndex ?? 0;
  _debug("findTextInProseMirror: global TreeWalker skip=", skip);
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
      _debug("findTextInProseMirror: global match", skipCount, "at offset", idx, "in text:", JSON.stringify(text.slice(Math.max(0, idx - 5), idx + q.length + 5)));
      if (skipCount === skip) {
        _debug("findTextInProseMirror: global returning match at skip", skip);
        return { node, offset: idx };
      }
      skipCount++;
      idx += q.length;
    }
  }
  _debug("findTextInProseMirror: no match found in global walk either");
  return null;
}

function findQueryInAttributes(el: Element, q: string): { node: Text; offset: number } | null {
  if (el instanceof HTMLPreElement && el.dataset.language) {
    const lang = el.dataset.language.toLowerCase();
    const idx = lang.indexOf(q);
    _debug("findQueryInAttributes: pre lang=", JSON.stringify(lang), "q=", JSON.stringify(q), "idx=", idx);
    if (idx >= 0) {
      const first = getFirstTextNode(el);
      _debug("findQueryInAttributes: matched, getFirstTextNode", first ? "found" : "null");
      if (first) return { node: first, offset: 0 };
    }
  } else {
    _debug("findQueryInAttributes: el is not HTMLPreElement, tag=", el.tagName);
  }
  return null;
}
