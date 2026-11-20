(() => {
  const root = document.getElementById('businessDetail');
  const businessId = new URLSearchParams(location.search).get('id');
  const authToken = () => localStorage.getItem('ss_admin_token') || localStorage.getItem('ss_token') || '';
  const objectUrls = new Set();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const date = value => value ? new Date(value).toLocaleString() : 'Not recorded';
  if (!root) return;
  if (!businessId) { root.innerHTML = '<div class="notice">No business selected. <a href="search.html">Return to Scam Search</a>.</div>'; return; }
  const headers = { Authorization: `Bearer ${authToken()}`, 'Cache-Control': 'no-store' };
  const reportUrl = report => `report-details.html?id=${encodeURIComponent(report._id)}`;
  const statsCards = (heading, stats, demo = false) => {
    const cards = [['Total reports',stats.total],['Awaiting review',stats.awaitingReview],['Under investigation',stats.underInvestigation],['Verified',stats.verified],['Closed',stats.closed],['Other outcomes',stats.other]];
    return `<div class="business-activity-group${demo ? ' demo-activity' : ''}"><h3>${demo ? 'Fictional demo activity' : 'Community activity'}</h3><div class="business-detail-counts">${cards.map(([label,value]) => `<span><strong>${Number(value || 0)}</strong> ${label}</span>`).join('')}</div>${demo ? '<p class="form-note">Demo reports and sample statuses are fictional workflow examples. They are excluded from community totals and are not real findings.</p>' : ''}</div>`;
  };
  function attachmentMarkup(report, item, index) {
    const url = `/api/reports/${encodeURIComponent(report._id)}/evidence/${index}`;
    const mime = String(item.mimeType || '');
    let player = `<a href="${url}" data-evidence data-filename="${esc(item.originalName)}">Open attachment ↗</a>`;
    if (mime.startsWith('image/')) player = `<a href="${url}" data-evidence data-filename="${esc(item.originalName)}"><img class="case-evidence-thumb" data-business-evidence="${url}" alt="${report.isDemo ? 'Fictional demo image' : 'Report evidence'}: ${esc(item.originalName)}"></a>`;
    else if (mime.startsWith('audio/')) player = `<audio controls preload="metadata" data-business-evidence="${url}" aria-label="Audio evidence: ${esc(item.originalName)}"></audio>`;
    else if (mime.startsWith('video/')) player = `<video controls playsinline preload="metadata" class="case-evidence-thumb" data-business-evidence="${url}" aria-label="Video evidence: ${esc(item.originalName)}"></video>`;
    return `<article class="case-attachment"><div>${player}</div><div><strong>${esc(item.originalName || item.filename || 'Attachment')}</strong><small>${esc(mime || 'File type not recorded')} · ${Number(item.size || 0).toLocaleString()} bytes</small><small>Uploaded ${date(item.uploadedAt)}</small>${item.description ? `<p>${esc(item.description)}</p>` : ''}</div></article>`;
  }
  function reportCard(report) {
    const files = report.evidenceAttachments || [];
    return `<article class="card linked-report-card"><div class="business-case-head"><div><div class="eyebrow">${report.isDemo ? 'FICTIONAL DEMO' : 'COMMUNITY REPORT'} · ${esc(report.reportId)}</div><h3>${esc(report.businessName || 'Report')}</h3><p class="muted">${esc(report.fraudType || report.category || 'Category not recorded')}</p></div><span class="pill ${report.status === 'Verified' ? 'green' : report.status === 'Rejected' ? 'red' : 'amber'}">${report.isDemo ? 'DEMO STATUS · ' : ''}${esc(report.status || 'Status not recorded')}</span></div><p class="form-note">Submitted ${date(report.createdAt)} · Evidence files: ${files.length}</p><p class="case-narrative">${esc(report.description || 'No incident description was recorded.')}</p>${report.isDemo ? '<p class="notice warn">Fictional scenario; this is not a real-world allegation.</p>' : ''}<details><summary>View evidence (${files.length})</summary>${files.length ? `<div class="case-attachment-grid">${files.map((item,index) => attachmentMarkup(report,item,index)).join('')}</div>` : '<p class="muted">No image evidence or audio recordings were uploaded.</p>'}</details><a class="btn secondary" href="${reportUrl(report)}">View report details →</a></article>`;
  }
  function makeTimeline(reports, investigations) {
    const events = [];
    for (const report of reports) {
      if (report.createdAt) events.push({ at: report.createdAt, title: 'Report submitted', note: report.reportId, demo: report.isDemo, report });
      for (const file of report.evidenceAttachments || []) if (file.uploadedAt) events.push({ at: file.uploadedAt, title: 'Evidence uploaded', note: file.originalName, demo: report.isDemo, report });
      for (const entry of report.moderationHistory || []) if (entry.at) events.push({ at: entry.at, title: entry.action, note: entry.note, demo: report.isDemo, report });
    }
    for (const investigation of investigations) {
      for (const entry of investigation.timeline || []) if (entry.at) events.push({ at: entry.at, title: entry.action, note: entry.note, investigation });
      if (!(investigation.timeline || []).length && investigation.createdAt) events.push({ at: investigation.createdAt, title: 'Investigation record', note: investigation.businessName, investigation });
    }
    return events.sort((a,b) => new Date(b.at)-new Date(a.at));
  }
  async function load() {
    root.innerHTML = '<div class="loader">Loading business profile…</div>';
    try {
      const response = await fetch(`/api/businesses/${encodeURIComponent(businessId)}`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.business) throw new Error(body.message || 'Business details could not be loaded.');
      const business = body.business;
      const [reportResult, investigationResult] = await Promise.all([
        fetch(`/api/reports/business/${encodeURIComponent(businessId)}/authorized`, { headers, cache: 'no-store' }).then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.message || 'Linked reports could not be loaded.'); return d.reports || []; }),
        fetch(`/api/investigations/business/${encodeURIComponent(businessId)}`, { headers, cache: 'no-store' }).then(async r => { const d = await r.json().catch(() => ({})); return r.ok ? (d.investigations || []) : []; }),
      ]);
      const reports = reportResult;
      const demos = reports.filter(item => item.isDemo);
      const data = business.activity || {};
      const community = data.community || { total: business.reportCount || 0, awaitingReview: business.inReviewCount || 0, verified: business.verifiedCount || 0 };
      const demoStats = data.demo || { total: business.demoReportCount || 0 };
      const created = date(business.createdAt), updated = date(business.updatedAt);
      const riskLabel = community.total ? (business.risk || 'Under review') : 'No community reports';
      const website = business.website ? `<a href="${esc(business.website)}" target="_blank" rel="noopener noreferrer">${esc(business.website)}</a>` : '<span class="muted">Not recorded</span>';
      const fields = [
        ['Business name',business.name],['Category',business.category],['Owner / representative',business.ownerName || 'Not recorded'],['Location',business.location],['Website',website],['Business record ID',business._id],['Record type',business.isDemo ? 'Fictional demo business record' : 'Business directory record'],['Registration status','Not recorded'],['Record created',created],['Last updated',updated],
      ];
      const safety = '<ul><li>Verify a business identity through its independently located official website or registry.</li><li>Do not pay unexpected extra fees to release a refund, job offer, rental, or purchase.</li><li>Never share passwords, one-time codes, full card numbers, or banking credentials.</li><li>Keep original receipts and messages, and report suspected fraud to the appropriate official channel.</li></ul>';
      root.innerHTML = `<section class="detail-hero"><div class="business-detail-top"><div><div class="eyebrow">${esc(business.category || 'Business profile')}${business.isDemo ? ' · FICTIONAL DEMO' : ''}</div><h1>${esc(business.name || 'Business')}</h1><p class="muted">${esc(business.location || 'Location not recorded')} · ${esc(business.ownerName || 'Representative not recorded')}</p></div><span class="pill ${community.total ? (riskLabel.includes('High') ? 'red' : 'amber') : ''}">${esc(riskLabel)}</span></div><p>${esc(business.description || 'No business description is recorded.')}</p>${business.isDemo ? '<p class="notice warn">This is a fictional demonstration business. Its scenarios, reports, and sample outcomes are not real-world findings.</p>' : ''}<a class="btn secondary" href="investigate.html?businessId=${encodeURIComponent(business._id)}&businessName=${encodeURIComponent(business.name)}&category=${encodeURIComponent(business.category)}&location=${encodeURIComponent(business.location)}">Investigate this business ↗</a></section>
        <section class="card business-full-record"><div class="eyebrow">BUSINESS OVERVIEW</div><h2>Business information</h2><dl class="business-detail-fields">${fields.map(([label,value]) => `<div class="business-detail-field"><dt>${esc(label)}</dt><dd>${label === 'Website' ? value : esc(value)}</dd></div>`).join('')}</dl><p class="muted">Services, products, and registration details are not recorded for this directory entry.</p></section>
        <section class="card business-full-record"><div class="eyebrow">REPORT ACTIVITY</div><h2>Community activity</h2>${community.total ? statsCards('Community activity',community) : '<p class="empty">No community reports have been submitted for this business yet.</p>'}${demoStats.total ? statsCards('Fictional demo activity',demoStats,true) : ''}<p class="form-note">Community totals count linked non-demo report records only. Fictional demo cases appear separately. Verified refers to moderator status, not a legal finding.</p></section>
        <section class="card business-full-record"><div class="eyebrow">SCENARIOS</div><h2>Reported concerns and safety guidance</h2>${demos.length ? demos.map(report => `<article class="scenario-summary"><span class="pill amber">FICTIONAL DEMO SCENARIO</span><h3>${esc(report.fraudType || report.category || 'Educational scenario')}</h3><p>${esc(report.description || 'No scenario description was recorded.')}</p></article>`).join('') : '<p class="muted">No scenario descriptions are available for this record.</p>'}<h3>General safety guidance</h3>${safety}</section>
        <section class="card business-full-record"><div class="eyebrow">LINKED REPORTS</div><h2>Reports associated with this business</h2>${reports.length ? `<div class="linked-report-list">${reports.map(reportCard).join('')}</div>` : '<p class="empty">No reports linked to this business are available to your account.</p><p class="form-note">Other reporters’ private case details are not shown here.</p>'}</section>
        <section class="card business-full-record"><div class="eyebrow">ACTIVITY</div><h2>Investigation timeline</h2>${(() => { const events = makeTimeline(reports,investigationResult); return events.length ? `<ol class="business-activity-timeline">${events.map(event => `<li><time>${date(event.at)}</time><strong>${esc(event.title)}</strong>${event.demo ? '<span class="pill amber">DEMO</span>' : ''}${event.note ? `<p>${esc(event.note)}</p>` : ''}${event.report ? `<a href="${reportUrl(event.report)}">Open report →</a>` : ''}${event.investigation ? `<small>Investigation ${esc(event.investigation.id || event.investigation._id)}</small>` : ''}</li>`).join('')}</ol>` : '<p class="empty">No investigation activity is available.</p>'; })()}<h3>Linked investigations</h3>${investigationResult.length ? investigationResult.map(item => `<article class="scenario-summary"><div class="eyebrow">INVESTIGATION ${esc(item.id)}</div><h4>${esc(item.businessName)}</h4><p>${esc(item.summary || 'No investigation summary is recorded.')}</p><p class="muted">${esc(item.status || 'Status not recorded')} · ${date(item.createdAt)}</p><a href="investigate.html?conversationId=${encodeURIComponent(item.id)}">Open investigation →</a></article>`).join('') : '<p class="muted">No investigations are linked to this business in your account. No existing investigation was matched by name alone.</p>'}</section>`;
      await Promise.all([...root.querySelectorAll('[data-business-evidence]')].map(async element => {
        try {
          const mediaResponse = await fetch(element.dataset.businessEvidence, { headers, cache: 'no-store' });
          if (!mediaResponse.ok) throw new Error('Evidence unavailable');
          element.src = URL.createObjectURL(await mediaResponse.blob()); objectUrls.add(element.src);
          if (element instanceof HTMLAudioElement) element.addEventListener('loadedmetadata', () => { const duration = document.createElement('small'); duration.textContent = Number.isFinite(element.duration) ? `Duration ${Math.floor(element.duration / 60)}:${String(Math.floor(element.duration % 60)).padStart(2,'0')}` : 'Duration unavailable'; element.insertAdjacentElement('afterend', duration); }, { once: true });
        } catch {
          const message = document.createElement('span'); message.className = 'case-attachment-icon evidence-missing'; message.textContent = 'Evidence file unavailable'; element.replaceWith(message);
        }
      }));
    } catch (error) { root.innerHTML = `<div class="notice">${esc(error.message)} <button type="button" id="retryBusinessDetails">Try again</button></div>`; root.querySelector('#retryBusinessDetails')?.addEventListener('click', load); }
  }
  load();
  window.addEventListener('pagehide', () => { for (const url of objectUrls) URL.revokeObjectURL(url); objectUrls.clear(); }, { once: true });
})();
