const mongoose = require('mongoose');

const providerProductSchema = new mongoose.Schema({
  providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  websiteId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProviderWebsite', required: true, index: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  price: { type: Number, default: 0 },
  discountedPrice: { type: Number, default: 0 },
  image: { type: String, default: '' },
  gallery: [{ type: String }],
  stockStatus: { type: String, enum: ['in-stock', 'low-stock', 'out-of-stock', 'made-to-order'], default: 'in-stock' },
  isActive: { type: Boolean, default: true },
  category: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('ProviderProduct', providerProductSchema);
