const mongoose = require('mongoose');

const legalSectionSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 180 },
  body: { type: String, required: true, trim: true, maxlength: 12000 }
}, { _id: false });

const notificationHistorySchema = new mongoose.Schema({
  notifiedAt: { type: Date, default: Date.now },
  version: { type: String, default: '', trim: true },
  subject: { type: String, default: '', trim: true },
  recipientsTotal: { type: Number, default: 0 },
  sentCount: { type: Number, default: 0 },
  failedCount: { type: Number, default: 0 },
  triggeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { _id: false });

const legalDocumentSchema = new mongoose.Schema({
  type: { type: String, enum: ['terms', 'privacy'], required: true, unique: true, index: true },
  eyebrow: { type: String, default: '', trim: true, maxlength: 120 },
  title: { type: String, required: true, trim: true, maxlength: 180 },
  intro: { type: String, required: true, trim: true, maxlength: 1500 },
  version: { type: String, default: '1.0', trim: true, maxlength: 40 },
  effectiveDate: { type: Date, default: Date.now },
  sections: { type: [legalSectionSchema], default: [] },
  isPublished: { type: Boolean, default: true, index: true },
  publishedAt: { type: Date, default: Date.now },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  notificationHistory: { type: [notificationHistorySchema], default: [] }
}, { timestamps: true });

module.exports = mongoose.model('LegalDocument', legalDocumentSchema);
