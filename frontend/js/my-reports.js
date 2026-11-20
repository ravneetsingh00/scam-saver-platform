(() => {
  const root = document.getElementById('myReports');
  if (!root) return;
  const token = localStorage.getItem('ss_token') || '';
  const objectUrls = new Set();
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const date = value => value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
  const size = value => `${(Number(value || 0) / (1024 * 1024)).toFixed(2)} MB`;
  const formatDuration = seconds => {
    if (!Number.isFinite(seconds) || seconds < 0) return '';
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  };
  function attachment(report, file, index) {
    const url = `/api/reports/${encodeURIComponent(report._id)}/evidence/${index}`;
    const apk = file.quarantined || file.mimeType === 'application/vnd.android.package-archive';
    const mime = String(file.mimeType || '').toLowerCase();
    const image = mime.startsWith('image/');
    const audio = mime.startsWith('audio/');
    const video = mime.startsWith('video/');
    const name = escape(file.originalName || 'Evidence file');
    let visual = `<span class="case-attachment-icon${apk ? ' evidence-apk-tile' : ''}">${apk ? 'APK · QUARANTINED' : escape((mime.split('/')[1] || 'FILE').toUpperCase())}</span>`;
    if (image) visual = `<a class="case-evidence-preview-link" href="${url}" data-evidence data-filename="${name}"><img class="case-evidence-thumb" data-private-evidence="${url}" alt="Evidence image: ${name}"><span class="sr-only">Open image preview</span></a>`;
    else if (audio) visual = `<div class="case-evidence-player"><audio controls preload="metadata" data-private-evidence="${url}" aria-label="Audio evidence: ${name}"></audio><small data-audio-duration></small></div>`;
    else if (video) visual = `<video class="case-evidence-thumb" controls playsinline preload="metadata" data-private-evidence="${url}" aria-label="Video evidence: ${name}"></video>`;
    const evidenceUrl = file.legacy ? `/api/reports/${encodeURIComponent(report._id)}/evidence` : url;
    const download = apk
      ? `<a href="${evidenceUrl}" data-evidence-download data-filename="${name}">Secure download ↓</a>`
      : `<a href="${evidenceUrl}" data-evidence data-filename="${name}">View / download ↗</a>`;
    return `<article class="case-attachment">${visual}<div><strong>${name}</strong><small>${escape(file.mimeType || 'File')} · ${size(file.size)}${file.uploadedAt ? ` · Uploaded ${date(file.uploadedAt)}` : ''}${apk ? ' · Quarantined' : ''}</small>${file.description ? `<p>${escape(file.description)}</p>` : ''}${download}</div></article>`;
  }
  function attachmentsFor(report) {
    const files = Array.isArray(report.evidenceAttachments) ? [...report.evidenceAttachments] : [];
    if (!files.length && report.evidence) {
      const originalName = String(report.evidence).split(/[\\/]/).pop();
      const extension = originalName.split('.').pop()?.toLowerCase();
      const mimeType = ({ jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp', mp3:'audio/mpeg', m4a:'audio/mp4', aac:'audio/aac', wav:'audio/wav', ogg:'audio/ogg', webm:'audio/webm', mp4:'video/mp4', mov:'video/quicktime', pdf:'application/pdf' })[extension] || 'application/octet-stream';
      files.push({ originalName, mimeType, size: 0, legacy: true });
    }
    return files;
  }
  function render(report) {
    const files = attachmentsFor(report);
    const attachments = files.length ? `<div class="case-attachment-grid">${files.map((file, index) => attachment(report, file, index)).join('')}</div>` : '<p class="muted">No evidence files were attached.</p>';
    return `<article class="card my-report-card"><div class="business-case-head"><div><div class="eyebrow">REPORT ${escape(report.reportId || '')}</div><h2>${escape(report.businessName || 'Saved report')}</h2><p class="muted">${escape(report.fraudType || 'Category not set')} · ${escape(report.location || 'Location not set')}</p></div><span class="pill ${report.status === 'Verified' ? 'green' : report.status === 'Rejected' ? 'red' : 'amber'}">${escape(report.status)}</span></div><p class="form-note">Submitted ${date(report.createdAt)} · Incident date ${date(report.incidentDate)}</p><a class="btn secondary" href="report-details.html?id=${encodeURIComponent(report._id)}">Open full report details →</a><details class="my-report-details"><summary>View report details${files.length ? ` and ${files.length} evidence file${files.length === 1 ? '' : 's'}` : ''}</summary><div class="my-report-detail-body"><h3>Incident description</h3><p class="case-narrative">${escape(report.description || 'No description provided.')}</p><h3>Evidence attachments</h3>${attachments}</div></details></article>`;
  }
  async function loadPrivateMedia() {
    const media = [...root.querySelectorAll('[data-private-evidence]')];
    await Promise.all(media.map(async element => {
      try {
        const response = await fetch(element.dataset.privateEvidence, { headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-store' } });
        if (!response.ok) throw new Error('Evidence is unavailable.');
        const objectUrl = URL.createObjectURL(await response.blob());
        objectUrls.add(objectUrl);
        element.src = objectUrl;
        if (element instanceof HTMLAudioElement) {
          element.addEventListener('loadedmetadata', () => {
            const duration = element.parentElement.querySelector('[data-audio-duration]');
            if (duration) duration.textContent = `Duration ${formatDuration(element.duration)}`;
          }, { once: true });
        }
        element.addEventListener('error', () => showUnavailable(element), { once: true });
      } catch { showUnavailable(element); }
    }));
  }
  function showUnavailable(element) {
    const fallback = document.createElement('span');
    fallback.className = 'case-attachment-icon evidence-missing';
    fallback.textContent = element instanceof HTMLImageElement ? 'Image unavailable' : element instanceof HTMLAudioElement ? 'Audio unavailable' : 'Video unavailable';
    element.replaceWith(fallback);
  }
  fetch('/api/reports/my', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
    .then(async response => { const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.message || 'Your reports could not be loaded.'); return data; })
    .then(async data => {
      const reports = Array.isArray(data.reports) ? data.reports : [];
      root.innerHTML = reports.length ? `<div class="my-report-list">${reports.map(render).join('')}</div>` : '<div class="empty card">You have not submitted any reports yet. <a href="report.html">Submit a report →</a></div>';
      root.querySelectorAll('details.my-report-details').forEach(details => details.addEventListener('toggle', () => {
        if (!details.open || details.dataset.mediaLoaded) return;
        details.dataset.mediaLoaded = 'true';
        loadPrivateMedia(details);
      }));
    })
    .catch(error => { root.innerHTML = `<div class="notice">${escape(error.message)} <button type="button" class="secondary" id="retryMyReports">Try again</button></div>`; document.getElementById('retryMyReports')?.addEventListener('click', () => location.reload()); });

  root.addEventListener('click', async event => {
    const link = event.target.closest('a[data-evidence-download]');
    if (!link) return;
    event.preventDefault();
    try {
      const response = await fetch(link.href, { headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-store' } });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.message || 'This private evidence could not be downloaded.'); }
      const objectUrl = URL.createObjectURL(await response.blob()); objectUrls.add(objectUrl);
      const download = document.createElement('a'); download.href = objectUrl; download.download = link.dataset.filename || 'quarantined-evidence.apk'; document.body.append(download); download.click(); download.remove(); setTimeout(() => { URL.revokeObjectURL(objectUrl); objectUrls.delete(objectUrl); }, 60000);
    } catch (error) { window.alert(error.message); }
  });
  window.addEventListener('pagehide', () => { for (const url of objectUrls) URL.revokeObjectURL(url); objectUrls.clear(); }, { once: true });
})();
