(() => {
  const results = document.getElementById('businessResults');
  if (!results) return;

  const input = document.getElementById('searchInput');
  const searchButton = document.getElementById('searchBtn');
  const clearButton = document.getElementById('clearSearchBtn');
  const summary = document.getElementById('businessResultsSummary');
  const pagination = document.getElementById('businessPagination');
  let activeQuery = '';
  let requestNumber = 0;

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
  const formatDate = value => {
    if (!value) return 'Not provided';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 'Not provided' : parsed.toLocaleDateString(undefined, {year:'numeric',month:'short',day:'numeric'});
  };
  const riskBadge = risk => {
    const label = risk || 'Low Risk';
    const tone = label === 'Low Risk' ? 'green' : label === 'Under Review' ? 'amber' : 'red';
    return `<span class="pill ${tone}">${escapeHtml(label)}</span>`;
  };
  const token = () => { try { return localStorage.getItem('ss_token') || ''; } catch { return ''; } };

  const queryFromUrl = new URLSearchParams(location.search).get('q');
  if (input && queryFromUrl) input.value = queryFromUrl.slice(0, 120);

  function renderBusiness(business) {
    const total = Number(business.reportCount) || 0;
    const verified = Number(business.verifiedCount) || 0;
    const review = Number(business.inReviewCount) || 0;
    const other = Math.max(0, total - verified - review);
    const details = [
      ['Owner / representative', business.ownerName || 'Not provided'],
      ['Location', business.location || 'Not provided'],
      ['Description', business.description || 'No description supplied.'],
    ];
    return `<article class="card business-card">
      <header class="business-card-heading">
        <div><div class="eyebrow">${escapeHtml(business.category || 'Category not provided')}</div><h3>${escapeHtml(business.name || 'Unnamed business')}</h3></div>
        <div class="business-card-badges">${business.isDemo ? '<span class="pill blue">DEMO SAMPLE</span>' : ''}${riskBadge(business.risk)}</div>
      </header>
      <dl class="business-card-fields">${details.map(([label,value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>
      <div class="business-card-counts"><span>${total} community ${total === 1 ? 'report' : 'reports'}</span><span>${verified} verified</span><span>${review} pending review</span><span>${other} other review outcomes</span>${Number(business.demoReportCount) ? `<span>${Number(business.demoReportCount)} fictional demo ${Number(business.demoReportCount) === 1 ? 'sample' : 'samples'}</span>` : ''}</div>
      <div class="business-card-record"><span>Record ID <code>${escapeHtml(business._id)}</code></span><span>Added ${escapeHtml(formatDate(business.createdAt))}</span></div>
      <a class="btn secondary" href="business-details.html?id=${encodeURIComponent(business._id || '')}">View full details <span aria-hidden="true">→</span></a>
    </article>`;
  }

  function showError(message) {
    results.innerHTML = `<div class="notice search-load-error"><strong>Business data could not load.</strong><p>${escapeHtml(message)}</p><button type="button" class="secondary" data-retry-search>Try again</button></div>`;
    if (summary) summary.textContent = 'Directory data is currently unavailable.';
    if (pagination) pagination.replaceChildren();
  }

  async function load(page = 1) {
    const query = String(input?.value || '').trim().slice(0, 120);
    activeQuery = query;
    const currentRequest = ++requestNumber;
    if (summary) summary.textContent = 'Loading business records…';
    results.innerHTML = '<div class="loader">Loading business records…</div>';
    if (pagination) pagination.replaceChildren();
    if (searchButton) searchButton.disabled = true;
    const params = new URLSearchParams({page:String(page)});
    if (query) params.set('q', query);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const authToken = token();
      const response = await fetch('/api/businesses?' + params.toString(), {
        headers: {Accept:'application/json', ...(authToken ? {Authorization:'Bearer '+authToken} : {})},
        cache: 'no-store',
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || `Request failed (${response.status}).`);
      if (currentRequest !== requestNumber) return;
      const businesses = Array.isArray(data.businesses) ? data.businesses : [];
      const paging = data.pagination || {page:1,total:businesses.length,pages:businesses.length ? 1 : 0};
      const isEmptyDirectory = !query && Number(paging.total) === 0;
      results.innerHTML = businesses.length
        ? businesses.map(renderBusiness).join('')
        : isEmptyDirectory
          ? '<div class="empty card"><strong>The connected database has no business directory records yet.</strong><p>If you expected existing records, check the deployed <code>MONGODB_URI</code> or migrate the records into that MongoDB database. Local development data is not copied to a deployment automatically.</p></div>'
          : '<div class="empty card">No matching businesses found. Try another name, owner, category, location or description.</div>';
      if (summary) summary.textContent = `${Number(paging.total || 0).toLocaleString()} directory ${Number(paging.total) === 1 ? 'record' : 'records'}${query ? ` matching “${query}”` : ''}.${paging.pages > 1 ? ` Page ${paging.page} of ${paging.pages}.` : ''}`;
      if (pagination && paging.pages > 1) {
        pagination.innerHTML = `<button class="ghost" type="button" data-business-page="${Math.max(1,paging.page-1)}" ${paging.page <= 1 ? 'disabled' : ''}>← Previous</button><span>Page ${paging.page} of ${paging.pages}</span><button class="ghost" type="button" data-business-page="${Math.min(paging.pages,paging.page+1)}" ${paging.page >= paging.pages ? 'disabled' : ''}>Next →</button>`;
      }
    } catch (error) {
      if (currentRequest !== requestNumber) return;
      showError(error.name === 'AbortError'
        ? 'The directory request timed out. Check that the server and database are running, then try again.'
        : error.message || 'Please check the server connection and try again.');
    } finally {
      window.clearTimeout(timeout);
      if (currentRequest === requestNumber && searchButton) searchButton.disabled = false;
    }
  }

  searchButton?.addEventListener('click', () => load(1));
  input?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); load(1); } });
  input?.addEventListener('input', () => clearButton?.classList.toggle('hide', !input.value));
  clearButton?.addEventListener('click', () => { if (input) { input.value = ''; input.focus(); } clearButton.classList.add('hide'); load(1); });
  pagination?.addEventListener('click', event => {
    const button = event.target.closest('[data-business-page]');
    if (button && !button.disabled) load(Number(button.dataset.businessPage));
  });
  results.addEventListener('click', event => { if (event.target.closest('[data-retry-search]')) load(1); });
  load(1);
})();
