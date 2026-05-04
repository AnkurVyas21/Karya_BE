const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const OTPVerification = require('../models/OTPVerification');
const ProfessionalProfile = require('../models/ProfessionalProfile');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { buildAuthenticatedUser, composeLocation, sanitizeUser, toCleanString } = require('../utils/accountPresenter');
const { normalizeSocialAccount } = require('../utils/socialAccountUtils');
const { deriveProfileTags, normalizeList } = require('../utils/profileTagUtils');
const professionCatalogService = require('./professionCatalogService');
const professionInferenceService = require('./professionInferenceService');

class AuthService {
  async signup(userData) {
    const {
      fullName,
      firstName,
      lastName,
      email,
      mobile,
      password,
      role = 'user',
      profession = '',
      professionAliases = [],
      professionInferenceId = '',
      country = 'India',
      state = '',
      addressLine = '',
      city = '',
      town = '',
      area = '',
      pincode = '',
      serviceAreas = [],
      skills = [],
      specializations = [],
      description = '',
      tags: providedTags = [],
      allowContactDisplay = false,
      socialAccount = null
    } = userData;

    const normalizedEmail = this.normalizeEmail(email);
    const normalizedMobile = this.normalizeMobile(mobile);
    const normalizedFullName = toCleanString(fullName) || [firstName, lastName].map((value) => toCleanString(value)).filter(Boolean).join(' ');
    if (!normalizedFullName) {
      throw new Error('Full name is required');
    }
    await this.ensureContactUniqueness({ email: normalizedEmail, mobile: normalizedMobile });

    const normalizedSocialAccount = socialAccount
      ? normalizeSocialAccount(socialAccount)
      : null;

    if (normalizedSocialAccount?.provider && normalizedSocialAccount?.providerId) {
      const existingSocialUser = await User.findOne({
        socialAccounts: {
          $elemMatch: {
            provider: normalizedSocialAccount.provider,
            providerId: normalizedSocialAccount.providerId
          }
        }
      });
      if (existingSocialUser) {
        throw new Error('This social account is already linked to another user');
      }
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      firstName: normalizedFullName,
      lastName: '',
      email: normalizedEmail,
      mobile: normalizedMobile,
      password: hashedPassword,
      socialAccounts: normalizedSocialAccount?.provider && normalizedSocialAccount?.providerId
        ? [normalizedSocialAccount]
        : [],
      role,
      country: String(country || 'India').trim() || 'India',
      state: String(state || '').trim(),
      city: String(city || '').trim(),
      town: String(town || '').trim(),
      area: String(area || '').trim(),
      addressLine: String(addressLine || '').trim(),
      pincode: String(pincode || '').trim()
    });
    await user.save();

