const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const Report = require('../models/Report');
const Business = require('../models/Business');
const Investigation = require('../models/Investigation');
const { protect, adminOnly } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const makeReportId = require('../utils/reportId');
const makeCasePdf = require('../utils/caseSummaryPdf');
const { organizeIncident } = require('../utils/openaiInvestigation');
const evidenceStorage = require('../utils/evidenceStorage');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../uploads'));
const quarantineDir = path.join(uploadDir, 'quarantine');
const apkMime = 'application/vnd.android.package-archive';
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'video/mp4', 'video/webm', 'video/quicktime', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/ogg', 'audio/webm', apkMime]);
const mimeAliases = { 'audio/x-m4a': 'audio/mp4', 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav', 'audio/vnd.wave': 'audio/wav', 'audio/x-aac': 'audio/aac' };
const mimeByExtension = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.apk': apkMime };
function normalizedMime(file) {
  const received = String(file.mimetype || '').toLowerCase().split(';')[0].trim();
  const alias = mimeAliases[received] || received;
  return allowedTypes.has(alias) ? alias : (mimeByExtension[path.extname(file.originalname || '').toLowerCase()] || alias);
}
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 5, fields: 50 },
  fileFilter: (req, file, cb) => {
    const isApk = /\.apk$/i.test(file.originalname || '') && [apkMime, 'application/octet-stream', 'application/zip'].includes(file.mimetype);
    const accepted = allowedTypes.has(normalizedMime(file)) || isApk;
    cb(accepted ? null : Object.assign(new Error('Evidence must be a supported image, PDF, video, audio file or APK.'), { status: 400 }), accepted);
  },
});
const submissionLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 12, standardHeaders: true, legacyHeaders: false });
const duplicateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false });
const assistantLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false });
const mapReadLimit = rateLimit({ windowMs: 60 * 1000, max: 50, standardHeaders: true, legacyHeaders: false });
const fraudTypes = ['Online Shopping Fraud', 'Property Fraud', 'Payment Fraud', 'Investment Fraud', 'Job Fraud', 'Identity Fraud', 'Other'];
const statuses = ['Pending', 'Needs Information', 'Under Review', 'Verified', 'Rejected', 'Cancelled'];
const safeText = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sensitiveSecrets = text => /\b(?:password|passcode|one[- ]time\s+(?:password|code)|otp|cvv|cvc|security\s+code|bank\s+login|net\s+banking\s+credentials)\b\s*(?:is|:|=)\s*\S+/i.test(String(text || ''))
  || /\b(?:full\s+card\s+number|card\s+number)\b\s*(?:is|:|=)\s*(?:\d[ -]?){12,19}/i.test(String(text || ''));
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
const validWebsite = value => { if (!value) return true; try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol); } catch { return false; } };

function payloadFrom(req) {
  let payload = req.body.payload;
  if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { throw Object.assign(new Error('The case form could not be read. Please review it and try again.'), { status: 400 }); } }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Object.assign(new Error('Case information is required.'), { status: 400 });
  return payload;
}

function cleanPayload(input, user) {
  const b = input.businessDetails || {};
  const i = input.incidentDetails || {};
  const c = input.previousComplaints || {};
  const d = input.descriptionAnswers || {};
  const name = safeText(b.name, 240);
  const category = safeText(b.category, 80);
  const date = safeText(i.date, 40);
  const fraudType = safeText(i.fraudType, 50);
  const description = safeText(input.description, 50000);
  const incidentDate = date ? new Date(date) : null;
  const city = safeText(b.city, 100);
  const state = safeText(b.state, 100);
  const location = safeText([i.location, city, state].filter(Boolean).join(', '), 240);
  const invalid = [];
  if (name.length > 240 || (input.draft !== true && name.length < 2)) invalid.push('Enter a business or person name (2 to 240 characters).');
  if (input.draft !== true && category.length < 2) invalid.push('Choose or enter a business category.');
  if (input.draft !== true && (!incidentDate || Number.isNaN(incidentDate.getTime()))) invalid.push('Enter a valid incident date.');
  if (input.draft !== true && incidentDate && incidentDate.getTime() > Date.now()) invalid.push('Incident date cannot be in the future.');
  if (input.draft !== true && !fraudTypes.includes(fraudType)) invalid.push('Choose a valid fraud category.');
  if (input.draft !== true && !location) invalid.push('Enter the incident location or business city and state.');
  if (b.email && !validEmail(b.email)) invalid.push('Enter a valid business contact email.');
  if (!validWebsite(safeText(b.website, 240))) invalid.push('Website must start with http:// or https://.');
  const amountText = safeText(i.amount, 40);
  const amount = amountText ? Number(amountText) : null;
  const amountInvolved = i.amountInvolved === true || i.amountInvolved === 'true';
  if (input.draft !== true && amountInvolved && !amountText) invalid.push('Enter the amount involved.');
  if (input.draft !== true && amountInvolved && !safeText(i.paymentMethod, 80)) invalid.push('Choose how the amount was given.');
  if (amountText && (!Number.isFinite(amount) || amount < 0 || amount > 1e12)) invalid.push('Enter a valid incident amount.');
  const sensitiveContent = [description, ...Object.values(d), i.currentSituation, c.resolutionAttempts].filter(Boolean).join(' ');
  if (sensitiveSecrets(sensitiveContent)) invalid.push('Remove passwords, one-time codes, CVVs, full card numbers and banking credentials.');
  if (invalid.length) throw Object.assign(new Error(invalid[0]), { status: 400 });
  const details = {
    business: {
      entityType: safeText(b.entityType, 40) || 'Business', ownerContact: safeText(b.ownerContact, 120),
      phone: safeText(b.phone, 40), phone2: safeText(b.phone2, 40), email: safeText(b.email, 254).toLowerCase(), website: safeText(b.website, 240),
      address: safeText(b.address, 240), city, state, pinCode: safeText(b.pinCode, 20), gstin: safeText(b.gstin, 20).toUpperCase(),
    },
    incident: {
      time: safeText(i.time, 20), location: safeText(i.location, 240), paymentMethod: safeText(i.paymentMethod, 80), amountInvolved,
      transactionReference: safeText(i.transactionReference, 120), upiId: safeText(i.upiId, 120), currentSituation: safeText(i.currentSituation, 1000),
      howContacted: safeText(d.howContacted, 500), whatPromised: safeText(d.whatPromised, 500), whatHappened: safeText(d.whatHappened, 500), stepsTaken: safeText(d.stepsTaken, 1000),
    },
    complaints: {
      hasComplaint: c.hasComplaint === true || c.hasComplaint === 'true',
      officialReference: safeText(c.officialReference, 120), cybercrimeStatus: safeText(c.cybercrimeStatus, 80), firStatus: safeText(c.firStatus, 80), resolutionAttempts: safeText(c.resolutionAttempts, 1500),
    },
    reporter: {
      name: safeText(user.name, 80), email: safeText(user.email, 254).toLowerCase(), phone: safeText(input.reporterPhone, 40), address: safeText(input.reporterAddress, 300),
      hideNameFromPublic: input.hideNameFromPublic !== false, shareContactWithModerators: input.shareContactWithModerators !== false,
    },
    name, category, location, incidentDate, fraudType, amount, amountCurrency: safeText(i.amountCurrency, 3).toUpperCase() || 'INR', description,
  };
  return details;
}

