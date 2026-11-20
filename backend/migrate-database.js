const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const sourceUri = process.env.SOURCE_MONGODB_URI || 'mongodb://127.0.0.1:27017';
const sourceDbName = process.env.SOURCE_DB_NAME || 'scam-saver';
const targetUri = process.env.MONGODB_URI;
const targetDbName = process.env.TARGET_DB_NAME || 'Scam-Saver';
const collections = ['users', 'businesses', 'reports', 'investigations'];
const apply = process.argv.includes('--apply');

function latestBackupPath() {
  const marker = path.resolve(__dirname, '../.local-backups/LATEST_PRE_MIGRATION');
  if (!fs.existsSync(marker)) throw new Error('Pre-migration backup marker is missing. Create source and target backups before importing.');
  const folder = fs.readFileSync(marker, 'utf8').trim();
  const root = path.resolve(path.dirname(marker), folder);
  const required = ['local-source/scam-saver/reports.bson', 'local-source/scam-saver/businesses.bson', 'local-uploads', 'atlas-test/test/users.bson', 'atlas-scam-search/scam-search/All+scams.bson', 'atlas-Scam-Saver/snapshot.ejson'];
  for (const relative of required) {
    if (!fs.existsSync(path.join(root, relative))) throw new Error(`Pre-migration backup is incomplete (${relative}).`);
  }
  return root;
}

function naturalKey(collection, doc) {
  if (collection === 'users') return doc.email ? String(doc.email).trim().toLowerCase() : null;
  if (collection === 'reports') return doc.reportId ? String(doc.reportId).trim().toLowerCase() : null;
  if (collection === 'businesses') return doc.name ? `${String(doc.name).trim().toLowerCase()}|${Boolean(doc.isDemo)}` : null;
  return null;
}

function canonical(value) {
  if (value instanceof Date) return { $date: value.toISOString() };
  if (value?._bsontype === 'ObjectId') return { $oid: value.toHexString() };
  if (Buffer.isBuffer(value)) return { $binary: value.toString('base64') };
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

function sameDocument(a, b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

async function run() {
  if (!targetUri) throw new Error('MONGODB_URI is missing from the project root .env.');
  const backup = latestBackupPath();
  const sourceClient = new MongoClient(sourceUri, { serverSelectionTimeoutMS: 8000 });
  const targetClient = new MongoClient(targetUri, { serverSelectionTimeoutMS: 10000 });
  try {
    await Promise.all([sourceClient.connect(), targetClient.connect()]);
    const source = sourceClient.db(sourceDbName);
    const target = targetClient.db(targetDbName);
    const documents = {};
    const existing = {};
    const sourceTotals = {};
    const alreadyPresent = {};
    const conflicts = [];

    for (const name of collections) {
      documents[name] = await source.collection(name).find({}).toArray();
      sourceTotals[name] = documents[name].length;
      existing[name] = await target.collection(name).find({}).toArray();
      alreadyPresent[name] = 0;
      const targetById = new Map(existing[name].map(doc => [String(doc._id), doc]));
      for (const doc of documents[name]) {
        const prior = targetById.get(String(doc._id));
        if (prior && !sameDocument(prior, doc)) conflicts.push(`${name}: existing _id differs`);
        else if (prior) alreadyPresent[name] += 1;
      }
      const sourceKeys = new Set();
      const targetKeys = new Map();
      for (const doc of existing[name]) {
        const key = naturalKey(name, doc);
        if (key) targetKeys.set(key, String(doc._id));
      }
      for (const doc of documents[name]) {
        const key = naturalKey(name, doc);
        if (!key) continue;
        if (sourceKeys.has(key)) conflicts.push(`${name}: source natural-key duplicate`);
        sourceKeys.add(key);
        const targetId = targetKeys.get(key);
        if (targetId && targetId !== String(doc._id)) conflicts.push(`${name}: existing natural-key collision`);
      }
      documents[name] = documents[name].filter(doc => !targetById.has(String(doc._id)));
    }

    const userIds = new Set([...existing.users, ...documents.users].map(doc => String(doc._id)));
    const businessIds = new Set([...existing.businesses, ...documents.businesses].map(doc => String(doc._id)));
    for (const report of documents.reports) {
      if (!userIds.has(String(report.submittedBy))) conflicts.push('reports: source user relationship is missing');
      if (report.business && !businessIds.has(String(report.business))) conflicts.push('reports: source business relationship is missing');
      for (const file of report.evidenceAttachments || []) {
        const filename = path.basename(String(file.filename || ''));
        const evidencePath = path.resolve(process.env.UPLOAD_DIR || path.resolve(__dirname, 'uploads'), file.quarantined ? 'quarantine' : '', filename);
        if (!filename || !fs.existsSync(evidencePath)) conflicts.push('reports: referenced evidence file is missing');
      }
      if (report.evidence && !(report.evidenceAttachments || []).length) {
        const filename = path.basename(String(report.evidence));
        const evidencePath = path.resolve(process.env.UPLOAD_DIR || path.resolve(__dirname, 'uploads'), filename);
        if (!filename || !fs.existsSync(evidencePath)) conflicts.push('reports: referenced legacy evidence file is missing');
      }
    }
    for (const investigation of documents.investigations) {
      if (!userIds.has(String(investigation.user))) conflicts.push('investigations: source user relationship is missing');
    }
    if (conflicts.length) throw new Error(`Preflight stopped without writing: ${[...new Set(conflicts)].join('; ')}`);

    const summary = Object.fromEntries(collections.map(name => [name, { source: sourceTotals[name], alreadyPresent: alreadyPresent[name], toInsert: documents[name].length }]));
    console.log(`Source: ${sourceDbName}; target: ${targetDbName}; backup: ${backup}`);
    console.log(`Preflight passed. ${apply ? 'Applying insert-only import.' : 'Dry run only; no database changes made.'}`);
    console.log(JSON.stringify(summary));
    if (!apply) return;

    for (const name of collections) {
      for (const doc of documents[name]) {
        await target.collection(name).updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true });
      }
    }
    const totals = {};
    for (const name of collections) totals[name] = await target.collection(name).countDocuments();
    console.log('Import complete. Target counts: ' + JSON.stringify(totals));
  } finally {
    await Promise.allSettled([sourceClient.close(), targetClient.close()]);
  }
}

run().catch(error => {
  console.error('Migration stopped: ' + error.message.replace(/mongodb(?:\+srv)?:\/\/[^\s]+/gi, '[redacted]'));
  process.exitCode = 1;
});
