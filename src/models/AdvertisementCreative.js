const mongoose = require('mongoose');

const advertisementCreativeSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  professionalProfile: { type: mongoose.Schema.Types.ObjectId, ref: 'ProfessionalProfile', default: null, index: true },

  // Links to ProviderGrowth.advertisements subdocument _id (stringified ObjectId)
  advertisementId: { type: String, required: true, index: true },

  level: { type: String, enum: ['city', 'state', 'national'], required: true, index: true },
  city: { type: String, default: '', index: true },
  state: { type: String, default: '', index: true },

  imagePath: { type: String, required: true },
  imageWidth: { type: Number, default: 0 },
  imageHeight: { type: Number, default: 0 },

  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  rejectionReason: { type: String, default: '' },
  approvedAt: { type: Date, default: null },

  views: { type: Number, default: 0 },
  clicks: { type: Number, default: 0 }
}, {
  timestamps: true
});

advertisementCreativeSchema.index({ level: 1, city: 1, status: 1, createdAt: -1 });
advertisementCreativeSchema.index({ user: 1, advertisementId: 1 }, { unique: true });

module.exports = mongoose.model('AdvertisementCreative', advertisementCreativeSchema);

