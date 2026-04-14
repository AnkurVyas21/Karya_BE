const mongoose = require('mongoose');

const advertisementSchema = new mongoose.Schema({
  level: { type: String, enum: ['city', 'state', 'national'], required: true },
  planId: { type: String, required: true },
  planName: { type: String, required: true },
  amount: { type: Number, default: 0 },
  impressionsTotal: { type: Number, default: 0 },
  impressionsUsed: { type: Number, default: 0 },
  status: { type: String, enum: ['active', 'completed'], default: 'active' },
  createdAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null }
}, { _id: true });

const providerGrowthSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  websiteSlug: { type: String, unique: true, sparse: true, default: null },
  boost: {
    active: { type: Boolean, default: false },
    startDate: { type: Date, default: null },
    expiryDate: { type: Date, default: null },
    monthlyPrice: { type: Number, default: 99 }
  },
  website: {
    active: { type: Boolean, default: false },
    startDate: { type: Date, default: null },
    expiryDate: { type: Date, default: null },
    monthlyPrice: { type: Number, default: 299 },
    headline: { type: String, default: '' },
    description: { type: String, default: '' },
    galleryImages: [{ type: String }],
    galleryVideos: [{ type: String }],
    backgroundAudioUrl: { type: String, default: '' },
    backgroundAudioFile: { type: String, default: '' },
    bookingEnabled: { type: Boolean, default: true },
    appointmentNote: { type: String, default: '' }
  },
  advertisements: [advertisementSchema],
  verification: {
    status: {
      type: String,
      enum: ['not_started', 'pending', 'approved', 'rejected'],
      default: 'not_started'
    },
    fee: { type: Number, default: 99 },
    feePaid: { type: Boolean, default: false },
    paidAt: { type: Date, default: null },
    aadhaarDocument: { type: String, default: '' },
    panDocument: { type: String, default: '' },
    rejectionReason: { type: String, default: '' },
    reviewerNotes: { type: String, default: '' },
    submittedAt: { type: Date, default: null },
    reviewedAt: { type: Date, default: null },
    badgeActive: { type: Boolean, default: false },
    nameMatch: { type: Boolean, default: false },
    mobileMatch: { type: Boolean, default: false }
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('ProviderGrowth', providerGrowthSchema);
