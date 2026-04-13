const mongoose = require('mongoose');

const siteVisitSchema = new mongoose.Schema({
  visitorId: { type: String, required: true, index: true },
  path: { type: String, required: true, index: true },
  pageType: { type: String, default: 'other', index: true },
  referrer: { type: String, default: '' },
  userAgent: { type: String, default: '' },
  ipAddress: { type: String, default: '' }
}, {
  timestamps: {
    createdAt: true,
    updatedAt: false
  }
});

module.exports = mongoose.model('SiteVisit', siteVisitSchema);