function fileSignature(file) {
  const bytes = file.buffer;
  if (/\.apk$/i.test(file.originalname || '') && [apkMime, 'application/octet-stream', 'application/zip'].includes(file.mimetype)) {
    return bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  }
  const mimeType = normalizedMime(file);
  if (mimeType === 'image/jpeg') return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/webp') return bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (mimeType === 'application/pdf') return bytes.subarray(0, 5).toString() === '%PDF-';
  if (['video/mp4', 'video/quicktime', 'audio/mp4'].includes(mimeType)) return bytes.subarray(4, 8).toString() === 'ftyp';
  if (mimeType === 'video/webm' || mimeType === 'audio/webm') return bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (mimeType === 'audio/mpeg') return bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  if (mimeType === 'audio/aac') return bytes.length > 2 && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
  if (mimeType === 'audio/wav') return bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WAVE';
  if (mimeType === 'audio/ogg') return bytes.subarray(0, 4).toString() === 'OggS';
  return false;
}

async function storeFiles(files, descriptions = []) {
  if (!files?.length) return [];
  await fs.mkdir(uploadDir, { recursive: true, mode: 0o700 });
  await fs.chmod(uploadDir, 0o700);
  const stored = [];
  try {
    for (const [index, file] of files.entries()) {
      if (!fileSignature(file)) throw Object.assign(new Error(`Attachment “${safeText(file.originalname, 80)}” does not match its declared file type.`), { status: 400 });
      const isApk = /\.apk$/i.test(file.originalname || '') && [apkMime, 'application/octet-stream', 'application/zip'].includes(file.mimetype);
      const mimeType = isApk ? apkMime : normalizedMime(file);
      const ext = ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf', 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/aac': '.aac', 'audio/wav': '.wav', 'audio/ogg': '.ogg', 'audio/webm': '.webm', [apkMime]: '.apk' })[mimeType];
      const filename = `${crypto.randomUUID()}${ext}`;
      const directory = isApk ? quarantineDir : uploadDir;
      if (isApk) { await fs.mkdir(quarantineDir, { recursive: true, mode: 0o700 }); await fs.chmod(quarantineDir, 0o700); }
      await fs.writeFile(path.join(directory, filename), file.buffer, { flag: 'wx', mode: 0o600 });
      const item = { filename, originalName: path.basename(file.originalname.replace(/\\/g, '/')).slice(0, 180), mimeType, size: file.size, description: safeText(descriptions[index], 240), uploadedAt: new Date(), quarantined: isApk, storageProvider: 'local' };
      stored.push(item);
      const cloudRequired = process.env.EVIDENCE_STORAGE === 'cloudinary';
      if (!isApk && (evidenceStorage.isCloudinaryConfigured() || cloudRequired)) {
        let result;
        try { result = await evidenceStorage.uploadBuffer(file.buffer, { mimeType, originalName: item.originalName, publicId: `scam-saver/evidence/${crypto.randomUUID()}` }); }
        catch { throw Object.assign(new Error('Secure cloud storage is unavailable. The evidence was not submitted; try again later.'), { status: 503 }); }
        Object.assign(item, { storageProvider: 'cloudinary', secureUrl: result.secure_url, publicId: result.public_id, resourceType: result.resource_type, deliveryType: result.type || 'authenticated', format: result.format || path.extname(filename).slice(1) });
      }
    }
    return stored;
  } catch (error) {
    await Promise.all(stored.map(item => fs.unlink(path.join(item.quarantined ? quarantineDir : uploadDir, item.filename)).catch(() => {})));
    throw error;
  }
}

function evidencePath(item) {
  return path.join(item.quarantined ? quarantineDir : uploadDir, path.basename(item.filename));
}

async function includeLegacyEvidence(report) {
  const value = report?.toObject ? report.toObject() : report;
  if (!value || value.evidenceAttachments?.length || !value.evidence) return value;
  const filename = path.basename(String(value.evidence));
  const mimeType = mimeByExtension[path.extname(filename).toLowerCase()] || 'application/octet-stream';
  const filePath = path.join(uploadDir, filename);
  const stats = await fs.stat(filePath).catch(() => null);
  value.evidenceAttachments = [{
    filename,
    originalName: filename,
    mimeType,
    size: stats?.size || 0,
    uploadedAt: value.createdAt || value.updatedAt || null,
    description: '',
    quarantined: false,
    legacy: true,
  }];
  return value;
}

