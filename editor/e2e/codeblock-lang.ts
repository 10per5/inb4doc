/**
 * e2e/codeblock-lang.ts — diagnose why the code-block language picker
 * cannot be focused / used to pick a different language.
 *
 * Creates a fenced code block by typing, then probes:
 *   - hit-testing (elementFromPoint) over the picker input and items
 *   - focus behavior after a real click on the input
 *   - dropdown visibility, item click, and whether the attribute applies
 *     (LaTeX selection flips .latex on the wrapper = strong end-to-end signal)
 */
import { chromium } from "./launch";
import { EditorSession } from "./session";

const browser = await chromium.launch();
const session = await EditorSession.open(browser, "getting-started", {
  waitFor: ".ProseMirror",
});
const page = session.page;

// Create a code block: click into the first paragraph, go to end, type fence.
await page.locator(".ProseMirror > *").first().click();
await page.keyboard.press("End");
await page.keyboard.press("Enter");
await page.keyboard.type("```js ");
await page.keyboard.type("const x = 1\n");
await page.waitForTimeout(500);

const report = await page.evaluate(() => {
  const out: Record<string, unknown> = {};
  const wrapper = document.querySelectorAll(".code-block-wrapper")[document.querySelectorAll(".code-block-wrapper").length-1];
  out.wrapperFound = !!wrapper;
  if (!wrapper) return out;
  const r = wrapper.getBoundingClientRect();
  out.wrapperRect = { w: Math.round(r.width), h: Math.round(r.height) };

  const input = wrapper.querySelector<HTMLInputElement>(".code-block-lang-input")!;
  const overlay = wrapper.querySelector<HTMLElement>(".code-block-overlay")!;
  const ir = input.getBoundingClientRect();
  const cx = ir.left + ir.width / 2;
  const cy = ir.top + ir.height / 2;
  out.inputRect = {
    top: Math.round(ir.top),
    left: Math.round(ir.left),
    w: Math.round(ir.width),
    h: Math.round(ir.height),
  };
  // Is the wrapper under the cursor when hovering the input coords?
  const hitInput = document.elementFromPoint(cx, cy);
  out.hitAtInput = hitInput ? hitInput.className.toString().slice(0, 60) : null;
  out.inputInsideHit = hitInput === input || input.contains(hitInput);

  const csO = getComputedStyle(overlay);
  const csI = getComputedStyle(input);
  out.overlayStyle = {
    opacity: csO.opacity,
    pe: csO.pointerEvents,
    ce: csO.contentEditable,
    display: csO.display,
  };
  out.inputStyle = {
    pe: csI.pointerEvents,
    ce: csI.contentEditable,
    readOnly: input.readOnly,
    disabled: input.disabled,
  };
  // Walk up from the input: which ancestor sets contenteditable?
  const chain: Array<{ cls: string; ce: string }> = [];
  let n: HTMLElement | null = input;
  while (n && n !== document.body) {
    chain.push({
      cls: (n.className || n.tagName).toString().slice(0, 40),
      ce: n.getAttribute("contenteditable") ?? getComputedStyle(n).contentEditable,
    });
    n = n.parentElement;
  }
  out.ceChain = chain;
  return out;
});

console.log("STATIC:", JSON.stringify(report, null, 2));

// ---- Live interaction: real mouse events, scoped to OUR block ----
const ourWrapper = page.locator(".code-block-wrapper").last();
await ourWrapper.scrollIntoViewIfNeeded();
await ourWrapper.evaluate((el) => ((el as HTMLElement).dataset.tag = "ours"));

// Watch for node-view churn: snapshot wrapper identities for ~3s.
const churn = await page.evaluate(async () => {
  const snaps: string[] = [];
  for (let i = 0; i < 12; i++) {
    const ws = Array.from(document.querySelectorAll(".code-block-wrapper"));
    snaps.push(
      ws
        .map((w) => (w as HTMLElement).dataset.tag ?? "anon" + Math.floor(Math.random() * 1e6).toString(36))
        .join("|"),
    );
    await new Promise((r) => setTimeout(r, 250));
  }
  return snaps;
});
console.log("CHURN:", JSON.stringify(churn, null, 1));
const stableTag = await page.evaluate(() =>
  !!document.querySelector('.code-block-wrapper[data-tag="ours"]'),
);
if (!stableTag) {
  // Re-tag whatever survived and continue.
  await page.locator(".code-block-wrapper").last().evaluate(
    (el) => ((el as HTMLElement).dataset.tag = "ours"),
  );
}

