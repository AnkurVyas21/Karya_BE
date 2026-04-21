const mongoose = require('mongoose');

const providerLeadSchema = new mongoose.Schema({
  providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  websiteId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProviderWebsite', required: true, index: true },
  source: { type: String, enum: ['website', 'callback', 'inquiry', 'whatsapp-click', 'call-click', 'share'], default: 'website' },
  name: { type: String, default: '' },
  phone: { type: String, default: '' },
  email: { type: String, default: '' },
  message: { type: String, default: '' },
  interestedService: { type: String, default: '' },
  status: { type: String, enum: ['new', 'contacted', 'qualified', 'closed'], default: 'new' },
  notes: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('ProviderLead', providerLeadSchema);
