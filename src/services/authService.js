const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const OTPVerification = require('../models/OTPVerification');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const logger = require('../utils/logger');

class AuthService {
  async signup(userData) {
    const { firstName, lastName, email, mobile, password, role = 'user' } = userData;
    
    // Check if user already exists
    const existingUser = await User.findOne({ $or: [{ email }, { mobile }] });
    if (existingUser) {
      throw new Error('User with this email or mobile already exists');
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ firstName, lastName, email, mobile, password: hashedPassword, role });
    await user.save();
    logger.info(`User signed up: ${user._id}`);
    
    try {
      // Send OTP for mobile and email
      await this.sendOTP(user, 'mobile');
      await this.sendOTP(user, 'email');
    } catch (error) {
      // If OTP sending fails, delete the user to prevent partial signup
      await User.findByIdAndDelete(user._id);
      throw error;
    }
    return user;
  }

  async login(email, password) {
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new Error('Invalid credentials');
    }
    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    logger.info(`User logged in: ${user._id}`);
    return { user, token };
  }

  async verifyOTP(identifier, otp, type) {
    // Find user by email or mobile
    const user = await User.findOne(type === 'email' ? { email: identifier } : { mobile: identifier });
    if (!user) {
      throw new Error('User not found');
    }
    
    const otpRecord = await OTPVerification.findOne({ user: user._id, otp, type });
    if (!otpRecord || otpRecord.expiresAt < new Date()) {
      throw new Error('Invalid or expired OTP');
    }
    await OTPVerification.deleteOne({ _id: otpRecord._id });
    await User.findByIdAndUpdate(user._id, { isVerified: true });
    logger.info(`OTP verified for user: ${user._id}, type: ${type}`);
    return true;
  }

  async sendOTP(user, type) {
    const otp = process.env.NODE_ENV === 'production' ? crypto.randomInt(100000, 999999).toString() : '123456'; // Fixed OTP for testing
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await OTPVerification.create({ user: user._id, otp, type, expiresAt });
    if (type === 'email') {
      // For development/testing, just log the OTP instead of sending email
      console.log(`OTP for ${user.email}: ${otp}`);
      logger.info(`OTP sent to ${user.email}: ${otp}`);
      // Uncomment below for production email sending
      /*
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
      });
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: 'OTP Verification',
        text: `Your OTP is ${otp}`
      });
      */
    } else if (type === 'mobile') {
      // Mock SMS, in real, use twilio
      console.log(`SMS OTP to ${user.mobile}: ${otp}`);
      logger.info(`SMS OTP sent to ${user.mobile}`);
    }
  }

  async resendOTP(identifier, type = 'email') {
    const user = await User.findOne(type === 'email' ? { email: identifier } : { mobile: identifier });
    if (!user) {
      throw new Error('User not found');
    }

    await OTPVerification.deleteMany({ user: user._id, type });
    await this.sendOTP(user, type);
    return true;
  }
}

module.exports = new AuthService();