    if (role === 'professional') {
      const normalizedSkills = normalizeList(specializations).length
        ? normalizeList(specializations)
        : normalizeList(skills);
      const normalizedServiceAreas = normalizeList(serviceAreas);
      const location = composeLocation({ town, area, city, state });
      const normalizedDescription = toCleanString(description);
      const savedProfession = await professionCatalogService.ensureProfession(profession, {
        aliases: normalizeList(professionAliases),
        allowCreate: true,
        source: 'provider-signup',
        preserveInput: true,
        rawInput: description || profession
      });
      const professionCatalog = await professionCatalogService.getAllProfessions();
      const tags = deriveProfileTags({
        profession: savedProfession,
        specializations: normalizedSkills,
        description: normalizedDescription,
        tags: providedTags,
        serviceAreas: normalizedServiceAreas,
        country,
        state,
        city,
        town,
        area,
        professionCatalog
      });

      await ProfessionalProfile.findOneAndUpdate(
        { user: user._id },
        {
          $setOnInsert: {
            user: user._id,
            profession: savedProfession,
            description: normalizedDescription,
            skills: normalizedSkills,
            tags,
            serviceAreas: normalizedServiceAreas,
            country: String(country || 'India').trim() || 'India',
            state: String(state || '').trim(),
            addressLine: String(addressLine || '').trim(),
            city: String(city || '').trim(),
            town: String(town || '').trim(),
            area: String(area || '').trim(),
            pincode: String(pincode || '').trim(),
            location,
            allowContactDisplay: Boolean(allowContactDisplay)
          }
        },
        { upsert: true, new: true }
      );
      await professionInferenceService.recordSelection(professionInferenceId, savedProfession, {
        aliases: normalizeList(professionAliases),
        source: 'provider-signup',
        rawInput: description || profession
      });
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
      await ProfessionalProfile.findOneAndDelete({ user: user._id });
      throw error;
    }
    return sanitizeUser(user);
  }

  async login(identifier, password) {
    const user = await this.findUserByIdentifier(identifier);
    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new Error('Invalid credentials');
    }

    const session = await this.buildAuthenticatedSession(user);
    logger.info(`User logged in: ${user._id}`);
    return session;
  }

  async registerSocialUser(socialProfile, options = {}) {
    const role = options.role === 'professional' ? 'professional' : 'user';
    const firstName = toCleanString(socialProfile.firstName) || this.extractNameParts(socialProfile.displayName).firstName || 'Karya';
    const lastName = toCleanString(socialProfile.lastName) || this.extractNameParts(socialProfile.displayName).lastName || 'Member';
    const email = this.normalizeEmail(socialProfile.email) || this.buildSocialPlaceholderEmail(socialProfile);
    const mobile = this.normalizeMobile(socialProfile.mobile) || this.buildSocialPlaceholderMobile(socialProfile);

    await this.ensureContactUniqueness({ email, mobile });

    const password = crypto.randomBytes(32).toString('hex');
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      firstName,
      lastName,
      email,
      mobile,
      password: hashedPassword,
      passwordSetupRequired: true,
      role,
      isVerified: true,
      socialAccounts: [normalizeSocialAccount({
        provider: socialProfile.provider,
        providerId: socialProfile.providerId,
        email: socialProfile.email,
        displayName: socialProfile.displayName || [firstName, lastName].filter(Boolean).join(' ').trim(),
        avatarUrl: socialProfile.avatarUrl,
        profileUrl: socialProfile.profileUrl
      })]
    });
    await user.save();

    if (role === 'professional') {
      await ProfessionalProfile.findOneAndUpdate(
        { user: user._id },
        {
          $setOnInsert: {
            user: user._id,
            profession: '',
            skills: [],
            serviceAreas: [],
            description: '',
            country: 'India',
            state: '',
            addressLine: '',
            city: '',
            town: '',
            area: '',
            pincode: '',
            location: '',
            tags: [],
            allowContactDisplay: false
          }
        },
        { upsert: true, new: true }
      );
    }

    logger.info(`Social user registered: ${user._id}`);
    return user;
  }

  async buildAuthenticatedSession(user) {
    const professionalProfile = user.role === 'professional'
      ? await ProfessionalProfile.findOne({ user: user._id })
      : null;
    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });

    return {
      user: buildAuthenticatedUser(user, professionalProfile),
      token
    };
  }

  async getCurrentUserProfile(userId) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const professionalProfile = user.role === 'professional'
      ? await ProfessionalProfile.findOne({ user: userId })
      : null;

    return buildAuthenticatedUser(user, professionalProfile);
  }

  async updateCurrentUserProfile(userId, payload = {}) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const userUpdates = {};
    const nextEmail = 'email' in payload ? this.normalizeEmail(payload.email) : user.email;
    const nextMobile = 'mobile' in payload ? this.normalizeMobile(payload.mobile) : user.mobile;

    await this.ensureContactUniqueness({
      email: nextEmail,
      mobile: nextMobile,
      excludeUserId: userId
    });

    if ('firstName' in payload) {
      userUpdates.firstName = toCleanString(payload.firstName);
    }

    if ('lastName' in payload) {
      userUpdates.lastName = toCleanString(payload.lastName);
    }

    if ('email' in payload) {
      userUpdates.email = nextEmail;
    }

    if ('mobile' in payload) {
      userUpdates.mobile = nextMobile;
    }

    ['country', 'state', 'city', 'town', 'area', 'addressLine', 'pincode'].forEach((field) => {
      if (field in payload) {
        userUpdates[field] = toCleanString(payload[field]);
      }
    });

    if ('password' in payload) {
      const password = String(payload.password || '');
      if (password.length < 6) {
        throw new Error('Password must be at least 6 characters long');
      }

      userUpdates.password = await bcrypt.hash(password, 10);
      userUpdates.passwordSetupRequired = false;
    }

    if (Object.keys(userUpdates).length > 0) {
      await User.findByIdAndUpdate(userId, userUpdates, { runValidators: true });
    }

    if (user.role === 'professional') {
      const existingProfessionalProfile = await ProfessionalProfile.findOne({ user: userId });
      const nextLocationState = {
        country: 'country' in userUpdates ? userUpdates.country : user.country,
        state: 'state' in userUpdates ? userUpdates.state : user.state,
        city: 'city' in userUpdates ? userUpdates.city : user.city,
        town: 'town' in userUpdates ? userUpdates.town : user.town,
        area: 'area' in userUpdates ? userUpdates.area : user.area,
        addressLine: 'addressLine' in userUpdates ? userUpdates.addressLine : user.addressLine,
        pincode: 'pincode' in userUpdates ? userUpdates.pincode : user.pincode
      };
      const professionalUpdates = {
        ...nextLocationState,
        location: composeLocation(nextLocationState)
      };

      const providedAliases = normalizeList(payload.professionAliases || []);
      const professionInferenceId = String(payload.professionInferenceId || '').trim();
      const providedServiceAreas = 'serviceAreas' in payload
        ? normalizeList(payload.serviceAreas)
        : (existingProfessionalProfile?.serviceAreas || []);
      const providedSkills = 'specializations' in payload
        ? normalizeList(payload.specializations)
        : ('skills' in payload ? normalizeList(payload.skills) : (existingProfessionalProfile?.skills || []));
      const providedDescription = 'description' in payload
        ? toCleanString(payload.description)
        : (existingProfessionalProfile?.description || '');
      const manualTags = 'tags' in payload
        ? normalizeList(payload.tags)
        : [];

      if ('description' in payload) {
        professionalUpdates.description = providedDescription;
      }

      if ('serviceAreas' in payload) {
        professionalUpdates.serviceAreas = providedServiceAreas;
      }

      if ('specializations' in payload || 'skills' in payload) {
        professionalUpdates.skills = providedSkills;
      }

      if ('allowContactDisplay' in payload) {
        professionalUpdates.allowContactDisplay = Boolean(payload.allowContactDisplay);
      }

      if ('profession' in payload) {
        professionalUpdates.profession = await professionCatalogService.ensureProfession(payload.profession, {
          aliases: providedAliases,
          allowCreate: true,
          source: 'account-profile',
          preserveInput: true,
          rawInput: providedDescription || payload.profession
        });
      }

      const nextProfession = 'profession' in professionalUpdates
        ? professionalUpdates.profession
        : existingProfessionalProfile?.profession || '';
      const nextSkills = 'skills' in professionalUpdates
        ? professionalUpdates.skills
        : (existingProfessionalProfile?.skills || []);
      const nextDescription = 'description' in professionalUpdates
        ? professionalUpdates.description
        : (existingProfessionalProfile?.description || '');
      const nextServiceAreas = 'serviceAreas' in professionalUpdates
        ? professionalUpdates.serviceAreas
        : (existingProfessionalProfile?.serviceAreas || []);

      const professionCatalog = await professionCatalogService.getAllProfessions();
      professionalUpdates.tags = normalizeList([
        ...manualTags,
        ...deriveProfileTags({
        profession: nextProfession,
        specializations: nextSkills,
        description: nextDescription,
        serviceAreas: nextServiceAreas,
        ...nextLocationState,
        professionCatalog
      })
      ]);

      await ProfessionalProfile.findOneAndUpdate(
        { user: userId },
        {
          $set: professionalUpdates,
          $setOnInsert: {
            user: userId
          }
        },
        { upsert: true, new: true, runValidators: true }
      );

      if (professionalUpdates.profession) {
        await professionInferenceService.recordSelection(professionInferenceId, professionalUpdates.profession, {
          aliases: providedAliases,
          source: 'account-profile',
          rawInput: providedDescription || payload.profession
        });
      }
    }

    return this.getCurrentUserProfile(userId);
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
          subject: 'Your Nasdiya verification OTP',
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

  normalizeEmail(value) {
    const email = toCleanString(value).toLowerCase();
    return email || null;
  }

  normalizeMobile(value) {
    const digits = String(value || '').replace(/[^\d]/g, '');
    return digits || null;
  }

  extractNameParts(displayName = '') {
    const parts = String(displayName || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      return { firstName: '', lastName: '' };
    }

    return {
      firstName: parts[0],
      lastName: parts.slice(1).join(' ')
    };
  }

  buildSocialPlaceholderEmail(socialProfile = {}) {
    const provider = toCleanString(socialProfile.provider || 'social').toLowerCase();
    const providerId = this.buildSafeSocialId(socialProfile.providerId);
    return `${provider}-${providerId}@social.karya.local`;
  }

  buildSocialPlaceholderMobile(socialProfile = {}) {
    const provider = toCleanString(socialProfile.provider || 'social').toLowerCase();
    const providerId = this.buildSafeSocialId(socialProfile.providerId);
    return `social-${provider}-${providerId}`;
  }

  buildSafeSocialId(value) {
    const safeValue = toCleanString(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return safeValue || crypto.randomBytes(8).toString('hex');
  }

  async ensureContactUniqueness({ email = null, mobile = null, excludeUserId = null } = {}) {
    const checks = [];
    const normalizedEmail = this.normalizeEmail(email);
    const normalizedMobile = this.normalizeMobile(mobile);

    if (normalizedEmail) {
      checks.push({ email: normalizedEmail });
    }

    if (normalizedMobile) {
      checks.push({ mobile: normalizedMobile });
    }

    if (!checks.length) {
      return;
    }

    const query = { $or: checks };
    if (excludeUserId) {
      query._id = { $ne: excludeUserId };
    }

    const existingUser = await User.findOne(query);
    if (existingUser) {
      throw new Error('User with this email or mobile already exists');
    }
  }

  async findUserByIdentifier(identifier) {
    const normalizedEmail = this.normalizeEmail(identifier);
    const normalizedMobile = this.normalizeMobile(identifier);
    const checks = [];

    if (normalizedEmail) {
      checks.push({ email: normalizedEmail });
    }

    if (normalizedMobile) {
      checks.push({ mobile: normalizedMobile });
    }

    if (!checks.length) {
      return null;
    }

    return User.findOne({ $or: checks });
  }
}

module.exports = new AuthService();
