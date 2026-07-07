const mongoose = require('mongoose');

const usageCounterSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true },
  scope: { type: String, default: '', index: true },
  count: { type: Number, default: 0 },
  limit: { type: Number, default: 0 },
  windowStartedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: null }
}, { timestamps: true });

usageCounterSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('UsageCounter', usageCounterSchema);
