const mongoose = require('mongoose');

const businessDetailsSchema = new mongoose.Schema({
  entityType: { type: String, default: 'Business', maxlength: 40 },
  ownerContact: { type: String, default: '', maxlength: 120 },
  phone: { type: String, default: '', maxlength: 40 },
  phone2: { type: String, default: '', maxlength: 40 },
  email: { type: String, default: '', lowercase: true, trim: true, maxlength: 254 },
  website: { type: String, default: '', maxlength: 240 },
  address: { type: String, default: '', maxlength: 240 },
  city: { type: String, default: '', maxlength: 100 },
  state: { type: String, default: '', maxlength: 100 },
  pinCode: { type: String, default: '', maxlength: 20 },
  gstin: { type: String, default: '', uppercase: true, maxlength: 20 },
}, { _id: false });

const incidentDetailsSchema = new mongoose.Schema({
  time: { type: String, default: '', maxlength: 20 },
  location: { type: String, default: '', maxlength: 240 },
  paymentMethod: { type: String, default: '', maxlength: 80 },
  amountInvolved: { type: Boolean, default: false },
  transactionReference: { type: String, default: '', maxlength: 120 },
  upiId: { type: String, default: '', maxlength: 120 },
  currentSituation: { type: String, default: '', maxlength: 1000 },
  howContacted: { type: String, default: '', maxlength: 500 },
  whatPromised: { type: String, default: '', maxlength: 500 },
  whatHappened: { type: String, default: '', maxlength: 500 },
  stepsTaken: { type: String, default: '', maxlength: 1000 },
}, { _id: false });

const evidenceSchema = new mongoose.Schema({
  filename: { type: String, required: true },
  originalName: { type: String, required: true, maxlength: 180 },
  mimeType: { type: String, required: true, enum: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'video/mp4', 'video/webm', 'video/quicktime', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/ogg', 'audio/webm', 'application/vnd.android.package-archive'] },
  size: { type: Number, required: true, min: 1 },
  uploadedAt: { type: Date, default: Date.now },
  description: { type: String, default: '', maxlength: 240 },
  quarantined: { type: Boolean, default: false },
  storageProvider: { type: String, enum: ['local', 'cloudinary'], default: 'local' },
  secureUrl: { type: String, default: '', maxlength: 1500 },
  publicId: { type: String, default: '', maxlength: 300 },
  resourceType: { type: String, enum: ['image', 'video', 'raw', ''], default: '' },
  deliveryType: { type: String, enum: ['authenticated', ''], default: '' },
  format: { type: String, default: '', maxlength: 20 },
}, { _id: false });

const historySchema = new mongoose.Schema({
  action: { type: String, required: true, maxlength: 80 },
  note: { type: String, default: '', maxlength: 1200 },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  at: { type: Date, default: Date.now },
}, { _id: false });
const reporterResponseSchema = new mongoose.Schema({
  text: { type: String, required: true, minlength: 2, maxlength: 3000 },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  at: { type: Date, default: Date.now },
}, { _id: false });

const schema = new mongoose.Schema({
  reportId: { type: String, required: true, unique: true },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', default: null },
  businessName: { type: String, trim: true, maxlength: 240, default: '' },
  category: { type: String, trim: true, maxlength: 80, default: '' },
  location: { type: String, trim: true, maxlength: 240, default: '' },
  incidentDate: { type: Date, default: null },
  fraudType: { type: String, enum: ['Online Shopping Fraud', 'Property Fraud', 'Payment Fraud', 'Investment Fraud', 'Job Fraud', 'Identity Fraud', 'Other', ''], default: '' },
  amount: { type: Number, min: 0, default: null },
  amountCurrency: { type: String, default: 'INR', maxlength: 3 },
  description: { type: String, default: '', maxlength: 50000 },
  evidence: { type: String, default: null }, // legacy single-file record support
  evidenceAttachments: { type: [evidenceSchema], default: [] },
  businessDetails: { type: businessDetailsSchema, default: () => ({}) },
  incidentDetails: { type: incidentDetailsSchema, default: () => ({}) },
  previousComplaints: {
    hasComplaint: { type: Boolean, default: false },
    officialReference: { type: String, default: '', maxlength: 120 },
    cybercrimeStatus: { type: String, default: '', maxlength: 80 },
    firStatus: { type: String, default: '', maxlength: 80 },
    resolutionAttempts: { type: String, default: '', maxlength: 1500 },
  },
  reporter: {
    name: { type: String, default: '', maxlength: 80 },
    email: { type: String, default: '', lowercase: true, maxlength: 254 },
    phone: { type: String, default: '', maxlength: 40 },
    address: { type: String, default: '', maxlength: 300 },
    hideNameFromPublic: { type: Boolean, default: true },
    shareContactWithModerators: { type: Boolean, default: true },
  },
  contactEmail: { type: String, lowercase: true, trim: true, maxlength: 254, default: '' },
  status: { type: String, enum: ['Draft', 'Pending', 'Needs Information', 'Under Review', 'Verified', 'Rejected', 'Cancelled'], default: 'Pending' },
  adminNote: { type: String, default: '', maxlength: 1200 },
  moderationHistory: { type: [historySchema], default: [] },
  reporterResponses: { type: [reporterResponseSchema], default: [] },
  isDemo: { type: Boolean, default: false },
}, { timestamps: true });

for (const field of ['businessName', 'category', 'location', 'incidentDate', 'fraudType', 'description']) {
  schema.path(field).required(function requiredForSubmitted() { return this.status !== 'Draft'; });
}
schema.index({ business: 1, status: 1 });
schema.index({ businessName: 'text', description: 'text', reportId: 'text' });
schema.index({ 'businessDetails.website': 1 });
schema.index({ 'incidentDetails.transactionReference': 1 });

module.exports = mongoose.model('Report', schema);
