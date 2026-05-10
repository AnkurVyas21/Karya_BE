const mongoose = require('mongoose');

const providerBookingSchema = new mongoose.Schema({
  providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  websiteId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProviderWebsite', required: true, index: true },
  customerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  customerName: { type: String, required: true },
  customerPhone: { type: String, required: true },
  customerWhatsappOptIn: { type: Boolean, default: false },
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
  providerMessage: { type: String, default: '' },
  cancellationReason: { type: String, default: '' },
  cancelledAt: { type: Date, default: null },
  rescheduleMessage: { type: String, default: '' },
  rescheduledAt: { type: Date, default: null },
  advanceFeeRequired: { type: Boolean, default: false },
  advanceFeeAmount: { type: Number, default: 0 },
  paymentChoice: { type: String, enum: ['pay-later', 'manual-upi', 'gateway'], default: 'pay-later' },
  paymentChannel: { type: String, enum: ['none', 'manual-upi', 'gateway'], default: 'none' },
  paymentStatus: {
    type: String,
    enum: ['not-required', 'pending', 'verification-pending', 'paid', 'failed', 'refunded', 'waived'],
    default: 'pending'
  },
  offerCode: { type: String, default: '' },
  offerDiscountAmount: { type: Number, default: 0 },
  offerQuantity: { type: Number, default: 1 },
  transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'WebsiteTransaction', default: null, index: true },
  refundStatus: { type: String, enum: ['none', 'pending', 'processed', 'rejected'], default: 'none' },
  refundAmount: { type: Number, default: 0 },
  refundReference: { type: String, default: '' },
  refundNote: { type: String, default: '' },
  serviceProofOtpHash: { type: String, default: '' },
  serviceProofOtpCode: { type: String, default: '' },
  serviceProofOtpGeneratedAt: { type: Date, default: null },
  serviceProofOtpVerifiedAt: { type: Date, default: null },
  statusUpdatedAt: { type: Date, default: null },
  status: {
    type: String,
    enum: ['new', 'pending_approval', 'confirmed', 'payment_pending', 'rejected', 'completed', 'cancelled', 'rescheduled'],
    default: 'pending_approval'
  }
}, { timestamps: true });

module.exports = mongoose.model('ProviderBooking', providerBookingSchema);
