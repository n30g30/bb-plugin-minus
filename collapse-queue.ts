// bb opens a queue expanded and re-expands it on its own (e.g. when an enqueued message's
// temporary id is replaced by the server's), so keep collapsing it until the user expands it.
const TOGGLE = 'button[aria-label="Toggle queued messages"]';
const COLLAPSE = 'button[aria-label="Collapse queued messages"]';

export function mountQueueCollapse(): () => void {
  const userExpanded = new WeakSet<Element>();

  // Only trusted clicks are the user's; the plugin's own clicks are synthetic.
  const onClick = (event: MouseEvent) => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const toggle = event.target.closest(TOGGLE);
    if (toggle !== null) {
      if (toggle.getAttribute("aria-expanded") === "false") userExpanded.add(toggle);
      else userExpanded.delete(toggle);
      return;
    }
    if (event.target.closest(COLLAPSE) !== null)
      for (const t of document.querySelectorAll(TOGGLE)) userExpanded.delete(t);
  };

  const pass = () => {
    for (const toggle of document.querySelectorAll<HTMLButtonElement>(TOGGLE))
      if (toggle.getAttribute("aria-expanded") === "true" && !userExpanded.has(toggle)) toggle.click();
  };

  document.addEventListener("click", onClick, true);
  const observer = new MutationObserver(pass);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-expanded"] });
  pass();
  return () => {
    observer.disconnect();
    document.removeEventListener("click", onClick, true);
  };
}
