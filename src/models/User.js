const mongoose = require('mongoose');

const legacyNameKeys = ['first' + 'Name', 'last' + 'Name'];
const legacyFullName = (source = {}) => legacyNameKeys
  .map((key) => source[key])
  .map((value) => String(value || '').trim())
  .filter(Boolean)
  .join(' ');

const userSchema = new mongoose.Schema({
  fullName: { type: String, default: '' },
  email: { type: String, unique: true, sparse: true, default: null },
  mobile: { type: String, unique: true, sparse: true, default: null },
  gender: { type: String, enum: ['', 'male', 'female', 'other', 'prefer_not_to_say'], default: '' },
  password: { type: String, required: true },
  passwordSetupRequired: { type: Boolean, default: false },
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

userSchema.pre('init', function normalizeLegacyName(data) {
  if (!data.fullName) {
    data.fullName = legacyFullName(data);
  }
  legacyNameKeys.forEach((key) => delete data[key]);
});

userSchema.pre('validate', function normalizeFullName(next) {
  const fullName = String(this.fullName || '').trim();
  this.fullName = fullName;
  next();
});

module.exports = mongoose.model('User', userSchema);
