const mongoose = require('mongoose');

const providerBookingSchema = new mongoose.Schema({
  providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  websiteId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProviderWebsite', required: true, index: true },
  customerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  customerName: { type: String, required: true },
  customerPhone: { type: String, required: true },
  customerEmail: { type: String, default: '' },
  customerAddress: { type: String, default: '' },
  serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProviderService', default: null },
  serviceTitle: { type: String, default: '' },
  bookingDate: { type: String, default: '' },
  bookingTime: { type: String, default: '' },
  bookingStartTime: { type: String, default: '' },
  bookingEndTime: { type: String, default: '' },
  bookingDurationMinutes: { type: Number, default: 30 },
  bookingGapMinutes: { type: Number, default: 0 },
  message: { type: String, default: '' },
  advanceFeeRequired: { type: Boolean, default: false },
  advanceFeeAmount: { type: Number, default: 0 },
  paymentChoice: { type: String, enum: ['pay-later', 'manual-upi', 'gateway'], default: 'pay-later' },
  paymentChannel: { type: String, enum: ['none', 'manual-upi', 'gateway'], default: 'none' },
  paymentStatus: {
    type: String,
    enum: ['not-required', 'pending', 'verification-pending', 'paid', 'failed', 'refunded', 'waived'],
    default: 'pending'
  },
  transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'WebsiteTransaction', default: null, index: true },
  status: {
    type: String,
    enum: ['new', 'pending_approval', 'confirmed', 'payment_pending', 'rejected', 'completed', 'cancelled'],
    default: 'pending_approval'
  }
}, { timestamps: true });

module.exports = mongoose.model('ProviderBooking', providerBookingSchema);
