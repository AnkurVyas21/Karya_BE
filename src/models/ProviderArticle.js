const mongoose = require('mongoose');

const providerArticleSchema = new mongoose.Schema({
  providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  websiteId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProviderWebsite', required: true, index: true },
  title: { type: String, required: true },
  slug: { type: String, required: true },
  summary: { type: String, default: '' },
  content: { type: String, default: '' },
  coverImage: { type: String, default: '' },
  status: { type: String, enum: ['draft', 'published'], default: 'draft' },
  publishedAt: { type: Date, default: null }
}, { timestamps: true });

providerArticleSchema.index({ providerId: 1, slug: 1 }, { unique: true });

module.exports = mongoose.model('ProviderArticle', providerArticleSchema);
