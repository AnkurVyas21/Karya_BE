const mongoose = require('mongoose');

const providerThemeConfigSchema = new mongoose.Schema({
  providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  websiteId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProviderWebsite', required: true, unique: true },
  themeName: { type: String, default: 'trust-blue' },
  primaryColor: { type: String, default: '#1d4ed8' },
  accentColor: { type: String, default: '#f59e0b' },
  layoutStyle: { type: String, enum: ['classic', 'spotlight', 'compact'], default: 'classic' },
  showStickyMobileCTA: { type: Boolean, default: true },
  cardStyle: { type: String, enum: ['rounded', 'soft', 'minimal'], default: 'rounded' },
  bannerStyle: { type: String, enum: ['solid', 'gradient', 'split'], default: 'gradient' }
}, { timestamps: true });

module.exports = mongoose.model('ProviderThemeConfig', providerThemeConfigSchema);
