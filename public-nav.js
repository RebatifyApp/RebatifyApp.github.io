(() => {
  const nav = document.querySelector('header nav');
  if (!nav) return;
  const links = [...nav.querySelectorAll('a')];
  const clear = () => links.forEach(link => {
    link.classList.remove('nav-current');
    if (link.getAttribute('aria-current') === 'true') link.removeAttribute('aria-current');
  });
  const path = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const setCurrent = (link, page = false) => {
    clear();
    if (!link) return;
    link.classList.add('nav-current');
    link.setAttribute('aria-current', page ? 'page' : 'true');
  };

  if (path !== '' && path !== 'index.html') {
    const match = links.find(link => {
      const raw = (link.getAttribute('href') || '').split('#')[0].toLowerCase();
      return raw === path;
    });
    if (match) setCurrent(match, true);
    return;
  }

  const sectionMap = [
    ['features', links.find(a => (a.getAttribute('href') || '') === '#features')],
    ['plus', links.find(a => (a.getAttribute('href') || '') === '#plus')],
    ['screens', links.find(a => (a.getAttribute('href') || '') === '#screens')]
  ].filter(([,link]) => link);

  const activateFromHash = () => {
    const hash = location.hash.replace('#','');
    const found = sectionMap.find(([id]) => id === hash);
    if (found) setCurrent(found[1], false);
  };
  activateFromHash();

  if ('IntersectionObserver' in window) {
    const visible = new Map();
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => visible.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0));
      let best = null;
      for (const [id, link] of sectionMap) {
        const ratio = visible.get(id) || 0;
        if (!best || ratio > best.ratio) best = {id, link, ratio};
      }
      if (best && best.ratio > 0.18) setCurrent(best.link, false);
      else if (window.scrollY < 240) clear();
    }, {rootMargin:'-20% 0px -52% 0px', threshold:[0,.18,.35,.6]});
    sectionMap.forEach(([id]) => {
      const section=document.getElementById(id);
      if (section) observer.observe(section);
    });
  }
  window.addEventListener('hashchange', activateFromHash);
})();
