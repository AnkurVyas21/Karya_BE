const mongoose = require('mongoose');

const websiteTemplateMediaSchema = new mongoose.Schema({
  category: {
    type: String,
    enum: ['logo', 'cover', 'header', 'about', 'gallery'],
    required: true,
    index: true
  },
  title: { type: String, default: '' },
  fileUrl: { type: String, required: true },
  kind: {
    type: String,
    enum: ['image'],
    default: 'image',
    index: true
  },
  isActive: { type: Boolean, default: true, index: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, {
  timestamps: true
});

websiteTemplateMediaSchema.index({ category: 1, isActive: 1, createdAt: -1 });

module.exports = mongoose.model('WebsiteTemplateMedia', websiteTemplateMediaSchema);
