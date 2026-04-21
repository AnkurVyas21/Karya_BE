const mongoose = require('mongoose');

const businessHourSchema = new mongoose.Schema({
  day: { type: String, default: '' },
  isOpen: { type: Boolean, default: true },
  openTime: { type: String, default: '' },
  closeTime: { type: String, default: '' },
  breakStartTime: { type: String, default: '' },
  breakEndTime: { type: String, default: '' }
}, { _id: false });

const testimonialSchema = new mongoose.Schema({
  authorName: { type: String, default: '' },
  authorRole: { type: String, default: '' },
  rating: { type: Number, default: 5 },
  quote: { type: String, default: '' },
  isPinned: { type: Boolean, default: false }
}, { _id: true });

const faqSchema = new mongoose.Schema({
  question: { type: String, default: '' },
  answer: { type: String, default: '' },
  sortOrder: { type: Number, default: 0 }
}, { _id: true });

const bookingSlotSchema = new mongoose.Schema({
  label: { type: String, default: '' },
  startTime: { type: String, default: '' },
  endTime: { type: String, default: '' },
  isActive: { type: Boolean, default: true }
}, { _id: true });

const providerWebsiteSchema = new mongoose.Schema({
  providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  isPurchased: { type: Boolean, default: false },
  status: { type: String, enum: ['draft', 'published', 'unpublished'], default: 'draft' },
  slug: { type: String, default: '' },
  businessName: { type: String, default: '' },
  tagline: { type: String, default: '' },
  category: { type: String, default: '' },
  subcategories: [{ type: String }],
  tags: [{ type: String }],
  about: { type: String, default: '' },
  yearsOfExperience: { type: Number, default: 0 },
  languages: [{ type: String }],
  phone: { type: String, default: '' },
  whatsappNumber: { type: String, default: '' },
  email: { type: String, default: '' },
  address: { type: String, default: '' },
  city: { type: String, default: '' },
  state: { type: String, default: '' },
  pincode: { type: String, default: '' },
  serviceAreas: [{ type: String }],
  geo: {
    lat: { type: Number, default: null },
    lng: { type: Number, default: null }
  },
  businessHours: [businessHourSchema],
  heroImage: { type: String, default: '' },
  logo: { type: String, default: '' },
  gallery: [{ type: String }],
  videos: [{ type: String }],
  servicesEnabled: { type: Boolean, default: true },
  productsEnabled: { type: Boolean, default: false },
  bookingEnabled: { type: Boolean, default: false },
  paymentsEnabled: { type: Boolean, default: false },
  offersEnabled: { type: Boolean, default: false },
  articlesEnabled: { type: Boolean, default: false },
  reviewsEnabled: { type: Boolean, default: true },
  inquiryFormEnabled: { type: Boolean, default: true },
  callbackEnabled: { type: Boolean, default: true },
  callEnabled: { type: Boolean, default: true },
  whatsappEnabled: { type: Boolean, default: true },
  showPricing: { type: Boolean, default: true },
  showMap: { type: Boolean, default: false },
  showVerification: { type: Boolean, default: true },
  emergencyAvailability: { type: Boolean, default: false },
  requestCallbackMessage: { type: String, default: '' },
  bookingIntro: { type: String, default: '' },
  bookingWorkingDays: [{ type: String }],
  bookingSlots: [bookingSlotSchema],
  bookingBufferMinutes: { type: Number, default: 0 },
  bookingLeadNoticeHours: { type: Number, default: 0 },
  upiId: { type: String, default: '' },
  advanceBookingFeeEnabled: { type: Boolean, default: false },
  bookingFeeAmount: { type: Number, default: 0 },
  paymentInstructions: { type: String, default: '' },
  faqs: [faqSchema],
  testimonials: [testimonialSchema],
  featuredServiceTitle: { type: String, default: '' },
  shareMessage: { type: String, default: '' },
  completionScore: { type: Number, default: 0 },
  publishedAt: { type: Date, default: null }
}, {
  timestamps: true
});

providerWebsiteSchema.index({ slug: 1 }, { unique: true, partialFilterExpression: { slug: { $type: 'string', $ne: '' } } });

module.exports = mongoose.model('ProviderWebsite', providerWebsiteSchema);
