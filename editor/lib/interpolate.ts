export function interpolateHtml(html: string): string {
  const LIVE_URL_BASE = process.env.LIVE_URL_BASE || "";
  const SELF_BASE = (process.env.EDITOR_SELF_BASE || "").replace(/\/+$/, "");
  const baseHref = SELF_BASE ? `${SELF_BASE}/` : "/";
  let out = html.includes("<base ")
    ? html
    : html.replace("</title>", `</title>\n    <base href="${baseHref}">`);
  out = out.replaceAll("__EDITOR_SELF_BASE__", SELF_BASE);
  out = out.replaceAll("__LIVE_URL_BASE__", LIVE_URL_BASE);
  out = out.replaceAll("__SSG_MODE__", process.env.SSG_MODE || "");
  out = out.replaceAll("__APP_VERSION__", process.env.APP_VERSION || "");
  return out;
}
