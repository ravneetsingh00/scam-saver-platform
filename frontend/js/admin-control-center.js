(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const token = () => localStorage.getItem('ss_admin_token') || localStorage.getItem('ss_token') || '';
  const activeTokenIsAdmin = () => Boolean(localStorage.getItem('ss_admin_token'));
  const clearActiveSession = () => { if (activeTokenIsAdmin()) { localStorage.removeItem('ss_admin_token'); localStorage.removeItem('ss_admin_user'); } else { localStorage.removeItem('ss_token'); localStorage.removeItem('ss_user'); } };
  const state = { user: null, reports: [], businessesPage: 1, businessPages: 1, userList: [], stats: null, actionReport: null, action: null, loaded: new Set(), busy: false, objectUrls: [] };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const date = value => value ? new Date(value).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' }) : '—';
  const number = value => Number(value || 0).toLocaleString();
  const message = (text, error = false) => { const box = $('#adminLiveMessage'); if (!box) return; box.textContent = text; box.classList.toggle('is-error', error); box.classList.add('is-visible'); clearTimeout(message.timer); message.timer = setTimeout(() => box.classList.remove('is-visible'), 5000); };
  async function api(url, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${token()}`);
    if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(url, { ...options, headers, cache: 'no-store' });
    const type = response.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await response.json().catch(() => ({})) : await response.blob();
    if (!response.ok) {
      if (response.status === 401) { clearActiveSession(); location.replace('admin-login.html?next=admin.html'); }
      if (response.status === 403) { message('Administrator access is required for this section.', true); }
      throw new Error(data?.message || `Request failed (${response.status}).`);
    }
    return data;
  }
  const reportId = report => report.reportId || report._id || '';
  const statusPill = status => `<span class="admin-status-pill status-${esc(String(status || 'unknown').toLowerCase().replace(/[^a-z]+/g,'-'))}">${esc(status || 'Unknown')}</span>`;
  const empty = (text, retry = '') => `<div class="admin-empty-state"><p>${esc(text)}</p>${retry ? `<button class="secondary" type="button" data-retry="${esc(retry)}">Try again</button>` : ''}</div>`;
  function setLoading(id, text = 'Loading…') { const target = document.getElementById(id); if (target) target.innerHTML = `<div class="admin-skeleton" aria-label="${esc(text)}"></div>`; }
  function updateTime() { const el = $('#adminDataUpdated'); if (el) el.textContent = `Updated ${new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}`; }
  function statCard(label, value, detail, tone = '') { const display = typeof value === 'number' ? number(value) : esc(value); return `<article class="admin-stat-card ${tone}"><span>${esc(label)}</span><strong>${display}</strong><small>${esc(detail)}</small></article>`; }
  function renderStats(stats) {
    state.stats = stats;
    const pending = Number(stats.pending || 0) + Number(stats.needsInformation || 0) + Number(stats.underReview || 0);
    $('#adminStats').innerHTML = [
      statCard('Submitted reports', stats.reports, 'All submitted community cases', 'accent-red'),
      statCard('Pending review', pending, 'Pending, information needed or under review', 'accent-amber'),
      statCard('Verified reports', stats.verified, 'Verified by authorized moderators', 'accent-green'),
      statCard('Rejected reports', stats.rejected, 'Rejected after moderator review', 'accent-muted'),
      statCard('Registered users', stats.users, 'Accounts in the database', 'accent-blue'),
    ].join('');
    if ($('#adminWelcome') && state.user) $('#adminWelcome').textContent = `Welcome, ${state.user.name || 'administrator'}`;
    $('#adminAccountName').textContent = state.user?.name || '—';
    $('#adminAccountEmail').textContent = state.user?.email || '—';
  }

  function renderReportsTable(reports, target = $('#adminReports'), mode = 'reports') {
    if (!reports.length) { target.innerHTML = empty(mode === 'evidence' ? 'No reports with uploaded evidence were found.' : 'No reports match these filters.'); return; }
    const evidence = mode === 'evidence';
    target.innerHTML = `<table class="admin-data-table"><thead><tr>${evidence ? '<th>Report / business</th><th>Evidence</th><th>Type</th><th>Uploaded</th><th>Source</th><th>Review</th>' : '<th>Report ID</th><th>Business / seller</th><th>Category</th><th>Location</th><th>Submitted</th><th>Status</th><th>Actions</th>'}</tr></thead><tbody>${reports.map(report => {
      const id = esc(report._id || ''); const isDemo = report.isDemo === true;
      if (!evidence) return `<tr><td><code>${esc(report.reportId || id.slice(-8) || '—')}</code>${isDemo ? '<small class="admin-demo-label">Demo record</small>' : ''}</td><td>${esc(report.businessName || '—')}</td><td>${esc(report.fraudType || report.category || '—')}</td><td>${esc(report.location || '—')}</td><td>${date(report.createdAt)}</td><td>${statusPill(report.status)}</td><td class="admin-actions"><button type="button" class="admin-text-button" data-view-report="${id}">View</button>${report.status !== 'Verified' ? `<button type="button" class="admin-text-button positive" data-report-action="Verified" data-report-id="${id}">Verify</button>` : ''}<button type="button" class="admin-text-button danger" data-report-action="Rejected" data-report-id="${id}">Reject</button><button type="button" class="admin-text-button danger" data-delete-report="${id}">Delete</button></td></tr>`;
      const attachments = Array.isArray(report.evidenceAttachments) ? report.evidenceAttachments : [];
      const files = attachments.length ? attachments.map((item, index) => evidenceItem(report, item, index)).join('') : (report.evidence ? evidenceItem(report, { filename: report.evidence, originalName: 'Legacy attachment', mimeType: 'application/octet-stream', size: 0 }, -1) : '—');
      const types = attachments.map(item => fileKind(item)).filter(Boolean).join(', ') || (report.evidence ? 'Legacy file' : '—');
      const uploadDate = attachments.map(item => item.uploadedAt).filter(Boolean).sort().at(-1) || report.createdAt;
      return `<tr><td><strong>${esc(report.reportId || id.slice(-8))}</strong><small>${esc(report.businessName || '—')}</small></td><td class="admin-evidence-list">${files}</td><td>${esc(types)}</td><td>${date(uploadDate)}</td><td>${isDemo ? '<span class="admin-demo-label">Demo evidence</span>' : '<span class="admin-user-upload">User upload</span>'}</td><td>${statusPill(report.status)}</td></tr>`;
    }).join('')}</tbody></table>`;
  }
  function fileKind(file) {
    const mime = String(file.mimeType || '').toLowerCase(); const name = String(file.originalName || file.filename || '').toLowerCase();
    if (mime.startsWith('image/')) return 'image'; if (mime.startsWith('audio/')) return 'audio'; if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'; if (/\.apk$/.test(name) || file.quarantined) return 'apk'; if (/\.(exe|msi|bat|cmd|sh|app|dmg)$/.test(name)) return 'executable'; return 'other';
  }
  function evidenceItem(report, file, index) {
    const type = fileKind(file); const rid = esc(report._id || ''); const fname = esc(file.originalName || file.filename || 'Evidence file');
    const action = type === 'apk' || type === 'executable' ? 'Quarantined download' : 'Preview';
    let preview;
    if (index >= 0 && type === 'image') preview = `<button class="admin-evidence-preview" type="button" data-evidence="${rid}" data-evidence-index="${index}" aria-label="Preview ${fname}"><span data-preview-image="${rid}:${index}">Secure image preview loading…</span></button>`;
    else if (index >= 0 && type === 'audio') preview = `<div class="admin-evidence-preview admin-evidence-audio-wrap"><audio controls preload="none" data-preview-audio="${rid}:${index}" aria-label="Audio evidence: ${fname}"></audio><small data-audio-duration></small></div>`;
    else if (index >= 0 && String(file.mimeType || '').startsWith('video/')) preview = `<video class="admin-evidence-preview admin-evidence-video" controls playsinline preload="none" data-preview-video="${rid}:${index}" aria-label="Video evidence: ${fname}"></video>`;
    else preview = `<span class="admin-evidence-preview">${type === 'apk' || type === 'executable' ? 'QUARANTINED · DOWNLOAD ONLY' : esc(type.toUpperCase())}</span>`;
    return `<article class="admin-evidence-file ${type === 'apk' || type === 'executable' ? 'is-quarantined' : ''}">${preview}<strong title="${fname}">${fname}</strong><small>${esc(file.mimeType || type)} · ${file.size ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : 'size unavailable'} · ${date(file.uploadedAt || report.createdAt)}</small><div class="admin-evidence-controls">${index >= 0 ? `<button type="button" data-evidence="${rid}" data-evidence-index="${index}">${action}</button>` : `<button type="button" data-legacy-evidence="${rid}">Download</button>`}</div></article>`;
  }
  function renderRecent(reports) {
    const recent = [...reports].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 6);
    const target = $('#adminRecentReports'); if (!target) return;
    target.innerHTML = recent.length ? `<div class="admin-recent-list">${recent.map(r => `<button class="admin-recent-row" type="button" data-view-report="${esc(r._id)}"><span><strong>${esc(r.businessName || 'Unnamed business')}${r.isDemo ? ' · Demo' : ''}</strong><small>${esc(r.reportId || '')} · ${esc(r.fraudType || r.category || 'Other')} · ${date(r.createdAt)}</small></span>${statusPill(r.status)}<span aria-hidden="true">›</span></button>`).join('')}</div>` : empty('No submitted reports yet.');
  }
  async function loadOverview() {
    setLoading('adminStats'); setLoading('adminRecentReports');
    const [stats, reports] = await Promise.all([api('/api/admin/stats'), api('/api/reports?limit=250')]);
    renderStats(stats); state.reports = reports.reports || []; renderRecent(state.reports); state.loaded.add('overview'); updateTime();
  }
  function renderReportResults() {
    let rows = [...state.reports];
    const q = ($('#reportSearch')?.value || '').trim().toLowerCase(); const status = $('#reportStatus')?.value || '';
    if (q) rows = rows.filter(r => [r.reportId,r.businessName,r.fraudType,r.category,r.location].some(value => String(value || '').toLowerCase().includes(q)));
    if (status) rows = rows.filter(r => r.status === status);
    const sort = $('#reportSort')?.value || 'newest';
    rows.sort((a,b) => sort === 'oldest' ? new Date(a.createdAt) - new Date(b.createdAt) : sort === 'business' ? String(a.businessName).localeCompare(String(b.businessName)) : sort === 'status' ? String(a.status).localeCompare(String(b.status)) : new Date(b.createdAt) - new Date(a.createdAt));
    $('#reportResultCount').textContent = `${number(rows.length)} report${rows.length === 1 ? '' : 's'}`;
    renderReportsTable(rows);
  }
  async function loadReports() { setLoading('adminReports'); const data = await api('/api/reports?limit=250'); state.reports = data.reports || []; renderReportResults(); state.loaded.add('reports'); updateTime(); }
  async function loadEvidence() { setLoading('adminEvidenceReports'); const data = await api('/api/reports?evidence=true&limit=250'); state.evidenceReports = data.reports || []; renderEvidenceResults(); state.loaded.add('evidence'); updateTime(); }
  function renderEvidenceResults() {
    const q = ($('#evidenceSearch')?.value || '').trim().toLowerCase(); const type = $('#evidenceType')?.value || '';
    const rows = (state.evidenceReports || []).filter(report => {
      const files = report.evidenceAttachments || []; const matchesText = !q || [report.reportId,report.businessName,...files.flatMap(f=>[f.filename,f.originalName])].some(v => String(v || '').toLowerCase().includes(q));
      const kinds = files.map(fileKind); const matchesType = !type || kinds.includes(type) || (type === 'other' && kinds.some(k => k === 'other' || k === 'executable'));
      return matchesText && matchesType;
    });
    const target = $('#adminEvidenceReports');
    if (!rows.length) { target.innerHTML = empty('No reports with uploaded evidence were found.'); return; }
    target.innerHTML = rows.map(report => {
      const files = report.evidenceAttachments || [];
      const items = files.length ? files.map((file,index) => evidenceItem(report,file,index)).join('') : evidenceItem(report,{originalName:'Legacy attachment',mimeType:'application/octet-stream',size:0},-1);
      return `<article class="admin-evidence-case"><div class="admin-evidence-case-head"><div><div class="eyebrow">${esc(report.reportId || '')} · ${esc(report.status || 'Unknown')}</div><h3>${esc(report.businessName || 'Report')}</h3><span class="admin-evidence-case-meta">${date(report.createdAt)} · ${report.isDemo ? 'Demo evidence' : 'User upload'}</span></div>${statusPill(report.status)}</div><div class="admin-evidence-files">${items}</div></article>`;
    }).join('');
    loadEvidenceThumbnails(target);
  }
  function loadEvidenceThumbnails(root) {
    loadEvidenceMedia(root);
  }
  function loadEvidenceMedia(root) {
    const media=$$('[data-preview-image],[data-preview-audio],[data-preview-video]',root);
    const load=async node=>{
      const key=node.dataset.previewImage||node.dataset.previewAudio||node.dataset.previewVideo;
      try{
        const [id,index]=key.split(':');const blob=await evidenceBlob(id,index);const url=URL.createObjectURL(blob);state.objectUrls.push(url);
        if(node.hasAttribute('data-preview-image')){const image=new Image();image.src=url;image.alt='Uploaded image evidence preview';image.addEventListener('error',()=>{const fallback=document.createElement('span');fallback.className='admin-evidence-media-fallback';fallback.textContent='Image preview unavailable';image.replaceWith(fallback)},{once:true});node.replaceWith(image);return}
        node.src=url;
        if(node instanceof HTMLAudioElement)node.addEventListener('loadedmetadata',()=>{const label=node.parentElement.querySelector('[data-audio-duration]');if(label)label.textContent=`Duration ${Math.floor(node.duration/60)}:${String(Math.floor(node.duration%60)).padStart(2,'0')}`},{once:true});
        node.addEventListener('error',()=>{const fallback=document.createElement('span');fallback.className='admin-evidence-media-fallback';fallback.textContent=node instanceof HTMLAudioElement?'Audio preview unavailable':'Video preview unavailable';node.replaceWith(fallback)},{once:true});
      }catch{if(node.hasAttribute('data-preview-image'))node.textContent='Image preview unavailable';else{const fallback=document.createElement('span');fallback.className='admin-evidence-media-fallback';fallback.textContent=node instanceof HTMLAudioElement?'Audio preview unavailable':'Video preview unavailable';node.replaceWith(fallback)}}
    };
    if('IntersectionObserver'in window){const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){observer.unobserve(entry.target);load(entry.target)}}),{rootMargin:'100px'});media.forEach(node=>observer.observe(node))}
    else media.forEach(load);
  }
  async function loadBusinesses() {
    setLoading('manageBusinesses');
    const q = $('#businessSearch')?.value.trim() || ''; const data = await api(`/api/businesses?page=${state.businessesPage}&q=${encodeURIComponent(q)}`);
    const list = data.businesses || []; const pagination = data.pagination || {};
    state.businessPages = pagination.pages || 1; state.businessesPage = pagination.page || 1;
    $('#businessResultCount').textContent = `${number(pagination.total)} business records`;
    $('#businessPageLabel').textContent = `Page ${state.businessesPage} of ${state.businessPages}`;
    $('#businessPrev').disabled = state.businessesPage <= 1; $('#businessNext').disabled = state.businessesPage >= state.businessPages;
    $('#manageBusinesses').innerHTML = list.length ? `<table class="admin-data-table"><thead><tr><th>Business</th><th>Category</th><th>Location</th><th>Reports</th><th>Actions</th></tr></thead><tbody>${list.map(b => `<tr><td><strong>${esc(b.name)}</strong><small>${esc(b.ownerName || '—')}</small></td><td>${esc(b.category)}</td><td>${esc(b.location)}</td><td>${number(b.reportCount || 0)}</td><td class="admin-actions"><button class="admin-text-button" type="button" data-edit-business="${esc(b._id)}" data-business="${esc(JSON.stringify(b))}">Edit</button><button class="admin-text-button danger" type="button" data-delete-business="${esc(b._id)}" data-business-name="${esc(b.name)}">Delete</button></td></tr>`).join('')}</tbody></table>` : empty('No business records found.');
    state.businesses = list; state.loaded.add('businesses'); updateTime();
  }
  async function loadUsers() {
    setLoading('adminUsers'); const data = await api('/api/admin/users'); state.userList = data.users || []; renderUsers(); state.loaded.add('users'); updateTime();
  }
  function renderUsers() {
    const q = ($('#userSearch')?.value || '').trim().toLowerCase(); const rows = state.userList.filter(u => !q || `${u.name} ${u.email}`.toLowerCase().includes(q));
    $('#userResultCount').textContent = `${number(rows.length)} accounts`;
    $('#adminUsers').innerHTML = rows.length ? `<table class="admin-data-table"><thead><tr><th>Name</th><th>Email</th><th>Account type</th><th>Joined</th></tr></thead><tbody>${rows.map(u => `<tr><td>${esc(u.name || '—')}</td><td>${esc(u.email || '—')}</td><td>${esc(u.role || 'user')}</td><td>${date(u.createdAt)}</td></tr>`).join('')}</tbody></table>` : empty('No users match this search.');
  }
  async function loadAnalytics() {
    setLoading('adminMonthlyChart'); setLoading('adminTypeChart');
    const stats = await api('/api/admin/stats');
    state.stats = stats;
    $('#adminMonthlyChart').innerHTML = horizontalChart(stats.monthly || [], 'label');
    $('#adminTypeChart').innerHTML = horizontalChart(stats.byType || [], 'label');
    state.loaded.add('analytics'); updateTime();
  }
  function horizontalChart(rows, labelKey) {
    if (!rows.length) return empty('No report activity is available yet.');
    const max = Math.max(1, ...rows.map(r => r.count || 0));
    return `<div class="admin-horizontal-rows">${rows.map(r => `<div class="admin-horizontal-row"><span>${esc(r[labelKey] || 'Uncategorized')}</span><div class="admin-horizontal-track"><span style="width:${Math.max(1,(r.count || 0)/max*100)}%"></span></div><strong>${number(r.count)}</strong></div>`).join('')}</div>`;
  }
  async function loadMap() {
    setLoading('adminMapLocations'); const data = await api('/api/reports/map-data');
    $('#adminMapStats').innerHTML = [statCard('Submitted reports', data.totalReports, 'Non-demo records with supported locations'), statCard('High activity locations', data.highActivityLocations, 'Locations with 10+ reports'), statCard('Reports today', data.reportsToday, 'Based on India local date'), statCard('Top category', data.mostReportedCategory || '—', 'Most frequent in current results')].join('');
    const locations = data.locations || [];
    $('#adminMapLocations').innerHTML = locations.length ? `<table class="admin-data-table"><thead><tr><th>City</th><th>State</th><th>Reports</th><th>Most reported category</th><th>Latest report</th></tr></thead><tbody>${locations.slice(0,100).map(l => `<tr><td>${esc(l.city)}</td><td>${esc(l.state)}</td><td>${number(l.reportCount)}</td><td>${esc(l.mostReportedCategory)}</td><td>${date(l.latestReportDate)}</td></tr>`).join('')}</tbody></table>` : empty('No submitted reports include a supported city and state.');
    state.loaded.add('map'); updateTime();
  }
  const loaders = { overview:loadOverview, reports:loadReports, evidence:loadEvidence, businesses:loadBusinesses, users:loadUsers, analytics:loadAnalytics, map:loadMap, settings:async()=>{} };
  async function loadSection(section, force = false) {
    if (!force && state.loaded.has(section)) return;
    try { await loaders[section]?.(); } catch (error) { message(error.message, true); const targets = { overview:['adminStats','adminRecentReports'], reports:['adminReports'], evidence:['adminEvidenceReports'], businesses:['manageBusinesses'], users:['adminUsers'], analytics:['adminMonthlyChart','adminTypeChart'], map:['adminMapLocations'] }; (targets[section] || []).forEach(id => { const element = document.getElementById(id); if (element) element.innerHTML = empty(error.message, section); }); }
  }
  function selectTab(section, updateHash = true) {
    const tab = $(`[data-admin-tab="${section}"]`); if (!tab) return;
    $$('[data-admin-tab]').forEach(item => item.setAttribute('aria-selected', String(item === tab)));
    $$('[data-admin-view]').forEach(view => { view.hidden = view.dataset.adminView !== section; });
    if (updateHash) history.replaceState(null, '', `#${section}`);
    loadSection(section);
  }
  function fillReport(report) {
    const pairs = [
      ['Report ID',report.reportId],['Status',report.status],['Business / seller',report.businessName],['Category',report.fraudType || report.category],['Location',report.location],['Incident date',date(report.incidentDate)],['Submitted',date(report.createdAt)],['Amount',report.amount == null ? '' : `${report.amountCurrency || ''} ${report.amount}`],['Website',report.businessDetails?.website],['Business phone',report.businessDetails?.phone],['Business email',report.businessDetails?.email],['Description',report.description],['Reporter',report.reporter?.hideNameFromPublic ? 'Name hidden from public' : report.reporter?.name],['Reporter email',report.reporter?.email],['Moderator note',report.adminNote],['Demo record',report.isDemo ? 'Yes' : 'No'],
    ].filter(([,value]) => value !== undefined && value !== null && value !== '');
    const groups = pairs.map(([label,value]) => `<div class="admin-detail-item"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('');
    const nestedGroup = (title, value, excluded = []) => {
      if (!value || typeof value !== 'object') return '';
      const fields = Object.entries(value).filter(([key,entry]) => !excluded.includes(key) && entry !== '' && entry !== null && entry !== undefined && typeof entry !== 'object')
        .map(([key,entry]) => `<div class="admin-detail-item"><dt>${esc(key.replace(/([A-Z])/g,' $1').replace(/^./,char=>char.toUpperCase()))}</dt><dd>${esc(typeof entry === 'boolean' ? (entry ? 'Yes' : 'No') : entry)}</dd></div>`).join('');
      return fields ? `<section class="admin-detail-group"><h3>${esc(title)}</h3><dl class="admin-detail-list">${fields}</dl></section>` : '';
    };
    const history = (report.moderationHistory || []).map(item => `<li><strong>${esc(item.action)}</strong><span>${date(item.createdAt)}${item.by?.name ? ` · ${esc(item.by.name)}` : ''}</span>${item.note ? `<p>${esc(item.note)}</p>` : ''}</li>`).join('');
    const evidence = (report.evidenceAttachments || []).map((item,index) => evidenceItem(report,item,index)).join('');
    $('#reportDialogTitle').textContent = report.reportId || 'Report details';
    state.reports = [...state.reports.filter(item => item._id !== report._id), report];
    $('#reportDetails').innerHTML = `<h3>Case summary</h3><dl class="admin-detail-list">${groups}</dl><div class="admin-detail-groups">${nestedGroup('Business details',report.businessDetails)}${nestedGroup('Incident details',report.incidentDetails)}${nestedGroup('Previous complaints',report.previousComplaints)}${nestedGroup('Reporter details',report.reporter,['hideNameFromPublic','shareContactWithModerators'])}</div>${history ? `<h3>Moderation history</h3><ol class="admin-timeline">${history}</ol>` : ''}${report.reporterResponses?.length ? `<h3>Reporter responses</h3><ul>${report.reporterResponses.map(r => `<li>${esc(r.text)} · ${date(r.createdAt)}</li>`).join('')}</ul>` : ''}<h3>Private evidence</h3>${evidence ? `<div class="admin-evidence-files admin-detail-evidence">${evidence}</div>` : '<p class="admin-muted">No evidence files were attached to this report.</p>'}`;
    $('#adminReportDialog').showModal();
    loadEvidenceMedia($('#reportDetails'));
  }
  async function showReport(id) { try { const data = await api(`/api/reports/${encodeURIComponent(id)}`); fillReport(data.report); } catch (error) { message(error.message, true); } }
  function confirm(title, copy, button = 'Confirm') {
    return new Promise(resolve => { const dialog = $('#adminConfirmDialog'); $('#adminConfirmTitle').textContent = title; $('#adminConfirmCopy').textContent = copy; $('#adminConfirmProceed').textContent = button; dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once:true }); dialog.showModal(); });
  }
  function actionDialog(id, status) {
    state.actionReport = id; state.action = status;
    $('#adminActionTitle').textContent = status === 'Verified' ? 'Verify report' : 'Reject report';
    $('#adminActionCopy').textContent = status === 'Verified' ? 'Confirm that you have reviewed the submitted details and evidence.' : 'Record a moderator reason for rejecting this report.';
    $('#adminNoteField').hidden = status !== 'Rejected'; $('#adminNoteField textarea').required = status === 'Rejected'; $('#adminNoteField textarea').value = '';
    $('#adminActionSubmit').textContent = status === 'Verified' ? 'Verify report' : 'Reject report'; $('#adminActionDialog').showModal();
  }
  async function runReportAction(event) {
    event.preventDefault(); if (!state.actionReport || state.busy) return; state.busy = true;
    const button = $('#adminActionSubmit'); button.disabled = true;
    try { await api(`/api/reports/${encodeURIComponent(state.actionReport)}/status`, { method:'PATCH', body:JSON.stringify({ status:state.action, adminNote:$('#adminNoteField textarea').value.trim() }) }); $('#adminActionDialog').close(); state.loaded.delete('overview'); state.loaded.delete('reports'); state.loaded.delete('evidence'); await Promise.all([loadOverview(), ...(document.querySelector('[data-admin-view="reports"]')?.hidden ? [] : [loadReports()])]); message(`Report marked ${state.action.toLowerCase()}.`); }
    catch (error) { message(error.message, true); } finally { button.disabled = false; state.busy = false; }
  }
  async function removeReport(id) { if (!await confirm('Delete this report?', 'This permanently removes the report and its stored evidence files.', 'Delete report')) return; try { await api(`/api/reports/${encodeURIComponent(id)}`, { method:'DELETE' }); state.loaded.delete('overview'); state.loaded.delete('reports'); state.loaded.delete('evidence'); await loadSection('reports', true); message('Report and associated evidence deleted.'); } catch (error) { message(error.message, true); } }
  async function evidenceBlob(id, index) { const response = await fetch(`/api/reports/${encodeURIComponent(id)}/evidence/${index}`, { headers:{ Authorization:`Bearer ${token()}` }, cache:'no-store' }); if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.message || 'Evidence could not be loaded.'); } return response.blob(); }
  async function previewEvidence(button) {
    try {
      const id = button.dataset.evidence; const index = Number(button.dataset.evidenceIndex); const report = [...(state.evidenceReports || []), ...(state.reports || [])].find(r => r._id === id);
      const file = report?.evidenceAttachments?.[index]; if (!file) throw new Error('Evidence metadata is unavailable.');
      if (['apk','executable'].includes(fileKind(file))) { const blob = await evidenceBlob(id,index); const url = URL.createObjectURL(blob); state.objectUrls.push(url); const a = document.createElement('a'); a.href=url; a.download=file.originalName || 'quarantined-evidence.bin'; a.click(); message('Quarantined file downloaded. Do not open or execute it.'); return; }
      const blob = await evidenceBlob(id,index); const url = URL.createObjectURL(blob); state.objectUrls.push(url); const type = fileKind(file); const body = $('#adminPreviewBody');
      $('#adminPreviewTitle').textContent = file.originalName || 'Evidence preview';
      body.replaceChildren();
      if (type === 'image') { const image = new Image(); image.src=url; image.alt=file.originalName || 'Evidence image'; image.className='admin-preview-media'; body.append(image); }
      else if (type === 'audio') { const audio = document.createElement('audio'); audio.controls=true; audio.src=url; body.append(audio); }
      else if (type === 'pdf') { const frame = document.createElement('iframe'); frame.src=url; frame.title=file.originalName || 'PDF evidence'; frame.className='admin-preview-frame'; body.append(frame); }
      else if (String(file.mimeType).startsWith('video/')) { const video=document.createElement('video'); video.controls=true; video.src=url; video.className='admin-preview-media'; body.append(video); }
      else { body.innerHTML = `<p>${esc(file.originalName || 'File')} cannot be previewed in the browser.</p><a class="admin-primary-button" download="${esc(file.originalName || 'evidence')}" href="${url}">Download file</a>`; }
      $('#adminEvidencePreview').showModal();
    } catch (error) { message(error.message, true); }
  }
  async function legacyDownload(id) { try { const response = await fetch(`/api/reports/${encodeURIComponent(id)}/evidence`, { headers:{ Authorization:`Bearer ${token()}` }, cache:'no-store' }); if (!response.ok) throw new Error('The legacy evidence file could not be downloaded.'); const blob=await response.blob(), url=URL.createObjectURL(blob); state.objectUrls.push(url); const a=document.createElement('a'); a.href=url; a.download='report-evidence'; a.click(); } catch(error) { message(error.message,true); } }
  function resetBusiness(hide = false) { const form=$('#businessForm'); form.reset(); form.dataset.id=''; $('#businessFormTitle').textContent='Add business record'; $('#businessSubmit').textContent='Add record'; $('#cancelBusinessEdit').hidden=true; if (hide) form.hidden=true; }
  function editBusiness(button) { try { const business=JSON.parse(button.dataset.business); $('#businessForm').hidden=false; $('#businessForm').dataset.id=business._id; for (const field of ['name','ownerName','category','location','description']) { const input=$(`#businessForm [name="${field}"]`); if (input) input.value=business[field] || ''; } $('#businessFormTitle').textContent='Edit business record'; $('#businessSubmit').textContent='Save changes'; $('#cancelBusinessEdit').hidden=false; $('#businessForm').scrollIntoView({ behavior:'smooth', block:'center' }); } catch { message('Business record could not be opened for editing.',true); } }
  async function saveBusiness(event) { event.preventDefault(); const form=event.currentTarget; if (state.busy) return; const payload=Object.fromEntries(new FormData(form).entries()); const id=form.dataset.id; state.busy=true; $('#businessSubmit').disabled=true; try { await api(id?`/api/businesses/${encodeURIComponent(id)}`:'/api/businesses', { method:id?'PUT':'POST', body:JSON.stringify(payload) }); resetBusiness(true); await loadBusinesses(); message(id?'Business record updated.':'Business record added.'); } catch(error) { message(error.message,true); } finally { state.busy=false; $('#businessSubmit').disabled=false; } }
  async function removeBusiness(id, name) { if (!await confirm('Delete business record?', `${name} will be removed from the directory. Linked reports will remain, with their business link cleared.`, 'Delete record')) return; try { await api(`/api/businesses/${encodeURIComponent(id)}`,{method:'DELETE'}); await loadBusinesses(); message('Business record deleted.'); } catch(error) { message(error.message,true); } }
  async function downloadPdf() { const button=$('#downloadFraudPdf'); button.disabled=true; try { const response=await fetch('/api/admin/reports.pdf',{headers:{Authorization:`Bearer ${token()}`},cache:'no-store'}); if (!response.ok) { const d=await response.json().catch(()=>({})); throw new Error(d.message || 'Report PDF could not be downloaded.'); } const blob=await response.blob(), url=URL.createObjectURL(blob); state.objectUrls.push(url); const a=document.createElement('a'); a.href=url; a.download='scam-saver-fraud-report.pdf'; a.click(); } catch(error) { message(error.message,true); } finally { button.disabled=false; } }
  async function refreshCurrent() { state.loaded.delete('overview'); state.loaded.delete('reports'); state.loaded.delete('evidence'); state.loaded.delete('businesses'); state.loaded.delete('users'); state.loaded.delete('analytics'); state.loaded.delete('map'); await loadSection(location.hash.slice(1) || 'overview',true); }

  function initialize() {
    let user={}; try { user=JSON.parse(localStorage.getItem('ss_admin_user') || localStorage.getItem('ss_user') || '{}'); } catch {}
    if (!token()) { location.replace('admin-login.html?next=admin.html'); return; }
    state.user=user; $('#userGreeting').textContent=user.name ? `Hi, ${user.name}` : ''; $('#adminWelcome').textContent=user.name ? `Welcome, ${user.name}` : 'Administrator overview';
    const userRole=String(user.role || '').toLowerCase();
    $('#adminThemeToggle').checked=localStorage.getItem('ss_theme') === 'light';
    $('#adminAutoRefresh').checked=localStorage.getItem('ss_admin_auto_refresh') === 'true';
    $$('[data-admin-tab]').forEach(tab=>tab.addEventListener('click',()=>selectTab(tab.dataset.adminTab)));
    $('#adminSectionNav').addEventListener('keydown',event=>{ if(!['ArrowLeft','ArrowRight'].includes(event.key))return; const tabs=$$('[data-admin-tab]'); const index=tabs.indexOf(document.activeElement); const next=(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length; tabs[next].focus(); tabs[next].click(); });
    $('#adminRefresh').addEventListener('click',refreshCurrent); $('#refreshReports').addEventListener('click',()=>loadSection('reports',true)); $('#refreshEvidence').addEventListener('click',()=>loadSection('evidence',true)); $('#refreshBusinesses').addEventListener('click',()=>loadSection('businesses',true)); $('#refreshUsers').addEventListener('click',()=>loadSection('users',true)); $('#refreshAnalytics').addEventListener('click',()=>loadSection('analytics',true)); $('#refreshMapManagement').addEventListener('click',()=>loadSection('map',true));
    $('#reportFilters').addEventListener('submit',event=>{event.preventDefault();loadSection('reports',true)}); $('#reportSearch').addEventListener('input',renderReportResults); $('#reportStatus').addEventListener('change',renderReportResults); $('#reportSort').addEventListener('change',renderReportResults); $('#clearReportFilters').addEventListener('click',()=>{ $('#reportSearch').value=''; $('#reportStatus').value=''; $('#reportSort').value='newest'; renderReportResults(); });
    $('#evidenceSearch').addEventListener('input',renderEvidenceResults); $('#evidenceType').addEventListener('change',renderEvidenceResults); $('#businessFilters').addEventListener('submit',event=>{event.preventDefault();state.businessesPage=1;loadSection('businesses',true)}); $('#businessPrev').addEventListener('click',()=>{state.businessesPage=Math.max(1,state.businessesPage-1);loadSection('businesses',true)}); $('#businessNext').addEventListener('click',()=>{state.businessesPage=Math.min(state.businessPages,state.businessesPage+1);loadSection('businesses',true)}); $('#businessForm').addEventListener('submit',saveBusiness); $('#resetBusinessForm').addEventListener('click',()=>resetBusiness()); $('#cancelBusinessEdit').addEventListener('click',()=>resetBusiness(true)); $('#showBusinessForm').addEventListener('click',()=>{ $('#businessForm').hidden=false; $('#businessForm').scrollIntoView({behavior:'smooth',block:'center'}); }); $('#userSearch').addEventListener('input',renderUsers); $('#reportActionForm').addEventListener('submit',runReportAction); $('#downloadFraudPdf').addEventListener('click',downloadPdf);
    $('#adminThemeToggle').addEventListener('change',event=>{const theme=event.target.checked?'light':'dark';localStorage.setItem('ss_theme',theme);document.documentElement.dataset.theme=theme;}); $('#adminAutoRefresh').addEventListener('change',event=>{localStorage.setItem('ss_admin_auto_refresh',String(event.target.checked));});
    $('#adminLogout').addEventListener('click',async()=>{if(!await confirm('Log out?', 'End this administrator session on this browser.', 'Log out'))return;clearActiveSession();location.replace('admin-login.html');});
    document.addEventListener('click',event=>{
      const target=event.target.closest('button'); if(!target)return;
      if(target.dataset.openView) selectTab(target.dataset.openView);
      if(target.dataset.viewReport) showReport(target.dataset.viewReport);
      if(target.dataset.reportAction) actionDialog(target.dataset.reportId,target.dataset.reportAction);
      if(target.dataset.deleteReport) removeReport(target.dataset.deleteReport);
      if(target.dataset.evidence) previewEvidence(target);
      if(target.dataset.legacyEvidence) legacyDownload(target.dataset.legacyEvidence);
      if(target.dataset.editBusiness) editBusiness(target);
      if(target.dataset.deleteBusiness) removeBusiness(target.dataset.deleteBusiness,target.dataset.businessName || 'This business');
      if(target.dataset.closeDialog) document.getElementById(target.dataset.closeDialog)?.close();
      if(target.dataset.retry) loadSection(target.dataset.retry,true);
    });
    document.addEventListener('close',event=>{ if(event.target.id==='adminEvidencePreview'){ $('#adminPreviewBody').replaceChildren(); state.objectUrls.splice(0).forEach(url=>URL.revokeObjectURL(url)); } },true);
    const tab=location.hash.slice(1); const initial=['overview','reports','evidence','businesses','users','analytics','map','settings'].includes(tab)?tab:'overview';
    if (userRole === 'user') { location.replace('dashboard.html'); return; }
    selectTab(initial,false);
    api('/api/admin/stats').then(stats=>{ state.stats=stats; if(!state.loaded.has('overview'))renderStats(stats); }).catch(error=>message(error.message,true));
    if ($('#adminAutoRefresh').checked) state.autoRefresh=setInterval(()=>{if(!document.hidden)refreshCurrent();},60000);
    $('#adminAutoRefresh').addEventListener('change',()=>{clearInterval(state.autoRefresh);if($('#adminAutoRefresh').checked)state.autoRefresh=setInterval(()=>{if(!document.hidden)refreshCurrent();},60000);});
  }
  function bootAfterAuthorization() {
    if (document.documentElement.classList.contains('auth-checking')) {
      window.addEventListener('scam-saver:auth-ready', initialize, { once:true });
      return;
    }
    initialize();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',bootAfterAuthorization,{once:true}); else bootAfterAuthorization();
})();
