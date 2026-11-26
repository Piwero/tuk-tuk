// Run in agent-browser eval --stdin on /lists/1 (Task detail open), then /assistant.
// Layout seam: no sideways scrolling on either host at 195x422 DPR 2.
(() => {
  const host =
    document.querySelector("aside.task-detail") ||
    document.querySelector("main");
  const rect = host.getBoundingClientRect();
  const limit = rect.left + host.clientWidth;
  const composer = document.querySelector(".assistant-composer");
  const controls = composer
    ? [...composer.querySelectorAll("input,button")]
    : [];
  const result = {
    viewport: [innerWidth, innerHeight],
    host: host.tagName,
    scrollWidth: host.scrollWidth,
    clientWidth: host.clientWidth,
    controls: controls.map((el) => ({
      name: el.getAttribute("aria-label") || el.textContent,
      right: el.getBoundingClientRect().right,
    })),
  };
  if (
    host.scrollWidth > host.clientWidth + 1 ||
    controls.some((el) => el.getBoundingClientRect().right > limit + 1)
  ) {
    throw new Error(JSON.stringify(result));
  }
  return result;
})();
