// bb keeps the queue's expanded state in React and opens every new queue expanded.
// Click its toggle once per queue element; a manual re-expand is left alone.
const TOGGLE = 'button[aria-label="Toggle queued messages"]';

export function mountQueueCollapse(): () => void {
  const seen = new WeakSet<Element>();
  const pass = () => {
    for (const button of document.querySelectorAll<HTMLButtonElement>(TOGGLE)) {
      if (seen.has(button)) continue;
      seen.add(button);
      if (button.getAttribute("aria-expanded") === "true") button.click();
    }
  };
  const observer = new MutationObserver(pass);
  observer.observe(document.body, { childList: true, subtree: true });
  pass();
  return () => observer.disconnect();
}
