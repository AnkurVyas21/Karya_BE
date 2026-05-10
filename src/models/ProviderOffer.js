const mongoose = require('mongoose');

const providerOfferSchema = new mongoose.Schema({
  providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  websiteId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProviderWebsite', required: true, index: true },
  kind: { type: String, enum: ['banner', 'offer'], default: 'banner', index: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  bannerImage: { type: String, default: '' },
  badgeText: { type: String, default: '' },
  discountText: { type: String, default: '' },
  offerCode: { type: String, default: '', index: true },
  linkedOfferCode: { type: String, default: '' },
  applicableServiceIds: [{ type: String }],
  minQuantity: { type: Number, default: 1 },
  discountType: { type: String, enum: ['percent', 'amount'], default: 'percent' },
  discountValue: { type: Number, default: 0 },
  paymentOnly: { type: Boolean, default: true },
  startDate: { type: Date, default: null },
  endDate: { type: Date, default: null },
  isActive: { type: Boolean, default: true },
  placement: { type: String, enum: ['hero', 'offers', 'both'], default: 'hero' },
  preset: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('ProviderOffer', providerOfferSchema);
