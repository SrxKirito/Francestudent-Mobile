export function viewportGeometry(layoutHeight: number, viewportHeight: number, offsetTop: number, restHeight: number, editable: boolean) {
  const height = Math.max(1, Math.min(layoutHeight, viewportHeight));
  return {
    height: Math.round(height),
    top: Math.round(Math.max(0, offsetTop)),
    keyboard: editable && restHeight - height > 80
  };
}

/** Une seule hauteur visible pour la coque et ses dialogues. WKWebView gère le clavier lui-même. */
export function installMobileViewport(): () => void {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const viewport = window.visualViewport;
  if (!ios || !viewport) return () => {};
  const root = document.documentElement;
  let width = 0;
  let restHeight = 0;
  let wasKeyboardOpen = false;
  let frame = 0;
  const update = () => {
    frame = 0;
    const editable = Boolean(document.activeElement?.matches("textarea, input:not([type=button]):not([type=checkbox]):not([type=radio]), [contenteditable=true]"));
    if (width !== window.innerWidth) {
      width = window.innerWidth;
      restHeight = window.innerHeight;
    }
    if (!editable && !wasKeyboardOpen) restHeight = Math.max(window.innerHeight, viewport.height);
    const geometry = viewportGeometry(window.innerHeight, viewport.height, viewport.offsetTop, restHeight, editable || wasKeyboardOpen);
    wasKeyboardOpen = geometry.keyboard;
    root.style.setProperty("--ios-viewport-height", geometry.height + "px");
    root.style.setProperty("--ios-viewport-top", geometry.top + "px");
    root.classList.toggle("ios-keyboard-open", geometry.keyboard);
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  root.classList.add("ios-viewport");
  viewport.addEventListener("resize", schedule);
  viewport.addEventListener("scroll", schedule);
  window.addEventListener("resize", schedule);
  document.addEventListener("focusin", schedule);
  document.addEventListener("focusout", schedule);
  update();
  return () => {
    if (frame) cancelAnimationFrame(frame);
    viewport.removeEventListener("resize", schedule);
    viewport.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    document.removeEventListener("focusin", schedule);
    document.removeEventListener("focusout", schedule);
    root.classList.remove("ios-viewport", "ios-keyboard-open");
    root.style.removeProperty("--ios-viewport-height");
    root.style.removeProperty("--ios-viewport-top");
  };
}
