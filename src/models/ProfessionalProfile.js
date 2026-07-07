const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');
const { buildProfileSearchIndex } = require('../utils/searchIndexUtils');

const professionalProfileSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  profilePicture: { type: String },
  profession: { type: String },
  skills: [{ type: String }],
  tags: [{ type: String }],
  serviceAreas: [{ type: String }],
  experience: { type: Number },
  description: { type: String },
  certificates: [{ type: String }],
  location: { type: String },
  country: { type: String, default: 'India' },
  state: { type: String },
  addressLine: { type: String },
  city: { type: String },
  town: { type: String },
  area: { type: String },
  pincode: { type: String },
  latitude: { type: Number, default: null },
  longitude: { type: Number, default: null },
  availability: { type: String },
  availabilityStart: { type: String },
  availabilityEnd: { type: String },
  acceptsNightCalls: { type: Boolean, default: false },
  charges: {
    baseCharge: { type: Number },
    visitingCharge: { type: Number },
    nightCharge: { type: Number },
    emergencyCharge: { type: Number }
  },
  allowContactDisplay: { type: Boolean, default: false },
  accountStatus: {
    type: String,
    enum: ['active', 'deactivated', 'deletion_scheduled'],
    default: 'active',
    index: true
  },
  deactivatedAt: { type: Date, default: null },
  deletionRequestedAt: { type: Date, default: null },
  deletionScheduledAt: { type: Date, default: null },
  searchIndex: {
    professionKey: { type: String, default: '', index: true },
    professionKeys: [{ type: String }],
    skillKeys: [{ type: String }],
    tagKeys: [{ type: String }],
    countryKey: { type: String, default: '' },
    stateKey: { type: String, default: '', index: true },
    cityKey: { type: String, default: '', index: true },
    townKey: { type: String, default: '' },
    areaKey: { type: String, default: '' },
    locationKeys: [{ type: String }],
    serviceAreaKeys: [{ type: String }],
    searchTokens: [{ type: String }],
    searchableText: { type: String, default: '' }
  },
  viewCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

professionalProfileSchema.pre('validate', function buildSearchIndexBeforeValidate(next) {
  this.searchIndex = buildProfileSearchIndex(this);
  next();
});

professionalProfileSchema.index({ user: 1 });
professionalProfileSchema.index({ city: 1, state: 1, profession: 1, createdAt: -1 });
professionalProfileSchema.index({ profession: 1, createdAt: -1 });
professionalProfileSchema.index({ state: 1, city: 1 });
professionalProfileSchema.index({ 'searchIndex.cityKey': 1, 'searchIndex.stateKey': 1, 'searchIndex.professionKey': 1, accountStatus: 1, createdAt: -1 });
professionalProfileSchema.index({ 'searchIndex.professionKey': 1, accountStatus: 1, createdAt: -1 });
professionalProfileSchema.index({ 'searchIndex.professionKeys': 1, accountStatus: 1, createdAt: -1 });
professionalProfileSchema.index({ 'searchIndex.locationKeys': 1, accountStatus: 1, createdAt: -1 });
professionalProfileSchema.index({ 'searchIndex.searchTokens': 1, accountStatus: 1, createdAt: -1 });
professionalProfileSchema.index({
  profession: 'text',
  skills: 'text',
  tags: 'text',
  description: 'text',
  location: 'text',
  state: 'text',
  city: 'text',
  serviceAreas: 'text'
}, {
  name: 'professional_profile_search_text'
});

professionalProfileSchema.plugin(mongoosePaginate);

module.exports = mongoose.model('ProfessionalProfile', professionalProfileSchema);
