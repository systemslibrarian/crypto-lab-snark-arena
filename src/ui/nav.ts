// Sticky table-of-contents with scroll-spy, plus a back-to-top button.

export function initNav(): void {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('.toc-link'));
  const sections = links
    .map((a) => document.getElementById(a.getAttribute('href')!.slice(1)))
    .filter((el): el is HTMLElement => el !== null);
  if (sections.length === 0) return;

  const byId = new Map(links.map((a) => [a.getAttribute('href')!.slice(1), a]));

  const spy = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const id = entry.target.id;
        links.forEach((l) => l.classList.remove('toc-active'));
        const active = byId.get(id);
        if (active) {
          active.classList.add('toc-active');
          active.setAttribute('aria-current', 'true');
          links.filter((l) => l !== active).forEach((l) => l.removeAttribute('aria-current'));
          // keep the active chip visible in the horizontal scroller
          active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      });
    },
    { rootMargin: '-45% 0px -50% 0px', threshold: 0 },
  );
  sections.forEach((s) => spy.observe(s));

  // Back-to-top button visibility.
  const toTop = document.getElementById('to-top');
  if (toTop) {
    const onScroll = () => { toTop.hidden = window.scrollY < 600; };
    window.addEventListener('scroll', onScroll, { passive: true });
    toTop.addEventListener('click', () => {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    });
    onScroll();
  }
}
