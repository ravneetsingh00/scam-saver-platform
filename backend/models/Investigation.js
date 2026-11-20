const mongoose = require('mongoose');

const citationSchema = new mongoose.Schema({
  title: { type: String, required: true, maxlength: 300 },
  url: { type: String, required: true, maxlength: 2048 },
  checkedAt: { type: Date, required: true },
}, { _id: false });

const findingSchema = new mongoose.Schema({
  text: { type: String, required: true, maxlength: 1200 },
  sourceUrls: { type: [String], default: [] },
}, { _id: false });

const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', default: null, index: true },
  report: { type: mongoose.Schema.Types.ObjectId, ref: 'Report', default: null, index: true },
  status: { type: String, enum: ['In Progress', 'Completed'], default: undefined },
  assignedModerator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  moderatorNotes: { type: String, default: '', maxlength: 5000 },
  outcome: { type: String, default: '', maxlength: 2000 },
  timeline: [{ action: { type: String, required: true, maxlength: 100 }, note: { type: String, default: '', maxlength: 1000 }, at: { type: Date, default: Date.now } }],
  businessName: { type: String, required: true, trim: true, maxlength: 120 },
  category: { type: String, required: true, trim: true, maxlength: 80 },
  location: { type: String, required: true, trim: true, maxlength: 100 },
  website: { type: String, trim: true, default: '', maxlength: 300 },
  summary: { type: String, required: true, maxlength: 20000 },
  facts: { type: [findingSchema], default: [] },
  publicClaims: { type: [findingSchema], default: [] },
  warningSigns: { type: [findingSchema], default: [] },
  inconsistencies: { type: [findingSchema], default: [] },
  confidenceLevel: { type: String, enum: ['Low', 'Moderate', 'High'], default: 'Low' },
  confidenceRationale: { type: String, required: true, maxlength: 1500 },
  identityCaveat: { type: String, required: true, maxlength: 1000 },
  localReportComparison: {
    exactMatch: { type: Boolean, default: false },
    total: { type: Number, default: 0 },
    pending: { type: Number, default: 0 },
    verified: { type: Number, default: 0 },
    rejected: { type: Number, default: 0 },
    cancelled: { type: Number, default: 0 },
    byType: [{ fraudType: { type: String }, count: { type: Number } }],
  },
  communityMatches: [{
    businessName: { type: String, maxlength: 240 },
    category: { type: String, maxlength: 80 },
    location: { type: String, maxlength: 240 },
    fraudType: { type: String, maxlength: 80 },
    status: { type: String, maxlength: 40 },
    submittedAt: { type: Date },
  }],
  sources: { type: [citationSchema], default: [] },
  messages: [{
    role: { type: String, enum: ['user', 'assistant'], required: true },
    text: { type: String, required: true, maxlength: 20000 },
    sources: { type: [citationSchema], default: [] },
    createdAt: { type: Date, default: Date.now },
  }],
}, { timestamps: true });

schema.index({ user: 1, createdAt: -1 });
module.exports = mongoose.model('Investigation', schema);
