const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  professional: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  professionalProfile: { type: mongoose.Schema.Types.ObjectId, ref: 'ProfessionalProfile', required: true },
  lastMessage: { type: String, default: '' },
  lastMessageAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

conversationSchema.index({ customer: 1, professional: 1, professionalProfile: 1 }, { unique: true });

module.exports = mongoose.model('Conversation', conversationSchema);
