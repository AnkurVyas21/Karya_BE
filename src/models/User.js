const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  mobile: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  socialAccounts: [{
    provider: { type: String, enum: ['google', 'facebook', 'linkedin', 'x'], required: true },
    providerId: { type: String, required: true },
    email: { type: String, default: '' },
    displayName: { type: String, default: '' },
    avatarUrl: { type: String, default: '' },
    profileUrl: { type: String, default: '' }
  }],
  role: { type: String, enum: ['user', 'professional', 'admin'], default: 'user' },
  country: { type: String, default: 'India' },
  state: { type: String, default: '' },
  city: { type: String, default: '' },
  town: { type: String, default: '' },
  area: { type: String, default: '' },
  addressLine: { type: String, default: '' },
  pincode: { type: String, default: '' },
  isVerified: { type: Boolean, default: false },
  isBanned: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
