const mongoose = require('mongoose');

const otpVerificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  otp: { type: String, required: true },
  type: { type: String, enum: ['mobile', 'email'], required: true },
  expiresAt: { type: Date, required: true }
});

module.exports = mongoose.model('OTPVerification', otpVerificationSchema);