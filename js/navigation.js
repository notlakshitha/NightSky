document.addEventListener('click', (event) => {
  const anchor = event.target.closest?.('a[href]');
  const href = anchor?.getAttribute('href');

  if (event.defaultPrevented || !href?.startsWith('#')) return;

  event.preventDefault();

  if (href === '#') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  try {
    const id = decodeURIComponent(href.slice(1));
    const target = document.getElementById(id) || document.getElementsByName(id)[0];

    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch {}
});

document.addEventListener(
  'click',
  (event) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    const anchor = event.target.closest?.('a[href]');
    if (!anchor || anchor.hasAttribute('download')) return;

    const target = anchor.getAttribute('target')?.toLowerCase();
    if (target && target !== '_self' && target !== '_top') return;

    try {
      const destination = new URL(anchor.href, document.baseURI);
      const base = new URL(document.baseURI);

      if (
        !['http:', 'https:'].includes(destination.protocol) ||
        destination.origin === base.origin
      ) {
        return;
      }

      event.preventDefault();
      window.open(destination.href, '_blank', 'noopener,noreferrer');
    } catch {}
  },
  true,
);
