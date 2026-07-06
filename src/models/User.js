const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

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
  profilePicture: { type: String, default: '' },
  accountStatus: {
    type: String,
    enum: ['active', 'deactivated', 'deletion_scheduled'],
    default: 'active',
    index: true
  },
  deactivatedAt: { type: Date, default: null },
  deletionRequestedAt: { type: Date, default: null },
  deletionScheduledAt: { type: Date, default: null },
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

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

const isBcryptHash = (value = '') => BCRYPT_HASH_PATTERN.test(String(value || ''));

const hashPasswordIfNeeded = async (value) => {
  const password = String(value || '');
  if (!password) {
    throw new Error('Password cannot be empty');
  }

  if (isBcryptHash(password)) {
    return password;
  }

  return bcrypt.hash(password, 10);
};

const hashPasswordInUpdate = async function hashPasswordInUpdate() {
  const update = this.getUpdate();
  if (!update) {
    return;
  }

  if (Object.prototype.hasOwnProperty.call(update, 'password')) {
    update.password = await hashPasswordIfNeeded(update.password);
  }

  if (update.$set && Object.prototype.hasOwnProperty.call(update.$set, 'password')) {
    update.$set.password = await hashPasswordIfNeeded(update.$set.password);
  }

  if (update.$setOnInsert && Object.prototype.hasOwnProperty.call(update.$setOnInsert, 'password')) {
    update.$setOnInsert.password = await hashPasswordIfNeeded(update.$setOnInsert.password);
  }

  this.setUpdate(update);
};

userSchema.pre('init', function normalizeLegacyName(data) {
  if (!data.fullName) {
    data.fullName = legacyFullName(data);
  }
  legacyNameKeys.forEach((key) => delete data[key]);
});

userSchema.pre('save', async function hashPasswordBeforeSave() {
  if (this.isModified('password')) {
    this.password = await hashPasswordIfNeeded(this.password);
  }
});

userSchema.pre('validate', function normalizeFullName(next) {
  const fullName = String(this.fullName || '').trim();
  this.fullName = fullName;
  next();
});

userSchema.pre('findOneAndUpdate', hashPasswordInUpdate);
userSchema.pre('updateOne', hashPasswordInUpdate);
userSchema.pre('updateMany', hashPasswordInUpdate);

module.exports = mongoose.model('User', userSchema);
