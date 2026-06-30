export interface ContentSearchMatch {
  snippets: string[];
}

export function contentMatches(content: string, query: string): boolean {
  return content.toLowerCase().includes(query.toLowerCase().trim());
}

function extractTableCells(table: string, query: string): string[] {
  const q = query.toLowerCase();
  const rows = table.split("\n").filter(r => r.trim().startsWith("|") && !r.includes("---"));
  const results: string[] = [];

  for (let ri = 0; ri < rows.length; ri++) {
    const cells = rows[ri].split("|").slice(1, -1).map(c => c.trim());
    for (let ci = 0; ci < cells.length; ci++) {
      if (cells[ci].toLowerCase().includes(q)) {
        results.push(cells[ci]);
      }
    }
  }

  return results;
}

export function extractSnippets(content: string, query: string, maxSnippets = 3): string[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const paragraphs = content.split(/\n\s*\n/);
  const snippets: string[] = [];

  for (const para of paragraphs) {
    if (para.toLowerCase().includes(q)) {
      if (para.trim().startsWith("|")) {
        const cells = extractTableCells(para, q);
        snippets.push(...cells);
      } else {
        snippets.push(para.trim());
      }
      if (snippets.length >= maxSnippets) break;
    }
  }

  return snippets;
}
