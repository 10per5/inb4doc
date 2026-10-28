import { describe, expect, test } from "bun:test";
import { doc, parse, paragraph, roundtrip, schema, serialize } from "../helpers/markdown";
import { prefsStore } from "@/stores/preferences-store";
import type { Node as ProseNode } from "prosemirror-model";

/**
 * Serializer unit tests for "dynamic" / app-specific nodes.
 *
 * These build documents directly from the schema (rather than parsing markdown)
 * so the expected serialization is unambiguous. Every serialized result is then
 * checked for round-trip stability, so we know a save/reload/save cycle is
 * lossless.
 */

const node = (name: string, attrs: any = null, content: ProseNode[] = []) =>
  schema.node(name, attrs, content);
const text = (value: string, marks: readonly any[] = []) =>
  schema.text(value, marks as any);
const para = (...kids: ProseNode[]) => node("paragraph", null, kids);
const mark = (name: string, attrs: any = null) => schema.marks[name].create(attrs);

const expectSerializes = (d: ProseNode, expected: string) => {
  const md = serialize(d);
  expect(md).toBe(expected);
  // The output must be a fixed point.
  expect(roundtrip(roundtrip(md))).toBe(roundtrip(md));
};

describe("alerts", () => {
  test("warning alert", () => {
    expectSerializes(
      doc(node("alert", { type: "warning" }, [para(text("Careful now."))])),
      "> [!WARNING] Careful now.",
    );
  });

  test("note alert with inline formatting", () => {
    expectSerializes(
      doc(
        node("alert", { type: "note" }, [
          para(text("A "), text("bold", [mark("bold")]), text(" note.")),
        ]),
      ),
      "> [!NOTE] A **bold** note.",
    );
  });
});

describe("media nodes", () => {
  test("video", () => {
    expectSerializes(
      doc(
        node("video", {
          src: "https://example.com/v.mp4",
          controls: true,
        }),
      ),
      '<video controls src="https://example.com/v.mp4"></video>',
    );
  });

  test("video with dimensions preserves attribute order", () => {
    expectSerializes(
      doc(
        node("video", {
          src: "https://example.com/v.mp4",
          controls: true,
          width: "640",
          height: "360",
        }),
      ),
      '<video width="640" height="360" controls src="https://example.com/v.mp4"></video>',
    );
  });

  test("image-block with ratio and dimensions", () => {
    expectSerializes(
      doc(
        node("image-block", {
          src: "https://example.com/a.png",
          caption: "A caption",
          ratio: 1.5,
          w: 100,
          h: 50,
        }),
      ),
      '![1.50;w=100;h=50](https://example.com/a.png "A caption")',
    );
  });

  test("image-block without caption", () => {
    expectSerializes(
      doc(node("image-block", { src: "https://example.com/a.png", ratio: 1, w: 0, h: 0 })),
      "![1.00](https://example.com/a.png)",
    );
  });

  test("inline image", () => {
    expectSerializes(
      doc(para(node("image", { src: "https://x/y.png", alt: "alt", title: "" }))),
      "![alt](https://x/y.png)",
    );
  });
});

describe("Hugo / raw HTML", () => {
  test("divCenter", () => {
    expectSerializes(
      doc(node("divCenter", null, [para(text("centered"))])),
      '<div align="center">\ncentered\n\n</div>',
    );
  });

  test("details", () => {
    expectSerializes(
      doc(
        node("details", { title: "More", open: false }, [para(text("hidden"))]),
      ),
      "<details>\n<summary>More</summary>\n\nhidden\n\n</details>",
    );
  });

  test("details open", () => {
    expectSerializes(
      doc(
        node("details", { title: "More", open: true }, [para(text("shown"))]),
      ),
      "<details open>\n<summary>More</summary>\n\nshown\n\n</details>",
    );
  });

  test("details without a summary keeps no <summary> line", () => {
    expectSerializes(
      doc(node("details", { title: "", open: false }, [para(text("body"))])),
      "<details>\nbody\n\n</details>",
    );
  });

  test("hugoRef", () => {
    expectSerializes(
      doc(
        para(
          text("See "),
          node("hugoRef", { path: "/docs/roadmap", title: "Roadmap" }),
          text(" now."),
        ),
      ),
      'See [Roadmap](<{{% ref path="/docs/roadmap" %}}>) now.',
    );
  });

  test("raw inline html", () => {
    expectSerializes(
      doc(para(node("html", { value: '<span class="x">hi</span>' }))),
      '<span class="x">hi</span>',
    );
  });
});