function caseFields(details) {
  return {
    businessName: details.name, category: details.category, location: details.location,
    incidentDate: details.incidentDate, fraudType: details.fraudType, amount: details.amount, amountCurrency: details.amountCurrency,
    description: details.description, contactEmail: details.reporter.email,
    businessDetails: details.business, incidentDetails: details.incident,
    previousComplaints: details.complaints, reporter: details.reporter,
  };
}

async function businessReference(details) {
  if (!details.name) return null;
  const match = await Business.findOne({ name: { $regex: `^${escapeRegex(details.name)}$`, $options: 'i' }, isDemo: { $ne: true } }).select('_id').lean();
  return match?._id || null;
}

async function findMatches(payload, excludeId = null) {
  const details = cleanPayload({ ...payload, draft: true }, { name: '', email: '' });
  const terms = [];
  if (details.name) terms.push({ businessName: { $regex: `^${escapeRegex(details.name)}$`, $options: 'i' } });
  if (details.business.website) terms.push({ 'businessDetails.website': { $regex: `^${escapeRegex(details.business.website)}$`, $options: 'i' } });
  if (details.business.phone) terms.push({ 'businessDetails.phone': details.business.phone });
  if (details.incident.transactionReference) terms.push({ 'incidentDetails.transactionReference': details.incident.transactionReference });
  if (details.incident.upiId) terms.push({ 'incidentDetails.upiId': details.incident.upiId });
  if (!terms.length) return [];
  const query = { $or: terms, status: { $ne: 'Draft' } };
  if (excludeId) query._id = { $ne: excludeId };
  const rows = await Report.find(query).select('reportId businessName category status createdAt businessDetails.website businessDetails.phone incidentDetails.transactionReference incidentDetails.upiId').sort({ createdAt: -1 }).limit(6).lean();
  return rows.map(row => {
    const matchReasons = [];
    if (details.name && row.businessName.toLowerCase() === details.name.toLowerCase()) matchReasons.push('Matching business or person name');
    if (details.business.website && row.businessDetails?.website?.toLowerCase() === details.business.website.toLowerCase()) matchReasons.push('Matching website');
    if (details.business.phone && row.businessDetails?.phone === details.business.phone) matchReasons.push('Matching phone number');
    if (details.incident.transactionReference && row.incidentDetails?.transactionReference === details.incident.transactionReference) matchReasons.push('Matching transaction reference');
    if (details.incident.upiId && row.incidentDetails?.upiId === details.incident.upiId) matchReasons.push('Matching UPI ID');
    return { businessName: row.businessName, category: row.category, createdAt: row.createdAt, matchReasons };
  });
}

async function ownerOrAdmin(req, res, report) {
  if (!report) { res.status(404).json({ message: 'Case not found.' }); return false; }
  if (report.isDemo === true) return true;
  const submittedBy = report.submittedBy?._id || report.submittedBy;
  if (req.user.role !== 'admin' && String(submittedBy) !== String(req.user._id)) { res.status(403).json({ message: 'You cannot access this case.' }); return false; }
  return true;
}

function applyReporterPrivacy(report) {
  const value = report?.toObject ? report.toObject() : report;
  if (!value?.reporter?.shareContactWithModerators) {
    if (value?.reporter) { value.reporter.email = ''; value.reporter.phone = ''; value.reporter.address = ''; }
    value.contactEmail = '';
  }
  return value;
}

function redactDemoReporter(report) {
  const value = report?.toObject ? report.toObject() : { ...report };
  value.reporter = { hideNameFromPublic: true, shareContactWithModerators: false };
  value.contactEmail = '';
  if (value.submittedBy) value.submittedBy = { name: 'SCAM SAVER demo', role: 'demo' };
  return value;
}

router.post('/assistant/organize', protect, assistantLimit, asyncHandler(async (req, res) => {
  const description = safeText(req.body.description, 5000);
  if (sensitiveSecrets(description)) return res.status(400).json({ message: 'Remove passwords, one-time codes, CVVs, full card numbers and banking credentials before using the assistant.' });
  const text = await organizeIncident({
    fraudType: safeText(req.body.fraudType, 50),
    incidentDate: safeText(req.body.incidentDate, 40), incidentDetails: req.body.incidentDetails || {}, description,
  });
  res.set('Cache-Control', 'private, no-store').json({ text, generatedByAI: true });
}));

router.post('/duplicates', protect, duplicateLimit, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'private, no-store').json({ matches: await findMatches(req.body) });
}));

router.post('/', protect, submissionLimit, upload.array('evidence', 5), asyncHandler(async (req, res) => {
  let files = [];
  try {
    const payload = payloadFrom(req);
    const details = cleanPayload(payload, req.user);
    if (payload.draft === true) {
      files = await storeFiles(req.files, payload.evidenceDescriptions || []);
      const report = await Report.create({ reportId: makeReportId(), submittedBy: req.user._id, ...caseFields(details), business: await businessReference(details), status: 'Draft', evidenceAttachments: files, evidence: files[0]?.filename || null, moderationHistory: [{ action: 'Draft saved', by: req.user._id }] });
      return res.status(201).json({ report: { id: report._id, reportId: report.reportId, status: report.status } });
    }
    files = await storeFiles(req.files, payload.evidenceDescriptions || []);
    const report = await Report.create({ reportId: makeReportId(), submittedBy: req.user._id, ...caseFields(details), business: await businessReference(details), status: 'Pending', evidenceAttachments: files, evidence: files[0]?.filename || null, moderationHistory: [{ action: 'Submitted for human review', by: req.user._id }] });
    res.status(201).json({ message: 'Your case was submitted for human review.', report: { id: report._id, reportId: report.reportId, status: report.status } });
  } catch (error) {
    await Promise.all(files.map(item => fs.unlink(evidencePath(item)).catch(() => {})));
    throw error;
  }
}));

