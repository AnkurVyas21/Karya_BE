const mongoose = require('mongoose');

const providerOfferSchema = new mongoose.Schema({
  providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  websiteId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProviderWebsite', required: true, index: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  bannerImage: { type: String, default: '' },
  badgeText: { type: String, default: '' },
  discountText: { type: String, default: '' },
  startDate: { type: Date, default: null },
  endDate: { type: Date, default: null },
  isActive: { type: Boolean, default: true },
  placement: { type: String, enum: ['hero', 'offers', 'both'], default: 'hero' },
  preset: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('ProviderOffer', providerOfferSchema);
