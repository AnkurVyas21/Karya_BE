const mongoose = require('mongoose');

const providerServiceSchema = new mongoose.Schema({
  providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  websiteId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProviderWebsite', required: true, index: true },
  title: { type: String, required: true },
  shortDescription: { type: String, default: '' },
  fullDescription: { type: String, default: '' },
  category: { type: String, default: '' },
  priceType: { type: String, enum: ['fixed', 'starting', 'custom', 'on-request'], default: 'on-request' },
  price: { type: Number, default: 0 },
  unit: { type: String, default: '' },
  image: { type: String, default: '' },
  isFeatured: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('ProviderService', providerServiceSchema);