const input = page.locator('.code-block-wrapper[data-tag="ours"] .code-block-lang-input');

// Park the real cursor over the input (triggers :hover chain), then probe.
await input.hover();
await page.waitForTimeout(200);
const hovered = await page.evaluate(() => {
  const w = document.querySelector('.code-block-wrapper[data-tag="ours"]')!;
  const inputEl = w.querySelector(".code-block-lang-input")!;
  const r = inputEl.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const cs = getComputedStyle(w.querySelector(".code-block-overlay")!);
  return {
    hitAtInputHovered: hit ? hit.className.toString().slice(0, 60) : null,
    overlayPE: cs.pointerEvents,
    overlayOpacity: cs.opacity,
  };
});
console.log("HOVERED:", JSON.stringify(hovered));

// Instrument + identity-tag the input, then a programmatic-focus control.
await input.evaluate((el) => {
  const log: string[] = [];
  (window as any).__evtLog = log;
  const rec = (tag: string) => (e: Event) =>
    log.push(
      tag + ":" + e.type +
        " prev=" + e.defaultPrevented +
        " active=" + (document.activeElement?.className || document.activeElement?.tagName),
    );
  for (const t of ["mousedown", "mouseup", "click", "focus", "blur"]) {
    el.addEventListener(t, rec("in"), true);
  }
  document.addEventListener("mousedown", rec("doc"), true);
  document.addEventListener(
    "focusout",
    (e) => (window as any).__evtLog.push("FO:" + (e.target as HTMLElement)?.className?.toString().slice(0, 40)),
    true,
  );
  el.dataset.inst = "A";
});
console.log("PROG_FOCUS:", JSON.stringify(await input.evaluate((el) => {
  el.focus();
  return document.activeElement === el ? "INPUT" : "other";
})));

await input.click();
await page.waitForTimeout(300);

const afterClick = await page.evaluate(() => {
  const w = document.querySelector('.code-block-wrapper[data-tag="ours"]')!;
  const input = w.querySelector<HTMLInputElement>(".code-block-lang-input")!;
  return {
    evtLog: (window as any).__evtLog,
    sameInstance: input.dataset.inst === "A",
    activeEl: document.activeElement === input
      ? "INPUT"
      : document.activeElement?.className?.toString().slice(0, 60) ?? null,
    listVisible: !!w.querySelector(".code-block-lang-list.visible"),
    wrappers: Array.from(document.querySelectorAll(".code-block-wrapper")).map(
      (el) => ({
        tag: (el as HTMLElement).dataset.tag ?? "-",
        latex: el.classList.contains("latex"),
      }),
    ),
  };
});
console.log("AFTER_CLICK:", JSON.stringify(afterClick, null, 2));

// If the dropdown opened, try picking LaTeX (flips .latex on the wrapper).
if (afterClick.listVisible) {
  const item = page.locator('.code-block-wrapper[data-tag="ours"] .code-block-lang-item[data-lang="LaTeX"]');
  await item.hover();
  await page.waitForTimeout(150);
  console.log("HIT_AT_ITEM:", await item.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit ? hit.className.toString().slice(0, 60) : null;
  }));
  await item.click();
  await page.waitForTimeout(400);

  const picked = await page.evaluate(() => {
    const w = document.querySelector('.code-block-wrapper[data-tag="ours"]')!;
    const input = w.querySelector<HTMLInputElement>(".code-block-lang-input")!;
    const preview = w.querySelector<HTMLElement>(".code-block-preview")!;
    return {
      inputValue: input.value,
      wrapperClasses: w.className,
      previewDisplay: preview.style.display,
      sameInstance: input.dataset.inst === "A",
      activeEl: document.activeElement?.className?.toString().slice(0, 60) ?? null,
    };
  });
  console.log("PICKED:", JSON.stringify(picked));
}

console.log("ERRORS:", session.errors);
await browser.close();