describe("markdown compat (legacy dialect)", () => {
  // The serializer reads the flags live, so flipping them for one assertion is
  // enough — but restore them, the store is shared by the whole test process.
  const withPrefs = (patch: Partial<Record<"compatGithubAlerts" | "compatRawHtml", boolean>>, fn: () => void) => {
    const before = {
      alerts: prefsStore.compatGithubAlerts,
      rawHtml: prefsStore.compatRawHtml,
    };
    prefsStore.setCompatGithubAlerts(patch.compatGithubAlerts ?? before.alerts);
    prefsStore.setCompatRawHtml(patch.compatRawHtml ?? before.rawHtml);
    try {
      fn();
    } finally {
      prefsStore.setCompatGithubAlerts(before.alerts);
      prefsStore.setCompatRawHtml(before.rawHtml);
    }
  };

  test("alerts drop the GitHub callout marker", () => {
    withPrefs({ compatGithubAlerts: false }, () => {
      expectSerializes(
        doc(node("alert", { type: "warning" }, [para(text("Careful now."))])),
        "> Careful now.",
      );
    });
  });

  test("details become the Hugo Book shortcode", () => {
    withPrefs({ compatRawHtml: false }, () => {
      expectSerializes(
        doc(
          node("details", { title: "More", open: true }, [para(text("hidden"))]),
        ),
        '{{% details title="More" open=true %}}\n\nhidden\n\n{{% /details %}}',
      );
    });
  });

  test("a shortcoded details block still loads as one node", () => {
    const d = parse('{{% details title="T" %}}\n\nbody\n\n{{% /details %}}');
    expect(d.firstChild?.type.name).toBe("details");
    expect(d.firstChild?.attrs.title).toBe("T");
  });

  test("divCenter keeps only its content", () => {
    withPrefs({ compatRawHtml: false }, () => {
      expectSerializes(
        doc(node("divCenter", null, [para(text("centered"))])),
        "centered",
      );
    });
  });
});

describe("math", () => {
  test("math block", () => {
    expectSerializes(
      doc(node("mathBlock", { language: "tex" }, [text("E = mc^2")])),
      "$$\nE = mc^2\n$$",
    );
  });

  test("inline math", () => {
    expectSerializes(
      doc(para(text("a "), node("mathInline", { language: "tex" }, [text("x^2")]), text(" b"))),
      "a $x^2$ b",
    );
  });
});

describe("core blocks & marks", () => {
  test("heading", () => {
    expectSerializes(doc(node("heading", { level: 3, id: "" }, [text("Title")])), "### Title");
  });

  test("blockquote", () => {
    expectSerializes(doc(node("blockquote", null, [para(text("quoted"))])), "> quoted");
  });

  test("horizontal rule", () => {
    expectSerializes(doc(node("horizontalRule")), "---");
  });

  test("hard break", () => {
    expectSerializes(doc(para(text("a"), node("hardBreak"), text("b"))), "a\\\nb");
  });

  test("code block with language", () => {
    expectSerializes(
      doc(node("codeBlock", { language: "js" }, [text("const x = 1;")])),
      "```js\nconst x = 1;\n```",
    );
  });

  test("code block without language", () => {
    expectSerializes(
      doc(node("codeBlock", { language: "" }, [text("plain")])),
      "```\nplain\n```",
    );
  });

  test("inline marks", () => {
    expectSerializes(
      doc(
        para(
          text("a "),
          text("bold", [mark("bold")]),
          text(" "),
          text("it", [mark("italic")]),
          text(" "),
          text("s", [mark("strike")]),
          text(" "),
          text("x", [mark("code")]),
        ),
      ),
      "a **bold** *it* ~~s~~ `x`",
    );
  });

  test("link", () => {
    expectSerializes(
      doc(para(text("see "), text("here", [mark("link", { href: "https://example.com", title: null })]))),
      "see [here](https://example.com)",
    );
  });

  test("table", () => {
    const header = node("tableRow", null, [
      node("tableHeaderCell", null, [para(text("A"))]),
      node("tableHeaderCell", null, [para(text("B"))]),
    ]);
    const row = node("tableRow", null, [
      node("tableCell", null, [para(text("1"))]),
      node("tableCell", null, [para(text("2"))]),
    ]);
    expectSerializes(doc(node("table", null, [header, row])), "| A | B |\n| --- | --- |\n| 1 | 2 |");
  });
});

describe("lists", () => {
  test("bullet list item", () => {
    expectSerializes(doc(node("list", { kind: "bullet" }, [para(text("one"))])), "* one");
  });

  test("checked task item", () => {
    expectSerializes(
      doc(node("list", { kind: "task", checked: true }, [para(text("done"))])),
      "- [x] done",
    );
  });

  test("unchecked task item", () => {
    expectSerializes(
      doc(node("list", { kind: "task", checked: false }, [para(text("todo"))])),
      "- [ ] todo",
    );
  });

  test("ordered list item", () => {
    expectSerializes(
      doc(node("list", { kind: "ordered", order: 1 }, [para(text("first"))])),
      "1. first",
    );
  });
});
