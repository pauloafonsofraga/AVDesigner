// Native lazy loading prefetches several screens beyond a scroll container.
// Catalogue artwork is requested only after its entry intersects the viewport.
export function observeLibraryArtwork(root = document) {
  const selector = "[data-library-src], [data-library-href]";
  const imagesIn = node => node.nodeType === 1
    ? [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)] : [];
  const visible = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const image = entry.target;
      const key = image.hasAttribute("data-library-src") ? "src" : "href";
      image.setAttribute(key, image.getAttribute(`data-library-${key}`));
      visible.unobserve(image);
    }
  });
  const changes = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.removedNodes) imagesIn(node).forEach(image => visible.unobserve(image));
      for (const node of record.addedNodes) imagesIn(node).forEach(image => visible.observe(image));
    }
  });
  root.querySelectorAll(selector).forEach(image => visible.observe(image));
  changes.observe(root, { subtree: true, childList: true });
  return () => { changes.disconnect(); visible.disconnect(); };
}
