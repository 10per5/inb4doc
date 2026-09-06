import { chromium } from "../e2e/launch";
import { EditorSession } from "../e2e/session";

const browser = await chromium.launch();
const session = await EditorSession.open(browser, "getting-started", {
  waitFor: ".ProseMirror",
});
const page = session.page;

// Find the live PM view and instrument its update pipeline.
const hooked = await page.evaluate(() => {
  // Constructor-style node views store the instance as desc.spec; ours
  // keep a .pmView reference. (The root .ProseMirror pmViewDesc walk
  // does NOT yield a .view — see e2e/README.md.)
  const wrapper = document.querySelector(".code-block-wrapper") as any;
  const spec = wrapper?.pmViewDesc?.spec;
  const view = spec?.pmView;
  if (!view) return { err: "no view", hasSpec: !!spec };

  const log: any[] = [];
  (window as any).__log = log;

  const origDispatch = view.dispatch.bind(view);
  let n = 0;
  view.dispatch = (tr: any) => {
    n++;
    if (log.length < 60)
      log.push({
        t: Math.round(performance.now()),
        docChanged: tr.docChanged,
        metaKeys: tr.meta ? Object.keys(tr.meta) : [],
        steps: tr.steps?.map((s: any) => s.constructor.name),
      });
    return origDispatch(tr);
  };
  (window as any).__dispatchCount = () => n;

  const origUpdateState = view.updateState.bind(view);
  let u = 0;
  view.updateState = (s: any) => {
    u++;
    if (log.length < 60)
      log.push({ t: Math.round(performance.now()), UPDATE_STATE: true });
    return origUpdateState(s);
  };
  (window as any).__updateStateCount = () => u;

  // Also record wrapper replacements precisely.
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const el of Array.from(m.removedNodes as any)) {
        if (el.classList?.contains("code-block-wrapper"))
          log.push({ t: Math.round(performance.now()), WRAPPER_REMOVED: true });
      }
      for (const el of Array.from(m.addedNodes as any)) {
        if (el.classList?.contains("code-block-wrapper"))
          log.push({ t: Math.round(performance.now()), WRAPPER_ADDED: true });
      }
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });

  return { ok: true, hasDispatchOverride: typeof view.dispatch === "function" };
});
console.log("HOOKED:", JSON.stringify(hooked));

await page.waitForTimeout(2500);

const result = await page.evaluate(() => ({
  dispatches: (window as any).__dispatchCount(),
  updateStates: (window as any).__updateStateCount(),
  log: (window as any).__log.slice(0, 80),
}));
console.log("DRIVER:", JSON.stringify(result, null, 1));
console.log("ERRORS:", session.errors);
await browser.close();