router.patch('/:id/draft', protect, submissionLimit, upload.array('evidence', 5), asyncHandler(async (req, res) => {
  const report = await Report.findById(req.params.id);
  if (!(await ownerOrAdmin(req, res, report))) return;
  if (report.status !== 'Draft' || String(report.submittedBy) !== String(req.user._id)) return res.status(409).json({ message: 'Only your saved draft can be edited.' });
  let files = [];
  try {
    const payload = payloadFrom(req);
    const details = cleanPayload({ ...payload, draft: true }, req.user);
    if (report.evidenceAttachments.length + (report.evidence && !report.evidenceAttachments.length ? 1 : 0) + (req.files?.length || 0) > 5) {
      return res.status(400).json({ message: 'A case can have no more than five evidence files.' });
    }
    files = await storeFiles(req.files, payload.evidenceDescriptions || []);
    Object.assign(report, caseFields(details));
    report.business = await businessReference(details);
    report.evidenceAttachments.push(...files);
    if (!report.evidence && files[0]) report.evidence = files[0].filename;
    report.moderationHistory.push({ action: 'Draft updated', by: req.user._id });
    await report.save();
    res.json({ report: { id: report._id, reportId: report.reportId, status: report.status } });
  } catch (error) {
    await Promise.all(files.map(item => fs.unlink(evidencePath(item)).catch(() => {})));
    throw error;
  }
}));

router.post('/:id/submit', protect, submissionLimit, asyncHandler(async (req, res) => {
  const report = await Report.findById(req.params.id);
  if (!(await ownerOrAdmin(req, res, report))) return;
  if (String(report.submittedBy) !== String(req.user._id) || report.status !== 'Draft') return res.status(409).json({ message: 'Only your saved draft can be submitted.' });
  const input = {
    businessDetails: { name: report.businessName, category: report.category, ...report.businessDetails.toObject() },
    incidentDetails: { date: report.incidentDate, fraudType: report.fraudType, location: report.incidentDetails.location, amount: report.amount, ...report.incidentDetails.toObject() },
    descriptionAnswers: report.incidentDetails.toObject(), previousComplaints: report.previousComplaints.toObject(), description: report.description,
  };
  const details = cleanPayload(input, req.user);
  report.status = 'Pending';
  report.contactEmail = req.user.email;
  report.reporter.email = req.user.email;
  report.moderationHistory.push({ action: 'Submitted for human review', by: req.user._id });
  await report.save();
  res.json({ message: 'Your case was submitted for human review.', report: { id: report._id, reportId: report.reportId, status: report.status } });
}));

router.post('/:id/response', protect, submissionLimit, asyncHandler(async (req, res) => {
  const report = await Report.findById(req.params.id);
  if (!(await ownerOrAdmin(req, res, report))) return;
  if (String(report.submittedBy) !== String(req.user._id)) return res.status(403).json({ message: 'Only the reporter can respond to this request.' });
  if (report.status !== 'Needs Information') return res.status(409).json({ message: 'There is no open request for additional information on this case.' });
  const text = safeText(req.body.text, 3000);
  if (text.length < 2) return res.status(400).json({ message: 'Enter the additional case information before submitting.' });
  if (sensitiveSecrets(text)) return res.status(400).json({ message: 'Remove passwords, one-time codes, CVVs, full card numbers and banking credentials.' });
  report.reporterResponses.push({ text, by: req.user._id });
  report.moderationHistory.push({ action: 'Additional information submitted', by: req.user._id });
  await report.save();
  res.json({ message: 'Additional information was added to the case timeline.', reportId: report.reportId });
}));

// Business detail pages may show evidence only for reports the current user owns,
// or all linked reports to an administrator. Public directory counts stay coarse.
router.get('/business/:businessId/authorized', protect, asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.businessId)) return res.status(400).json({ message: 'The business ID is invalid.' });
  const filter = { business: req.params.businessId, status: { $ne: 'Draft' } };
  if (req.user.role !== 'admin') filter.$or = [{ submittedBy: req.user._id }, { isDemo: true }];
  const reports = await Report.find(filter).select('reportId business businessName category description incidentDate fraudType status createdAt isDemo evidence evidenceAttachments moderationHistory').sort({ createdAt: -1 }).limit(100).lean();
  const withLegacy = await Promise.all(reports.map(includeLegacyEvidence));
  res.set('Cache-Control', 'private, no-store').json({ reports: withLegacy });
}));

router.get('/:id/investigations', protect, asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'The report ID is invalid.' });
  const report = await Report.findById(req.params.id);
  if (!(await ownerOrAdmin(req, res, report))) return;
  const filter = { report: report._id };
  if (req.user.role !== 'admin') filter.user = req.user._id;
  const investigations = await Investigation.find(filter).sort({ createdAt: -1 }).limit(50).lean();
  res.set('Cache-Control', 'private, no-store').json({ investigations });
}));

