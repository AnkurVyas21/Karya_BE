const mongoose = require('mongoose');

const providerProductOrderSchema = new mongoose.Schema({
  providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  websiteId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProviderWebsite', required: true, index: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProviderProduct', default: null, index: true },
  customerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  customerName: { type: String, required: true },
  customerPhone: { type: String, required: true },
  customerEmail: { type: String, default: '' },
  productTitle: { type: String, default: '' },
  quantity: { type: Number, default: 1 },
  unitAmount: { type: Number, default: 0 },
  message: { type: String, default: '' },
  status: { type: String, enum: ['new', 'confirmed', 'completed', 'cancelled'], default: 'new', index: true },
  paymentStatus: { type: String, enum: ['not-required', 'pending', 'verification-pending', 'paid', 'failed', 'refunded'], default: 'pending', index: true },
  paymentChannel: { type: String, enum: ['none', 'manual-upi', 'gateway'], default: 'none' },
  totalAmount: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('ProviderProductOrder', providerProductOrderSchema);
