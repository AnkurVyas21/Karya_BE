const mongoose = require('mongoose');

const professionInferenceLogSchema = new mongoose.Schema({
  context: { type: String, default: 'unknown', index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  rawInput: { type: String, required: true, trim: true },
  normalizedInput: { type: String, default: '' },
  transliteratedInput: { type: String, default: '' },
  variants: [{ type: String }],
  provider: { type: String, default: '' },
  model: { type: String, default: '' },
  suggestions: [{
    professionId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProfessionCatalog', default: null },
    canonicalName: { type: String, default: '' },
    normalizedKey: { type: String, default: '' },
    confidence: { type: Number, default: 0 },
    similarity: { type: Number, default: 0 },
    source: { type: String, default: '' }
  }],
  selectedProfessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProfessionCatalog', default: null },
  selectedCanonicalName: { type: String, default: '' },
  selectionSource: { type: String, default: '' },
  metadata: {
    catalogSize: { type: Number, default: 0 },
    detectedProfession: { type: String, default: '' },
    status: { type: String, default: '' },
    candidateSourceUsed: { type: String, default: '' },
    fallbackUsed: { type: Boolean, default: false },
    selectedScoreBreakdown: { type: mongoose.Schema.Types.Mixed, default: null },
    intentExtraction: { type: mongoose.Schema.Types.Mixed, default: null }
  }
}, {
  timestamps: true
});

professionInferenceLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ProfessionInferenceLog', professionInferenceLogSchema);
