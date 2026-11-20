const path = require('path');
const fs = require('fs/promises');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const Report = require('./models/Report');
const storage = require('./utils/evidenceStorage');

const root = path.resolve(__dirname, '..');
const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, 'uploads'));
const apply = process.argv.includes('--apply');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(root, '.local-backups', `evidence-migration-${stamp}`);
const supported = mime => /^(image\/|audio\/|video\/|application\/pdf)/.test(mime || '');

function cloudFields(result, item) {
  return {
    storageProvider: 'cloudinary', secureUrl: result.secure_url, publicId: result.public_id,
    resourceType: result.resource_type, deliveryType: result.type || 'authenticated',
    format: result.format || storage.extension(item.originalName || item.filename),
  };
}
async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else if (entry.isFile() && entry.name !== '.gitkeep') out.push(full);
  }
  return out;
}
async function main() {
  if (apply && !storage.isCloudinaryConfigured()) throw new Error('Cloudinary credentials are missing; no migration changes were made.');
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is missing from the root .env.');
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const reports = await Report.find({}).lean();
    const references = new Map();
    let referencedCount = 0;
    for (const report of reports) {
      const items = [...(report.evidenceAttachments || [])];
      if (!items.length && report.evidence) {
        const ext = storage.extension(report.evidence);
        const mimeType = ({ jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp', mp3:'audio/mpeg', m4a:'audio/mp4', aac:'audio/aac', wav:'audio/wav', ogg:'audio/ogg', webm:'audio/webm', mp4:'video/mp4', mov:'video/quicktime', pdf:'application/pdf' })[ext] || 'application/octet-stream';
        items.push({ filename: path.basename(report.evidence), originalName: path.basename(report.evidence), mimeType });
      }
      items.forEach((item, index) => {
        if (!item.filename) return;
        const filename = path.basename(item.filename);
        const key = path.resolve(item.quarantined ? path.join(uploadDir, 'quarantine', filename) : path.join(uploadDir, filename));
        if (!references.has(key)) references.set(key, []);
        references.get(key).push({ report, item, index, legacy: !(report.evidenceAttachments || []).length });
        referencedCount++;
      });
    }
    const files = await walk(uploadDir);
    const missing = [...references.keys()].filter(file => !files.includes(file));
    const unmatched = files.filter(file => !references.has(path.resolve(file)));
    const tasks = [];
    for (const [file, matches] of references) for (const match of matches) {
      if (match.item.storageProvider === 'cloudinary' && match.item.publicId) continue;
      if (!supported(match.item.mimeType)) continue;
      tasks.push({ file, ...match });
    }
    const alreadyInCloud = reports.reduce((count, report) => count + (report.evidenceAttachments || []).filter(item => item.storageProvider === 'cloudinary' && item.publicId).length, 0);
    const summary = {
      database: mongoose.connection.name,
      reports: reports.length,
      filesFound: files.length,
      referencedEvidenceFiles: referencedCount,
      uploadCandidates: tasks.length,
      alreadyInCloud,
      missingReferencedFiles: missing.length,
      unmatchedFiles: unmatched.length,
      mode: apply ? 'apply' : 'dry-run',
    };
    if (!apply) {
      console.log(JSON.stringify({ summary, unmatched: unmatched.map(file => path.relative(uploadDir, file)), missing: missing.map(file => path.relative(uploadDir, file)) }, null, 2));
      return;
    }
    await fs.mkdir(path.dirname(backupDir), { recursive: true, mode: 0o700 });
    await fs.cp(uploadDir, path.join(backupDir, 'uploads'), { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
    const metadataBackup = reports.map(report => ({ _id: report._id, reportId: report.reportId, evidence: report.evidence, evidenceAttachments: report.evidenceAttachments }));
    await fs.writeFile(path.join(backupDir, 'report-evidence-metadata.json'), JSON.stringify(metadataBackup, null, 2), { flag: 'wx', mode: 0o600 });
    let uploaded = 0, failed = 0;
    const errors = [];
    for (const task of tasks) {
      try {
        const publicId = storage.deterministicPublicId(String(task.report._id), task.item.filename);
        let result;
        try {
          result = await storage.uploadLocalFile(task.file, { mimeType: task.item.mimeType, originalName: task.item.originalName, publicId });
        } catch (uploadError) {
          // A retry after a successful upload but failed DB write reuses the deterministic asset.
          result = await storage.cloudinaryClient().api.resource(publicId, { resource_type: storage.resourceType(task.item.mimeType), type: 'authenticated' });
          if (!result.public_id) throw uploadError;
        }
        const fields = cloudFields(result, task.item);
        if (task.legacy) {
          const updated = await Report.updateOne({ _id: task.report._id, evidence: task.item.filename, 'evidenceAttachments.0': { $exists: false } }, { $set: { evidenceAttachments: [{ ...task.item, ...fields }] } });
          if (!updated.modifiedCount) throw new Error('Report metadata changed during migration; review before retrying.');
        } else {
          const prefix = `evidenceAttachments.${task.index}`;
          const updated = await Report.updateOne({ _id: task.report._id, [`${prefix}.filename`]: task.item.filename }, { $set: Object.fromEntries(Object.entries(fields).map(([key, value]) => [`${prefix}.${key}`, value])) });
          if (!updated.modifiedCount) throw new Error('Report attachment changed during migration; review before retrying.');
        }
        uploaded++;
      } catch (error) {
        failed++;
        errors.push({ reportId: task.report.reportId, filename: task.item.filename, reason: error.message });
      }
    }
    console.log(JSON.stringify({ summary: { ...summary, uploaded, failed, backupDir: path.relative(root, backupDir) }, errors }, null, 2));
    if (failed) process.exitCode = 2;
  } finally {
    await mongoose.disconnect();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
