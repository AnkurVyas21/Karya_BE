const mongoose = require('mongoose');

const professionCatalogSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  normalizedName: { type: String, required: true, trim: true, unique: true, index: true },
  source: { type: String, default: 'system' },
  aliases: [{ type: String }],
  tags: [{ type: String }]
}, {
  timestamps: true
});

module.exports = mongoose.model('ProfessionCatalog', professionCatalogSchema);
