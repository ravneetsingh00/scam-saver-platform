(() => {
  document.documentElement.classList.add('landing-motion-ready');
  const menu = document.querySelector('.landing-menu-toggle');
  const backdrop = document.querySelector('.landing-page .sidebar-backdrop');
  const closeMenu = () => {
    document.body.classList.remove('mobile-sidebar-open');
    menu?.setAttribute('aria-expanded', 'false');
    menu?.setAttribute('aria-label', 'Open navigation');
  };
  menu?.addEventListener('click', () => {
    const open = document.body.classList.toggle('mobile-sidebar-open');
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  });
  backdrop?.addEventListener('click', closeMenu);
  document.querySelectorAll('.landing-links a').forEach(link => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
  window.addEventListener('resize', () => { if (window.innerWidth > 1023) closeMenu(); });
  document.querySelectorAll('.service-card[href]').forEach(card => card.addEventListener('click', event => {
    if (localStorage.getItem('ss_token')) return;
    event.preventDefault();
    const destination = new URL(card.href, location.href);
    const next = destination.pathname.split('/').pop() + destination.search + destination.hash;
    location.href = 'login.html?next=' + encodeURIComponent(next);
  }));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reveals = document.querySelectorAll('.landing-reveal');
  if (reducedMotion || !('IntersectionObserver' in window)) reveals.forEach(el => el.classList.add('is-visible'));
  else {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
    }), { threshold: 0.12, rootMargin: '0px 0px -32px 0px' });
    reveals.forEach(el => observer.observe(el));
  }

  const values = document.querySelectorAll('[data-stat]');
  const note = document.getElementById('statsNote');
  let retryTimer;
  async function loadStats(attempt = 0) {
    try {
      const response = await fetch('/api/reports/map-data', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) throw new Error('Statistics unavailable');
      const data = await response.json();
      const stats = {
        totalReports: Number.isFinite(data.totalReports) ? data.totalReports : null,
        highActivityLocations: Number.isFinite(data.highActivityLocations) ? data.highActivityLocations : null,
        reportsToday: Number.isFinite(data.reportsToday) ? data.reportsToday : null,
        mostReportedCategory: typeof data.mostReportedCategory === 'string' && data.mostReportedCategory ? data.mostReportedCategory : null,
      };
      values.forEach(el => {
        const value = stats[el.dataset.stat];
        el.textContent = typeof value === 'number' ? value.toLocaleString() : value || '—';
      });
      const updated = data.generatedAt ? new Date(data.generatedAt).toLocaleTimeString(undefined, {hour:'numeric',minute:'2-digit'}) : '';
      if (note) note.textContent = `Source: ${data.dataLabel || 'Latest submitted reports'}${updated ? ` · updated ${updated}` : ''}. Reports are community signals, not verified findings.`;
      const label = document.getElementById('statsLabel'); if (label) label.textContent = data.dataLabel || 'Latest submitted reports';
    } catch {
      if (attempt < 2) { retryTimer = setTimeout(() => loadStats(attempt + 1), 1200 * (attempt + 1)); return; }
      values.forEach(el => el.textContent = '—');
      if (note) note.textContent = 'Platform statistics are currently unavailable. No estimates are shown. Reports are community signals, not verified findings.';
      const label = document.getElementById('statsLabel'); if (label) label.textContent = 'Statistics unavailable';
    }
  }
  loadStats();
  window.addEventListener('pageshow', event => { if (event.persisted) { clearTimeout(retryTimer); loadStats(); } });

})();
