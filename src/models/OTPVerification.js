const mongoose = require('mongoose');

const otpVerificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  otp: { type: String, required: true },
  type: { type: String, enum: ['mobile', 'email', 'password_reset', 'provider_conversion'], required: true },
  identifier: { type: String, default: '' },
  payload: { type: mongoose.Schema.Types.Mixed, default: null },
  expiresAt: { type: Date, required: true }
});

module.exports = mongoose.model('OTPVerification', otpVerificationSchema);
