const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const OTPVerification = require('../models/OTPVerification');
const ProfessionalProfile = require('../models/ProfessionalProfile');
const crypto = require('crypto');
const logger = require('../utils/logger');

const uniqueStrings = (values = []) => [...new Set(
  values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
)];

const normalizeList = (value) => {
  if (Array.isArray(value)) {
    return uniqueStrings(value);
  }

  if (typeof value === 'string') {
    return uniqueStrings(value.split(','));
  }

  return [];
};

const buildLocation = ({ area = '', city = '' }) => {
  return [area, city].map((value) => String(value || '').trim()).filter(Boolean).join(', ');
};

class AuthService {
  async signup(userData) {
    const {
      firstName,
      lastName,
      email,
      mobile,
      password,
      role = 'user',
      profession = '',
      addressLine = '',
      city = '',
      area = '',
      pincode = '',
      serviceAreas = [],
      skills = []
    } = userData;
    
    // Check if user already exists
    const existingUser = await User.findOne({ $or: [{ email }, { mobile }] });
    if (existingUser) {
      throw new Error('User with this email or mobile already exists');
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ firstName, lastName, email, mobile, password: hashedPassword, role });
    await user.save();

    if (role === 'professional') {
      const normalizedSkills = normalizeList(skills);
      const normalizedServiceAreas = normalizeList(serviceAreas);
      const location = buildLocation({ area, city });

      await ProfessionalProfile.findOneAndUpdate(
        { user: user._id },
        {
          $setOnInsert: {
            user: user._id,
            profession: profession || 'Professional',
            description: `${firstName} ${lastName} is available on Karya.`,
            skills: normalizedSkills,
            serviceAreas: normalizedServiceAreas,
            addressLine: String(addressLine || '').trim(),
            city: String(city || '').trim(),
            area: String(area || '').trim(),
            pincode: String(pincode || '').trim(),
            location,
            allowContactDisplay: true
          }
        },
        { upsert: true, new: true }
      );
      logger.info(`Starter professional profile created for user: ${user._id}`);
    }

    logger.info(`User signed up: ${user._id}`);
    
    try {
      // Email-only OTP verification for now
      await this.sendOTP(user, 'email');
    } catch (error) {
      logger.error('Signup OTP delivery failed', {
        userId: user._id.toString(),
        email,
        message: error.message,
        stack: error.stack
      });
      // If OTP sending fails, delete the user to prevent partial signup
      await User.findByIdAndDelete(user._id);
      throw error;
    }
    return user;
  }

  async login(identifier, password) {
    const user = await User.findOne({
      $or: [{ email: identifier }, { mobile: identifier }]
    });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new Error('Invalid credentials');
    }
    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    logger.info(`User logged in: ${user._id}`);
    return { user, token };
  }

  async verifyOTP(identifier, otp, type) {
    if (type !== 'email') {
      throw new Error('Only email OTP verification is enabled right now');
    }

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
      logger.info('Preparing OTP email', {
        userId: user._id.toString(),
        email: user.email,
        hasResendApiKey: Boolean(process.env.RESEND_API_KEY),
        hasResendFrom: Boolean(process.env.RESEND_FROM),
        environment: process.env.NODE_ENV || 'undefined'
      });

      try {
        const info = await this.sendEmailWithResend({
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

        logger.info('Email OTP sent successfully', {
          userId: user._id.toString(),
          email: user.email,
          resendEmailId: info.id
        });
      } catch (error) {
        logger.error('Resend send email failed', {
          userId: user._id.toString(),
          email: user.email,
          code: error.code,
          response: error.response,
          responseCode: error.responseCode,
          message: error.message,
          stack: error.stack
        });
        throw error;
      }
    } else if (type === 'mobile') {
      // Mock SMS, in real, use twilio
      console.log(`SMS OTP to ${user.mobile}: ${otp}`);
      logger.info(`SMS OTP sent to ${user.mobile}`);
    }
  }

  async sendEmailWithResend({ to, subject, text, html }) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is not configured');
    }

    const from = process.env.RESEND_FROM;
    if (!from) {
      throw new Error('RESEND_FROM is not configured');
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text,
        html
      })
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(payload.message || payload.error || `Resend API request failed with status ${response.status}`);
      error.code = 'RESEND_API_ERROR';
      error.responseCode = response.status;
      error.response = JSON.stringify(payload);
      throw error;
    }

    return payload;
  }

  async resendOTP(identifier, type = 'email') {
    if (type !== 'email') {
      throw new Error('Only email OTP resend is enabled right now');
    }

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
