const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');

const professionalProfileSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  profilePicture: { type: String },
  profession: { type: String },
  skills: [{ type: String }],
  experience: { type: Number },
  description: { type: String },
  certificates: [{ type: String }],
  location: { type: String },
  availability: { type: String },
  charges: {
    baseCharge: { type: Number },
    visitingCharge: { type: Number },
    nightCharge: { type: Number },
    emergencyCharge: { type: Number }
  },
  allowContactDisplay: { type: Boolean, default: true },
  viewCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

professionalProfileSchema.plugin(mongoosePaginate);

module.exports = mongoose.model('ProfessionalProfile', professionalProfileSchema);
