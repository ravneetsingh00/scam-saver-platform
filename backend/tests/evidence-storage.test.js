const test = require('node:test');
const assert = require('node:assert/strict');
const storage = require('../utils/evidenceStorage');

test('evidence resource types keep audio and video on Cloudinary video resources', () => {
  assert.equal(storage.resourceType('image/png'), 'image');
  assert.equal(storage.resourceType('audio/wav'), 'video');
  assert.equal(storage.resourceType('video/mp4'), 'video');
  assert.equal(storage.resourceType('application/pdf'), 'raw');
});

test('migration IDs are deterministic per report and original filename', () => {
  const first = storage.deterministicPublicId('report-a', 'evidence/2f8.png');
  assert.equal(first, storage.deterministicPublicId('report-a', 'evidence/2f8.png'));
  assert.notEqual(first, storage.deterministicPublicId('report-b', 'evidence/2f8.png'));
  assert.match(first, /^scam-saver\/evidence\/[a-f0-9]{64}$/);
});
