const mongoose = require('mongoose');

const providerBookingSchema = new mongoose.Schema({
  providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  websiteId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProviderWebsite', required: true, index: true },
  customerName: { type: String, required: true },
  customerPhone: { type: String, required: true },
  serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProviderService', default: null },
  bookingDate: { type: String, default: '' },
  bookingTime: { type: String, default: '' },
  message: { type: String, default: '' },
  advanceFeeRequired: { type: Boolean, default: false },
  advanceFeeAmount: { type: Number, default: 0 },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'waived', 'failed'], default: 'pending' },
  status: { type: String, enum: ['new', 'confirmed', 'completed', 'cancelled'], default: 'new' }
}, { timestamps: true });

module.exports = mongoose.model('ProviderBooking', providerBookingSchema);
