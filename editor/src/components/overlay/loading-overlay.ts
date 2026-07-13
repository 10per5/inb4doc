/**
 * LoadingOverlay — the "phantom window" shown on first paint.
 *
 * The initial markup + styles are inlined in `static/index.html` so the
 * loader paints instantly, before the app bundle downloads. This module is
 * the canonical definition of that skeleton and the API used by the app to
 * show/hide it. `showLoadingOverlay()` can re-inject it (e.g. for a slow
 * re-fetch); `hideLoadingOverlay()` fades it out once the app is ready.
 */

const LOADER_ID = "initial-loader";
const LOADER_STYLE_ID = "initial-loader-style";

const SKELETON = `
  <div class="il-window">
    <img class="il-logo" src="inb4doc-256.png" alt="inb4doc" width="256" height="256" />
    <div class="il-titlebar">
      <span class="il-dot"></span>
      <span class="il-dot"></span>
      <span class="il-dot"></span>
      <img class="il-logo-sm" src="inb4doc-32.png" alt="inb4doc" width="18" height="18" />
      <span class="il-title">inb4doc</span>
    </div>
    <div class="il-body">
      <div class="il-sidebar">
        <span class="il-skel il-skel-line" style="width:80%"></span>
        <span class="il-skel il-skel-line" style="width:65%"></span>
        <span class="il-skel il-skel-line" style="width:90%"></span>
        <span class="il-skel il-skel-line" style="width:50%"></span>
        <span class="il-skel il-skel-line" style="width:72%"></span>
        <span class="il-skel il-skel-line" style="width:60%"></span>
      </div>
      <div class="il-content">
        <span class="il-skel il-skel-line il-title-line" style="width:55%"></span>
        <span class="il-skel il-skel-line" style="width:100%"></span>
        <span class="il-skel il-skel-line" style="width:96%"></span>
        <span class="il-skel il-skel-line" style="width:90%"></span>
        <span class="il-skel il-skel-line" style="width:82%"></span>
        <span class="il-skel il-skel-line" style="width:64%"></span>
        <span class="il-skel il-skel-line" style="width:48%"></span>
      </div>
      <div class="il-aside">
        <span class="il-skel il-skel-line" style="width:100%"></span>
        <span class="il-skel il-skel-line" style="width:100%"></span>
        <span class="il-skel il-skel-line" style="width:70%"></span>
      </div>
    </div>
  </div>
`;

const STYLE = `
  #${LOADER_ID} {
    position: fixed;
    inset: 0;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-bg-primary, #fff);
    transition: opacity 0.35s ease;
  }
  #${LOADER_ID}.is-hidden {
    opacity: 0;
    pointer-events: none;
  }
  .il-window {
    position: relative;
    width: min(1100px, 92vw);
    height: min(720px, 88vh);
    background: var(--color-bg-secondary, #f8f9fa);
    border: 1px solid var(--color-border, #d8dee9);
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(46, 52, 64, 0.15);
    display: flex;
    flex-direction: column;
  }
  .il-titlebar {
    height: 38px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 14px;
    background: var(--color-bg-tertiary, #e5e9f0);
    border-bottom: 1px solid var(--color-border, #d8dee9);
  }
  .il-dot {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: #cdd5e3;
  }
  .il-title {
    margin-left: 8px;
    font-size: 0.8rem;
    font-weight: 600;
    letter-spacing: 0.3px;
    color: var(--color-text-secondary, #4c566a);
  }
  .il-logo {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 96px;
    height: 96px;
    border-radius: 16px;
    user-select: none;
    pointer-events: none;
    box-shadow: 0 10px 30px rgba(46, 52, 64, 0.18);
    animation: il-logo-pulse 1.6s ease-in-out infinite;
  }
  .il-logo-sm {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    flex: 0 0 auto;
    user-select: none;
  }
  @keyframes il-logo-pulse {
    0%, 100% { transform: translate(-50%, -50%) scale(1);   opacity: 1; }
    50%      { transform: translate(-50%, -50%) scale(1.08); opacity: 0.85; }
  }
  .il-body {
    flex: 1;
    display: flex;
    gap: 16px;
    padding: 18px;
  }
  .il-sidebar {
    width: 200px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .il-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .il-aside {
    width: 220px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .il-skel {
    display: block;
    height: 14px;
    border-radius: 6px;
    background: linear-gradient(
      90deg,
      #e5e9f0 25%,
      #eef1f6 37%,
      #e5e9f0 63%
    );
    background-size: 400% 100%;
    animation: il-shimmer 1.4s ease infinite;
  }
  .il-title-line {
    height: 22px;
  }
  @keyframes il-shimmer {
    0% { background-position: 100% 0; }
    100% { background-position: -100% 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .il-skel { animation: none; }
    .il-logo { animation: none; }
  }
`;

export function showLoadingOverlay(): void {
  if (document.getElementById(LOADER_ID)) return;

  if (!document.getElementById(LOADER_STYLE_ID)) {
    const style = document.createElement("style");
    style.id = LOADER_STYLE_ID;
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  const el = document.createElement("div");
  el.id = LOADER_ID;
  el.className = "initial-loader";
  el.innerHTML = SKELETON;
  document.body.appendChild(el);
}

export function hideLoadingOverlay(): void {
  const el = document.getElementById(LOADER_ID);
  if (!el) return;

  el.classList.add("is-hidden");
  const remove = () => el.remove();
  el.addEventListener("transitionend", remove, { once: true });
  setTimeout(remove, 600);
}
