/**
 * Shared Playwright bootstrap for standalone e2e scripts.
 *
 * Playwright reads PLAYWRIGHT_BROWSERS_PATH at module load time, so the
 * variable must be set before `@playwright/test` is imported — hence the
 * dynamic import. Pointing it at the project-local install
 * (node_modules/playwright-core/.local-browsers) means Chromium survives
 * wipes of ~/.cache/ms-playwright.
 */

import { createRequire } from "module";
import { join } from "path";

const require = createRequire(import.meta.url);
const pwcRoot = join(require.resolve("playwright-core/package.json"), "..");
process.env.PLAYWRIGHT_BROWSERS_PATH = join(pwcRoot, ".local-browsers");

const pw = await import("@playwright/test");

export const chromium = pw.chromium;
export default pw;
