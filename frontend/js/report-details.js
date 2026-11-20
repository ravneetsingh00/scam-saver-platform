(() => {
  const root = document.getElementById('reportDetail');
  const id = new URLSearchParams(location.search).get('id');
  const authToken = () => localStorage.getItem('ss_admin_token') || localStorage.getItem('ss_token') || '';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const date = value => value ? new Date(value).toLocaleString() : '—';
  const objectUrls = new Set();
  if (!root) return;
  if (!id) { root.innerHTML = '<div class="notice">No report was selected. <a href="my-reports.html">Return to My Reports</a>.</div>'; return; }
  const endpoint = `/api/reports/${encodeURIComponent(id)}`;
  const media = (report, item, index) => {
    const url = `${endpoint}/evidence/${index}`;
    const mime = String(item.mimeType || '');
    const preview = mime.startsWith('image/')
      ? `<a href="${url}" data-evidence data-filename="${esc(item.originalName)}"><img class="case-evidence-thumb" data-report-media="${url}" alt="Evidence: ${esc(item.originalName)}"></a>`
      : mime.startsWith('audio/')
        ? `<audio controls preload="metadata" data-report-media="${url}" aria-label="Audio evidence: ${esc(item.originalName)}"></audio>`
        : mime.startsWith('video/')
          ? `<video controls playsinline preload="metadata" class="case-evidence-thumb" data-report-media="${url}" aria-label="Video evidence: ${esc(item.originalName)}"></video>`
          : `<a href="${url}" data-evidence data-filename="${esc(item.originalName)}">Open evidence</a>`;
    return `<article class="case-attachment"><div>${preview}</div><div><strong>${esc(item.originalName || item.filename || 'Evidence file')}</strong><small>${esc(mime || 'Unknown type')} · ${Number(item.size || 0).toLocaleString()} bytes · Uploaded ${date(item.uploadedAt)}</small>${item.description ? `<p>${esc(item.description)}</p>` : ''}</div></article>`;
  };
  const timeline = (report, investigations) => {
    const items = [{ action: 'Report submitted', at: report.createdAt, note: '' }];
    (report.evidenceAttachments || []).forEach(file => items.push({ action: 'Evidence uploaded', at: file.uploadedAt, note: file.originalName }));
    (report.moderationHistory || []).forEach(event => items.push({ action: event.action, at: event.at, note: event.note || (event.by?.name ? `By ${event.by.name}` : '') }));
    investigations.forEach(investigation => {
      (investigation.timeline || []).forEach(event => items.push({ action: event.action, at: event.at, note: event.note, investigation }));
      if (!(investigation.timeline || []).length) items.push({ action: 'Investigation record', at: investigation.createdAt, note: `${investigation.businessName} · ${investigation.status || 'Status not recorded'}`, investigation });
    });
    return items.filter(item => item.at).sort((a, b) => new Date(a.at) - new Date(b.at));
  };
  async function load() {
    try {
      const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${authToken()}`, 'Cache-Control': 'no-store' }, cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.report) throw new Error(data.message || 'Report details could not be loaded.');
      const report = data.report;
      const [businessData, investigationData] = await Promise.all([
        report.business ? fetch(`/api/businesses/${encodeURIComponent(report.business)}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : {}) : Promise.resolve({}),
        fetch(`${endpoint}/investigations`, { headers: { Authorization: `Bearer ${authToken()}`, 'Cache-Control': 'no-store' }, cache: 'no-store' }).then(r => r.ok ? r.json() : { investigations: [] }),
      ]);
      const business = businessData.business;
      const investigations = investigationData.investigations || [];
      const attachments = report.evidenceAttachments || [];
      const history = timeline(report, investigations);
      const reporter = report.reporter || {};
      const details = report.incidentDetails || {};
      const businessDetails = report.businessDetails || {};
      const field = (label, value) => value ? `<div class="business-detail-field"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>` : '';
      root.innerHTML = `<section class="detail-hero"><div class="business-detail-top"><div><div class="eyebrow">${report.isDemo ? 'FICTIONAL DEMO REPORT' : 'COMMUNITY REPORT'} · ${esc(report.reportId)}</div><h1>${esc(report.businessName || 'Report details')}</h1><p class="muted">${esc(report.fraudType || 'Category not set')} · ${esc(report.location || 'Location not set')}</p></div><span class="pill ${report.status === 'Verified' ? 'green' : report.status === 'Rejected' ? 'red' : 'amber'}">${esc(report.status || 'Status not set')}</span></div><p class="form-note">Submitted ${date(report.createdAt)} · Incident date ${date(report.incidentDate)}</p>${report.isDemo ? '<p class="notice warn">Fictional educational sample. Its scenario and attachments are synthetic and are not real allegations or evidence.</p>' : ''}</section>
        <section class="card business-full-record"><div class="eyebrow">INCIDENT</div><h2>Reported details</h2><p class="case-narrative">${esc(report.description || 'No incident description was recorded.')}</p><dl class="business-detail-fields">${field('Business category', report.category)}${field('Reported business website', businessDetails.website)}${field('Representative', businessDetails.ownerContact)}${field('Business email', businessDetails.email)}${field('Business phone', businessDetails.phone)}${field('Incident location', details.location)}${field('Payment method', details.paymentMethod)}${field('Transaction reference', details.transactionReference)}${field('UPI ID', details.upiId)}${field('Amount', report.amount == null ? '' : `${report.amountCurrency || ''} ${report.amount}`)}${field('Reporter', reporter.name)}${field('Reporter email', reporter.email)}${field('Reporter phone', reporter.phone)}</dl></section>
        <section class="card business-full-record"><div class="eyebrow">EVIDENCE</div><h2>Images, audio and attachments</h2>${attachments.length ? `<div class="case-attachment-grid">${attachments.map((item, index) => media(report, item, index)).join('')}</div>` : '<p class="muted">No image evidence has been uploaded. No audio recordings are available.</p>'}</section>
        <section class="card business-full-record"><div class="eyebrow">REVIEW</div><h2>Review and investigation history</h2>${report.adminNote ? `<p><strong>Moderator note:</strong> ${esc(report.adminNote)}</p>` : '<p class="muted">No moderator note is available.</p>'}${history.length ? `<ol class="admin-timeline">${history.map(item => `<li><strong>${esc(item.action)}</strong><small>${date(item.at)}</small>${item.note ? `<p>${esc(item.note)}</p>` : ''}${item.investigation ? `<p><a href="investigate.html?conversationId=${encodeURIComponent(item.investigation._id || item.investigation.id)}">View investigation ${esc(item.investigation._id || item.investigation.id)} →</a></p>` : ''}</li>`).join('')}</ol>` : '<p class="muted">No investigation or review activity is available.</p>'}${investigations.length ? investigations.map(item => `<article class="card"><div class="eyebrow">INVESTIGATION ${esc(item._id || item.id)}</div><h3>${esc(item.businessName)}</h3><p>${esc(item.summary || 'No investigation summary recorded.')}</p><p class="muted">${esc(item.status || 'Status not recorded')} · ${date(item.createdAt)} · Updated ${date(item.updatedAt)}</p>${item.assignedModerator ? `<p>Assigned moderator ID: ${esc(item.assignedModerator)}</p>` : ''}${item.moderatorNotes ? `<p><strong>Moderator notes:</strong> ${esc(item.moderatorNotes)}</p>` : ''}${item.outcome ? `<p><strong>Outcome:</strong> ${esc(item.outcome)}</p>` : ''}</article>`).join('') : '<p class="muted">No investigation records are linked to this report.</p>'}</section>
        <section class="card business-full-record"><div class="eyebrow">RELATED BUSINESS</div><h2>${business ? esc(business.name) : esc(report.businessName || 'Business record not linked')}</h2>${business ? `<p>${esc(business.category)} · ${esc(business.location)}</p><a class="btn secondary" href="business-details.html?id=${encodeURIComponent(business._id)}">View business details →</a> <a class="btn secondary" href="investigate.html?businessId=${encodeURIComponent(business._id)}&reportId=${encodeURIComponent(report._id)}&businessName=${encodeURIComponent(business.name)}&category=${encodeURIComponent(business.category)}&location=${encodeURIComponent(business.location)}">Investigate this business →</a>` : '<p class="muted">This report has no business record ID association.</p>'}</section>`;
      await Promise.all([...root.querySelectorAll('[data-report-media]')].map(async element => {
        try {
          const response = await fetch(element.dataset.reportMedia, { headers: { Authorization: `Bearer ${authToken()}`, 'Cache-Control': 'no-store' }, cache: 'no-store' });
          if (!response.ok) throw new Error('Evidence is unavailable.');
          element.src = URL.createObjectURL(await response.blob()); objectUrls.add(element.src);
          if (element instanceof HTMLAudioElement) element.addEventListener('loadedmetadata', () => { const note = document.createElement('small'); note.textContent = `Duration ${Number.isFinite(element.duration) ? `${Math.floor(element.duration / 60)}:${String(Math.floor(element.duration % 60)).padStart(2, '0')}` : 'unavailable'}`; element.insertAdjacentElement('afterend', note); }, { once: true });
        } catch {
          const fallback = document.createElement('span'); fallback.className = 'case-attachment-icon evidence-missing'; fallback.textContent = 'Evidence unavailable'; element.replaceWith(fallback);
        }
      }));
    } catch (error) { root.innerHTML = `<div class="notice">${esc(error.message)} <a href="my-reports.html">Return to My Reports</a>.</div>`; }
  }
  load();
  window.addEventListener('pagehide', () => { for (const url of objectUrls) URL.revokeObjectURL(url); objectUrls.clear(); }, { once: true });
})();
