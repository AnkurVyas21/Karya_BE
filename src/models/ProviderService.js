const mongoose = require('mongoose');

const providerServiceSchema = new mongoose.Schema({
  providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  websiteId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProviderWebsite', required: true, index: true },
  title: { type: String, required: true },
  shortDescription: { type: String, default: '' },
  fullDescription: { type: String, default: '' },
  category: { type: String, default: '' },
  priceType: { type: String, enum: ['fixed', 'starting', 'custom', 'on-request'], default: 'on-request' },
  price: { type: Number, default: 0 },
  unit: { type: String, default: '' },
  image: { type: String, default: '' },
  isFeatured: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  availableForBooking: { type: Boolean, default: true },
  bookingDurationMinutes: { type: Number, default: 0 },
  bookingGapMinutes: { type: Number, default: 0 },
  bookingCapacity: { type: Number, default: 0 },
  bookingConfirmationType: {
    type: String,
    enum: ['auto_confirm', 'provider_approval', ''],
    default: ''
  },
  sortOrder: { type: Number, default: 0 }
}, { timestamps: true });

providerServiceSchema.pre('validate', function normalizeLegacyBookingConfirmation(next) {
  if (!['', 'auto_confirm', 'provider_approval'].includes(this.bookingConfirmationType)) {
    this.bookingConfirmationType = '';
  }
  next();
});

module.exports = mongoose.model('ProviderService', providerServiceSchema);
