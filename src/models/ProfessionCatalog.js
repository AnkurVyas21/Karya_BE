const mongoose = require('mongoose');

const professionCatalogSchema = new mongoose.Schema({
  canonicalName: { type: String, required: true, trim: true },
  normalizedKey: { type: String, required: true, trim: true, unique: true, index: true },
  normalizedName: { type: String, trim: true, default: null },
  aliases: [{ type: String }],
  tags: [{ type: String }],
  relatedProfessions: [{ type: String }],
  source: { type: String, default: 'learned' },
  embedding: {
    provider: { type: String, default: '' },
    model: { type: String, default: '' },
    checksum: { type: String, default: '' },
    vector: [{ type: Number }],
    text: { type: String, default: '' },
    updatedAt: { type: Date, default: null }
  },
  learning: {
    usageCount: { type: Number, default: 0 },
    selectedCount: { type: Number, default: 0 },
    lastSelectedAt: { type: Date, default: null },
    lastSuggestedAt: { type: Date, default: null },
    rawInputs: [{ type: String }]
  }
}, {
  timestamps: true
});

professionCatalogSchema.index({ canonicalName: 1 });

module.exports = mongoose.model('ProfessionCatalog', professionCatalogSchema);
