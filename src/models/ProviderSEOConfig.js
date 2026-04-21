const mongoose = require('mongoose');

const providerSEOConfigSchema = new mongoose.Schema({
  providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  websiteId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProviderWebsite', required: true, unique: true },
  metaTitle: { type: String, default: '' },
  metaDescription: { type: String, default: '' },
  keywords: [{ type: String }],
  canonicalUrl: { type: String, default: '' },
  schemaType: { type: String, default: 'LocalBusiness' }
}, { timestamps: true });

module.exports = mongoose.model('ProviderSEOConfig', providerSEOConfigSchema);
