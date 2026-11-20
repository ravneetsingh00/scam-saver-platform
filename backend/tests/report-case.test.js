const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Report = require('../models/Report');
const makeCasePdf = require('../utils/caseSummaryPdf');

const submittedBy = () => new mongoose.Types.ObjectId();

test('incomplete cases can be saved as drafts without inventing report data', () => {
  const draft = new Report({ reportId: 'SS-TEST-DRAFT', submittedBy: submittedBy(), status: 'Draft' });
  assert.equal(draft.validateSync(), undefined);
  assert.equal(draft.businessName, '');
});

test('a case cannot be submitted without the required incident details', () => {
  const report = new Report({ reportId: 'SS-TEST-INCOMPLETE', submittedBy: submittedBy(), status: 'Pending' });
  const error = report.validateSync();
  assert.ok(error);
  for (const field of ['businessName', 'category', 'location', 'incidentDate', 'fraudType', 'description']) assert.ok(error.errors[field], `expected ${field} validation`);
});

test('a short incident description is accepted without a minimum character count', () => {
  const report = new Report({
    reportId: 'SS-TEST-SHORT-DESCRIPTION', submittedBy: submittedBy(), businessName: 'Example Store', category: 'Retail', location: 'Test City',
    incidentDate: new Date('2026-01-01'), fraudType: 'Payment Fraud', description: 'Short.', status: 'Pending',
  });
  assert.equal(report.validateSync(), undefined);
});

test('the structured case record validates and stores moderation history and attachments', () => {
  const report = new Report({
    reportId: 'SS-TEST-CASE', submittedBy: submittedBy(), businessName: 'Example Store', category: 'Retail', location: 'Test City',
    incidentDate: new Date('2026-01-01'), fraudType: 'Payment Fraud', description: 'The seller accepted payment and did not deliver the item as agreed.',
    amount: 750, amountCurrency: 'INR', status: 'Needs Information',
    evidenceAttachments: [
      { filename: 'private-id.jpg', originalName: 'receipt.jpg', mimeType: 'image/jpeg', size: 1024, description: 'Payment receipt' },
      { filename: 'private-clip.mp4', originalName: 'screen-recording.mp4', mimeType: 'video/mp4', size: 2048, description: 'Screen recording' },
      { filename: 'private-audio.mp3', originalName: 'call-recording.mp3', mimeType: 'audio/mpeg', size: 3072, description: 'Call recording' },
      { filename: 'private-audio.aac', originalName: 'voice-note.aac', mimeType: 'audio/aac', size: 4096, description: 'Voice recording' },
    ],
    moderationHistory: [{ action: 'Needs Information', note: 'Please add the official complaint number.', by: submittedBy() }],
    reporterResponses: [{ text: 'The official complaint reference is ABC-123.', by: submittedBy() }],
  });
  assert.equal(report.validateSync(), undefined);
  assert.equal(report.evidenceAttachments.length, 4);
  assert.equal(report.moderationHistory[0].action, 'Needs Information');
  assert.equal(report.reporterResponses.length, 1);
});

test('case PDF export includes the case ID, status, evidence index and allegation disclaimer', () => {
  const pdf = makeCasePdf({
    reportId: 'SS-TEST-PDF', businessName: 'Example Store', category: 'Retail', location: 'Test City',
    incidentDate: new Date('2026-01-01'), fraudType: 'Payment Fraud', description: 'The seller accepted payment and did not deliver the item as agreed.',
    status: 'Pending', amount: 750, amountCurrency: 'INR', evidenceAttachments: [{ originalName: 'receipt.pdf', mimeType: 'application/pdf', size: 2048, description: 'Payment receipt' }],
    moderationHistory: [{ action: 'Submitted for human review', at: new Date('2026-01-02') }],
  }).toString('latin1');
  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.ok(pdf.includes('SS-TEST-PDF'));
  assert.ok(pdf.includes('Pending'));
  assert.ok(pdf.includes('receipt.pdf'));
  assert.ok(pdf.includes('allegation'));
  assert.ok(pdf.includes('xref'));
});
