const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const OTPVerification = require('../models/OTPVerification');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const logger = require('../utils/logger');

let mailTransporter;

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
    const otp = process.env.TEST_OTP || (process.env.NODE_ENV === 'production' ? crypto.randomInt(100000, 999999).toString() : '123456');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await OTPVerification.create({ user: user._id, otp, type, expiresAt });
    if (type === 'email') {
      const transporter = this.getMailTransporter();
      await transporter.sendMail({
        from: `"Karya" <${process.env.EMAIL_USER}>`,
        to: user.email,
        subject: 'Your Karya verification OTP',
        text: `Your OTP is ${otp}. It will expire in 10 minutes.`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; color: #1f2937;">
            <h2 style="margin-bottom: 12px;">Verify your Karya account</h2>
            <p style="margin-bottom: 16px;">Use the following OTP to complete your signup:</p>
            <div style="font-size: 32px; font-weight: 700; letter-spacing: 8px; padding: 16px 20px; background: #f3f6fb; border-radius: 12px; display: inline-block;">
              ${otp}
            </div>
            <p style="margin-top: 16px;">This OTP will expire in 10 minutes.</p>
          </div>
        `
      });
      logger.info(`Email OTP sent to ${user.email}`);
    } else if (type === 'mobile') {
      // Mock SMS, in real, use twilio
      console.log(`SMS OTP to ${user.mobile}: ${otp}`);
      logger.info(`SMS OTP sent to ${user.mobile}`);
    }
  }

  getMailTransporter() {
    if (mailTransporter) {
      return mailTransporter;
    }

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      throw new Error('Email credentials are not configured');
    }

    mailTransporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    return mailTransporter;
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
