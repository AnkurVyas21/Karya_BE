const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');

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
  viewCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

professionalProfileSchema.index({ user: 1 });
professionalProfileSchema.index({ city: 1, state: 1, profession: 1, createdAt: -1 });
professionalProfileSchema.index({ profession: 1, createdAt: -1 });
professionalProfileSchema.index({ state: 1, city: 1 });
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