router.get('/map-data', mapReadLimit, asyncHandler(async (req, res) => {
  const cleanFilter = value => safeText(value, 80).replace(/[<>]/g, '');
  const selectedState = cleanFilter(req.query.state).toLocaleLowerCase();
  const selectedCity = cleanFilter(req.query.city).toLocaleLowerCase();
  const selectedCategory = cleanFilter(req.query.category).toLocaleLowerCase();
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  let fromDate = null, untilDate = null;
  if (req.query.from && validDate(req.query.from)) fromDate = new Date(`${req.query.from}T00:00:00+05:30`);
  if (req.query.to && validDate(req.query.to)) { untilDate = new Date(`${req.query.to}T00:00:00+05:30`); untilDate.setTime(untilDate.getTime() + 24 * 60 * 60 * 1000); }

  // Only project coarse location and public aggregate fields. Reporter identity,
  // contact details, exact addresses, descriptions, evidence and report IDs stay private.
  const rows = await Report.find({ status: { $ne: 'Draft' }, isDemo: { $ne: true } })
    .select('businessDetails.city businessDetails.state location fraudType createdAt')
    .sort({ createdAt: -1 }).lean();
  const safeLocationText = value => safeText(value, 80).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  const cityNames = new Set('delhi|new delhi|delhi ncr|mumbai|thane|navi mumbai|pune|nashik|nagpur|chhatrapati sambhajinagar|aurangabad|bengaluru|bangalore|mysuru|mysore|mangaluru|mangalore|hubballi|hubli|belagavi|belgaum|davanagere|chennai|coimbatore|madurai|tiruchirappalli|trichy|salem|erode|tirunelveli|hyderabad|warangal|karimnagar|visakhapatnam|vizag|vijayawada|guntur|tirupati|kurnool|nellore|ahmedabad|surat|vadodara|baroda|rajkot|gandhinagar|bhavnagar|jaipur|jodhpur|udaipur|kota|ajmer|bikaner|lucknow|kanpur|varanasi|agra|prayagraj|allahabad|meerut|noida|ghaziabad|bareilly|gorakhpur|mathura|gurugram|gurgaon|faridabad|panipat|ambala|chandigarh|ludhiana|amritsar|jalandhar|patiala|dehradun|haridwar|shimla|srinagar|jammu|bhopal|indore|gwalior|jabalpur|ujjain|rewa|patna|gaya|muzaffarpur|ranchi|jamshedpur|dhanbad|kolkata|howrah|siliguri|durgapur|asansol|bhubaneswar|cuttack|puri|raipur|bilaspur|guwahati|shillong|imphal|aizawl|agartala|itanagar|kohima|gangtok|panaji|port blair|kochi|cochin|thiruvananthapuram|trivandrum|kozhikode|calicut|thrissur|kannur'.split('|'));
  const statesByAlias = new Map(Object.entries({
    'andhra pradesh':'Andhra Pradesh','arunachal pradesh':'Arunachal Pradesh','assam':'Assam','bihar':'Bihar','chhattisgarh':'Chhattisgarh','goa':'Goa','gujarat':'Gujarat','haryana':'Haryana','himachal pradesh':'Himachal Pradesh','jharkhand':'Jharkhand','karnataka':'Karnataka','kerala':'Kerala','madhya pradesh':'Madhya Pradesh','maharashtra':'Maharashtra','manipur':'Manipur','meghalaya':'Meghalaya','mizoram':'Mizoram','nagaland':'Nagaland','odisha':'Odisha','orissa':'Odisha','punjab':'Punjab','rajasthan':'Rajasthan','sikkim':'Sikkim','tamil nadu':'Tamil Nadu','telangana':'Telangana','tripura':'Tripura','uttar pradesh':'Uttar Pradesh','uttarakhand':'Uttarakhand','west bengal':'West Bengal','andaman and nicobar islands':'Andaman and Nicobar Islands','andaman & nicobar islands':'Andaman and Nicobar Islands','chandigarh':'Chandigarh','dadra and nagar haveli and daman and diu':'Dadra and Nagar Haveli and Daman and Diu','delhi':'Delhi','national capital territory of delhi':'Delhi','jammu and kashmir':'Jammu and Kashmir','j&k':'Jammu and Kashmir','ladakh':'Ladakh','lakshadweep':'Lakshadweep','puducherry':'Puducherry','pondicherry':'Puducherry','ap':'Andhra Pradesh','ar':'Arunachal Pradesh','as':'Assam','br':'Bihar','cg':'Chhattisgarh','ga':'Goa','gj':'Gujarat','hr':'Haryana','hp':'Himachal Pradesh','jh':'Jharkhand','ka':'Karnataka','kl':'Kerala','mp':'Madhya Pradesh','mh':'Maharashtra','mn':'Manipur','ml':'Meghalaya','mz':'Mizoram','nl':'Nagaland','od':'Odisha','pb':'Punjab','rj':'Rajasthan','sk':'Sikkim','tn':'Tamil Nadu','ts':'Telangana','tr':'Tripura','up':'Uttar Pradesh','uk':'Uttarakhand','wb':'West Bengal','dl':'Delhi'
  }));
  const normalized = rows.map(report => {
    const placeParts = safeLocationText(report.location).split(',').map(part => part.trim()).filter(Boolean);
    const rawState = safeLocationText(report.businessDetails?.state || (placeParts.length > 1 ? placeParts.at(-1) : ''));
    const state = statesByAlias.get(rawState.toLocaleLowerCase()) || '';
    const rawCity = safeLocationText(report.businessDetails?.city || (placeParts.length > 1 ? placeParts.at(-2) : ''));
    const city = cityNames.has(rawCity.toLocaleLowerCase()) ? rawCity : '';
    return { city, state, category: fraudTypes.includes(report.fraudType) ? report.fraudType : 'Other', createdAt: report.createdAt };
  });
  const states = [...new Set(normalized.map(item => item.state).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const cities = [...new Map(normalized.filter(item => item.city).map(item => [`${item.city.toLocaleLowerCase()}|${item.state.toLocaleLowerCase()}`, { city: item.city, state: item.state }])).values()].sort((a, b) => a.city.localeCompare(b.city));
  const categories = [...new Set(normalized.map(item => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const filtered = normalized.filter(item => (!selectedState || item.state.toLocaleLowerCase() === selectedState)
    && (!selectedCity || item.city.toLocaleLowerCase() === selectedCity)
    && (!selectedCategory || item.category.toLocaleLowerCase() === selectedCategory)
    && (!fromDate || new Date(item.createdAt) >= fromDate)
    && (!untilDate || new Date(item.createdAt) < untilDate));
  const groups = new Map(), categoryCounts = new Map();
  for (const item of filtered) {
    categoryCounts.set(item.category, (categoryCounts.get(item.category) || 0) + 1);
    if (!item.city || !item.state) continue;
    const key = `${item.city.toLocaleLowerCase()}|${item.state.toLocaleLowerCase()}`;
    if (!groups.has(key)) groups.set(key, { city: item.city, state: item.state, reportCount: 0, latestReportDate: item.createdAt, categoryCounts: {} });
    const location = groups.get(key); location.reportCount += 1;
    location.categoryCounts[item.category] = (location.categoryCounts[item.category] || 0) + 1;
    if (new Date(item.createdAt) > new Date(location.latestReportDate)) location.latestReportDate = item.createdAt;
  }
  const todayText = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const todayStart = new Date(`${todayText}T00:00:00+05:30`);
  const todayEnd = new Date(todayStart); todayEnd.setTime(todayEnd.getTime() + 24 * 60 * 60 * 1000);
  const mostReportedCategory = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || null;
  const locations = [...groups.values()].map(location => ({
    ...location,
    mostReportedCategory: Object.entries(location.categoryCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || 'Other',
  })).sort((a, b) => b.reportCount - a.reportCount || a.city.localeCompare(b.city));
  const indiaDate = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  for (const location of locations) location.latestReportDate = indiaDate(location.latestReportDate);
  const recent = filtered.slice(0, 20).map(item => ({ city: item.city || null, state: item.state || null, category: item.category, submittedAt: indiaDate(item.createdAt) }));
  res.set('Cache-Control', 'private, no-store').json({
    generatedAt: new Date(), dataLabel: 'Latest submitted reports', totalReports: filtered.length,
    highActivityLocations: locations.filter(location => location.reportCount >= 10).length,
    reportsToday: filtered.filter(item => new Date(item.createdAt) >= todayStart && new Date(item.createdAt) < todayEnd).length,
    mostReportedCategory, locations, recent, states, cities, categories,
    reportsWithoutCityOrState: filtered.filter(item => !item.city || !item.state).length,
  });
}));

router.get('/my', protect, asyncHandler(async (req, res) => {
  const rows = await Report.find({ submittedBy: req.user._id }).populate('moderationHistory.by', 'name role').populate('reporterResponses.by', 'name').sort({ updatedAt: -1 }).select('-contactEmail').lean();
  const reports = await Promise.all(rows.map(includeLegacyEvidence));
  res.set('Cache-Control', 'private, no-store').json({ reports });
}));

// Privacy-safe, database-backed summary for the authenticated dashboard. This
// exposes aggregate case signals only; reporter details, narratives, evidence,
// exact incident locations and report IDs remain private.
router.get('/community-summary', protect, asyncHandler(async (req, res) => {
  const match = { status: { $ne: 'Draft' }, isDemo: { $ne: true }, businessName: { $type: 'string', $ne: '' } };
  const [summaryRows, businessesWithReports, recentReports] = await Promise.all([
    Report.aggregate([
      { $match: match },
      { $group: {
        _id: null,
        total: { $sum: 1 },
        verified: { $sum: { $cond: [{ $eq: ['$status', 'Verified'] }, 1, 0] } },
        awaitingReview: { $sum: { $cond: [{ $in: ['$status', ['Pending', 'Needs Information', 'Under Review']] }, 1, 0] } },
      } },
    ]),
    Report.aggregate([{ $match: match }, { $group: { _id: { $toLower: { $trim: { input: '$businessName' } } } } }, { $count: 'total' }]),
    Report.find(match)
      .select('business businessName category fraudType status createdAt incidentDetails.location businessDetails.city businessDetails.state')
      .sort({ createdAt: -1 }).limit(8).lean(),
  ]);
  const summary = summaryRows[0] || { total: 0, verified: 0, awaitingReview: 0 };
  res.set('Cache-Control', 'private, no-store').json({
    statistics: {
      totalReports: summary.total || 0,
      verifiedReports: summary.verified || 0,
      awaitingReview: summary.awaitingReview || 0,
      businessesWithReports: businessesWithReports[0]?.total || 0,
    },
    recentReports: recentReports.map(report => {
      let city = safeText(report.businessDetails?.city, 80);
      let state = safeText(report.businessDetails?.state, 80);
      if (!city && !state) {
        // The report's incident location is collected as a city/state field.
        // Never fall back to the business address when preparing a public summary.
        const parts = safeText(report.incidentDetails?.location, 240).split(',').map(part => part.trim()).filter(Boolean);
        const looksLikeAddress = /\d|\b(?:street|st\.?|road|rd\.?|lane|flat|apartment|house|plot|floor|near|behind)\b/i.test(parts.join(' '));
        if (parts.length >= 2 && parts.length <= 3 && !looksLikeAddress) [city, state] = parts.slice(-2).map(part => safeText(part, 80));
        else if (parts.length === 1 && !looksLikeAddress) city = safeText(parts[0], 80);
      }
      return {
        businessId: report.business || null,
        businessName: report.businessName,
        category: report.category || report.fraudType || 'Other',
        city, state, status: report.status, submittedAt: report.createdAt,
      };
    }),
  });
}));

// Year and category aggregates for the authenticated dashboard. Windows are
// Jan 1 through the same UTC calendar day in each year so the current partial
// year is compared with equivalent elapsed periods. Exact repeat submissions
// by one reporter for the same business, fraud type and incident day collapse
// when their transaction reference or description matches. Reporter details
// are only used server-side and are never returned from this endpoint.
router.get('/yearly-comparison', protect, asyncHandler(async (req, res) => {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const years = Array.from({ length: Math.max(0, currentYear - 2022 + 1) }, (_, index) => 2022 + index);
  if (!years.length) return res.json({ years: [], categories: [], periodLabel: '' });

  const cutoffMonth = now.getUTCMonth();
  const cutoffDay = now.getUTCDate();
  const yearWindows = years.map(year => {
    const day = Math.min(cutoffDay, new Date(Date.UTC(year, cutoffMonth + 1, 0)).getUTCDate());
    return { year, end: new Date(Date.UTC(year, cutoffMonth, day + 1)) };
  });
  const start = new Date(Date.UTC(2022, 0, 1));
  const end = yearWindows.at(-1).end;
  const windowMatches = yearWindows.map(({ year, end: windowEnd }) => ({
    $expr: { $and: [
      { $eq: [{ $year: { date: '$createdAt', timezone: 'UTC' } }, year] },
      { $lt: ['$createdAt', windowEnd] },
    ] },
  }));

  const rows = await Report.aggregate([
    { $match: { status: { $ne: 'Draft' }, isDemo: { $ne: true }, createdAt: { $gte: start, $lt: end }, reportId: { $type: 'string', $ne: '' } } },
    { $sort: { createdAt: 1, _id: 1 } },
    { $addFields: {
      duplicateDescription: { $toLower: { $trim: { input: { $ifNull: ['$description', ''] } } } },
      duplicateBusinessName: { $toLower: { $trim: { input: { $ifNull: ['$businessName', ''] } } } },
      duplicateFraudType: { $toLower: { $trim: { input: { $ifNull: ['$fraudType', ''] } } } },
      duplicateTransactionReference: { $toLower: { $trim: { input: { $ifNull: ['$incidentDetails.transactionReference', ''] } } } },
      duplicateIncidentDay: { $dateToString: { format: '%Y-%m-%d', date: { $ifNull: ['$incidentDate', '$createdAt'] }, timezone: 'UTC' } },
    } },
    { $group: { _id: {
      reporter: '$submittedBy', business: '$duplicateBusinessName', fraudType: '$duplicateFraudType', incidentDay: '$duplicateIncidentDay',
      reference: '$duplicateTransactionReference',
      description: { $cond: [
        { $ne: ['$duplicateTransactionReference', ''] }, '',
        { $cond: [{ $ne: ['$duplicateDescription', ''] }, '$duplicateDescription', { $toString: '$_id' }] },
      ] },
    }, report: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$report' } },
    { $match: { $or: windowMatches } },
    { $addFields: {
      reportYear: { $year: { date: '$createdAt', timezone: 'UTC' } },
      categoryText: { $toLower: { $concat: [
        { $ifNull: ['$fraudType', ''] }, ' ', { $ifNull: ['$incidentDetails.paymentMethod', ''] },
      ] } },
    } },
    { $addFields: {
      comparisonCategory: { $switch: {
        branches: [
          { case: { $or: [{ $regexMatch: { input: '$categoryText', regex: 'upi' } }, { $ne: [{ $ifNull: ['$incidentDetails.upiId', ''] }, ''] }, { $regexMatch: { input: { $ifNull: ['$incidentDetails.paymentMethod', ''] }, regex: '^upi$', options: 'i' } }] }, then: 'UPI' },
          { case: { $regexMatch: { input: '$categoryText', regex: 'bank' } }, then: 'Banking' },
          { case: { $regexMatch: { input: '$categoryText', regex: 'investment' } }, then: 'Investment' },
          { case: { $regexMatch: { input: '$categoryText', regex: 'job|employment' } }, then: 'Job' },
          { case: { $regexMatch: { input: '$categoryText', regex: 'shopping|e-commerce|ecommerce|retail' } }, then: 'Shopping' },
        ],
        default: null,
      } },
    } },
    { $group: {
      _id: '$reportYear',
      total: { $sum: 1 },
      upi: { $sum: { $cond: [{ $eq: ['$comparisonCategory', 'UPI'] }, 1, 0] } },
      banking: { $sum: { $cond: [{ $eq: ['$comparisonCategory', 'Banking'] }, 1, 0] } },
      investment: { $sum: { $cond: [{ $eq: ['$comparisonCategory', 'Investment'] }, 1, 0] } },
      job: { $sum: { $cond: [{ $eq: ['$comparisonCategory', 'Job'] }, 1, 0] } },
      shopping: { $sum: { $cond: [{ $eq: ['$comparisonCategory', 'Shopping'] }, 1, 0] } },
    } },
    { $sort: { _id: 1 } },
  ], { allowDiskUse: true });

  const byYear = new Map(rows.map(row => [row._id, row]));
  const available = yearWindows.map(({ year }) => {
    const row = byYear.get(year);
    return row ? {
      year, total: row.total,
      categories: { upi: row.upi, banking: row.banking, investment: row.investment, job: row.job, shopping: row.shopping },
    } : null;
  }).filter(Boolean);
  const categories = [
    { id: 'all', label: 'All reports' }, { id: 'upi', label: 'UPI' }, { id: 'banking', label: 'Banking' },
    { id: 'investment', label: 'Investment' }, { id: 'job', label: 'Job' }, { id: 'shopping', label: 'Shopping' },
  ];
  const chartYears = available.map((item, index) => {
    const previous = byYear.get(item.year - 1);
    const percentChange = (value, previousValue) => previousValue > 0 ? Math.round(((value - previousValue) / previousValue) * 1000) / 10 : null;
    return {
      ...item,
      isCurrentYear: item.year === currentYear,
      changePercent: percentChange(item.total, previous?.total || 0),
      categoryChanges: Object.fromEntries(['upi', 'banking', 'investment', 'job', 'shopping'].map(key => [key, percentChange(item.categories[key], previous?.[key] || 0)])),
    };
  });
  const periodEnd = yearWindows.at(-1).end;
  const endLabel = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(periodEnd.getTime() - 86400000));
  res.set('Cache-Control', 'private, no-store').json({
    years: chartYears, categories, currentYear,
    periodLabel: `Jan 1–${endLabel} (UTC) each year`,
    dataLabel: 'Community-reported incidents, not confirmed national crime statistics. Category totals include only reports with an identifiable matching category.',
  });
}));

router.get('/', protect, adminOnly, asyncHandler(async (req, res) => {
  const filter = { status: { $ne: 'Draft' } };
  if (statuses.includes(req.query.status)) filter.status = req.query.status;
  const evidenceOnly = req.query.evidence === 'true';
  if (evidenceOnly) filter.$or = [{ 'evidenceAttachments.0': { $exists: true } }, { evidence: { $type: 'string', $ne: '' } }];
  if (req.query.q) {
    const query = escapeRegex(String(req.query.q).trim().slice(0, 100));
    const search = [{ businessName: { $regex: query, $options: 'i' } }, { reportId: { $regex: query, $options: 'i' } }, { fraudType: { $regex: query, $options: 'i' } }];
    filter.$and = [...(filter.$or ? [{ $or: filter.$or }] : []), { $or: search }];
    delete filter.$or;
  }
  const limit = Math.min(250, Math.max(1, Number.parseInt(req.query.limit, 10) || 250));
  const fields = evidenceOnly
    ? 'reportId businessName status createdAt isDemo evidence evidenceAttachments'
    : 'reportId business businessName category location incidentDate fraudType status createdAt isDemo evidenceAttachments';
  const rows = await Report.find(filter).select(fields).populate('submittedBy', 'name').sort({ createdAt: -1 }).limit(limit).lean();
  const reports = await Promise.all(rows.map(includeLegacyEvidence));
  res.json({ reports: reports.map(applyReporterPrivacy) });
}));

router.get('/:id/pdf', protect, asyncHandler(async (req, res) => {
  const report = await Report.findById(req.params.id).populate('submittedBy', 'name email').populate('moderationHistory.by', 'name role').populate('reporterResponses.by', 'name');
  if (!(await ownerOrAdmin(req, res, report))) return;
  const pdf = makeCasePdf(req.user.role === 'admin' ? applyReporterPrivacy(report) : report.isDemo ? redactDemoReporter(report) : report);
  res.status(200).type('application/pdf').set({ 'Content-Disposition': `attachment; filename="${report.reportId}-case-summary.pdf"`, 'Cache-Control': 'private, no-store' }).send(pdf);
}));

router.get('/:id/evidence/:index', protect, asyncHandler(async (req, res) => {
  const report = await Report.findById(req.params.id);
  if (!(await ownerOrAdmin(req, res, report))) return;
  const index = Number(req.params.index);
  const item = Number.isInteger(index) && index >= 0
    ? (report.evidenceAttachments[index] || (index === 0 && report.evidence ? { filename: path.basename(report.evidence), mimeType: mimeByExtension[path.extname(report.evidence).toLowerCase()] || 'application/octet-stream', quarantined: false } : null))
    : null;
  if (!item) return res.status(404).json({ message: 'Evidence was not found.' });
  const isApk = item.quarantined === true || item.mimeType === apkMime;
  const safeName = path.basename(String(item.originalName || 'evidence').replace(/\\/g, '/')).replace(/[\r\n";]/g, '_');
  if (item.storageProvider === 'cloudinary') {
    if (!item.publicId) return res.status(404).json({ message: 'Cloud evidence metadata is incomplete.' });
    const signedUrl = evidenceStorage.privateDownloadUrl(item.toObject ? item.toObject() : item, 900);
    const upstream = await fetch(signedUrl, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!upstream.ok || !upstream.body) return res.status(502).json({ message: 'Private cloud evidence is temporarily unavailable.' });
    res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'", 'Content-Disposition': `inline; filename="${safeName}"`, 'Content-Type': isApk ? 'application/octet-stream' : item.mimeType });
    if (upstream.headers.get('content-length')) res.set('Content-Length', upstream.headers.get('content-length'));
    return pipeline(Readable.fromWeb(upstream.body), res);
  }
  const filePath = evidencePath(item);
  if (!(await fs.stat(filePath).catch(() => null))) return res.status(404).json({ message: 'This evidence file is no longer available.' });
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'", 'Content-Disposition': `attachment; filename="${safeName}"` });
  res.type(isApk ? 'application/octet-stream' : item.mimeType).sendFile(filePath);
}));

router.get('/:id/evidence', protect, asyncHandler(async (req, res) => {
  const report = await Report.findById(req.params.id);
  if (!(await ownerOrAdmin(req, res, report))) return;
  if (report.evidenceAttachments.length || report.evidence) return res.redirect(307, `/api/reports/${report._id}/evidence/0`);
  return res.status(404).json({ message: 'Evidence was not found.' });
}));

router.get('/:id', protect, asyncHandler(async (req, res) => {
  const report = await Report.findById(req.params.id).populate('submittedBy', 'name email').populate('moderationHistory.by', 'name role').populate('reporterResponses.by', 'name');
  if (!(await ownerOrAdmin(req, res, report))) return;
  const reportWithEvidence = await includeLegacyEvidence(report);
  const response = req.user.role === 'admin' ? applyReporterPrivacy(reportWithEvidence) : report.isDemo ? redactDemoReporter(reportWithEvidence) : reportWithEvidence;
  res.set('Cache-Control', 'private, no-store').json({ report: response });
}));

router.patch('/:id/status', protect, adminOnly, asyncHandler(async (req, res) => {
  const status = safeText(req.body.status, 40);
  const adminNote = safeText(req.body.adminNote, 1200);
  if (!statuses.includes(status)) return res.status(400).json({ message: 'Choose a valid case review status.' });
  if (['Rejected', 'Cancelled', 'Needs Information'].includes(status) && !adminNote.trim()) return res.status(400).json({ message: 'Add a reason or information request for this decision.' });
  const report = await Report.findById(req.params.id);
  if (!report || report.status === 'Draft') return res.status(404).json({ message: 'Submitted case not found.' });
  report.status = status;
  report.adminNote = adminNote;
  report.moderationHistory.push({ action: status, note: adminNote, by: req.user._id });
  await report.save();
  await report.populate('submittedBy', 'name email');
  res.json({ report });
}));

router.delete('/:id', protect, adminOnly, asyncHandler(async (req, res) => {
  const report = await Report.findByIdAndDelete(req.params.id);
  if (!report) return res.status(404).json({ message: 'Case not found.' });
  const attachments = report.evidenceAttachments || [];
  await Promise.all(attachments.map(item => fs.unlink(evidencePath(item)).catch(error => { if (error.code !== 'ENOENT') throw error; })));
  if (report.evidence && !attachments.some(item => item.filename === report.evidence)) await fs.unlink(path.join(uploadDir, path.basename(report.evidence))).catch(error => { if (error.code !== 'ENOENT') throw error; });
  res.json({ message: `Case ${report.reportId} was deleted.` });
}));

module.exports = router;
