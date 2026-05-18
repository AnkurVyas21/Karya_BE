const professionalService = require('../services/professionalService');
const paymentService = require('../services/paymentService');
const providerGrowthService = require('../services/providerGrowthService');
const providerWebsiteService = require('../services/providerWebsiteService');
const Review = require('../models/Review');
const Bookmark = require('../models/Bookmark');
const User = require('../models/User');
const OTPVerification = require('../models/OTPVerification');
const authService = require('../services/authService');

const generateOtp = () => process.env.TEST_OTP || (process.env.NODE_ENV === 'production'
  ? Math.floor(100000 + Math.random() * 900000).toString()
  : '123456');

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizeMobile = (value) => String(value || '').replace(/\D/g, '').slice(0, 10);

const parseBooleanLike = (value) => {
  if (typeof value === 'boolean') {
    return value;
  }

  return ['true', '1', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
};

const normalizeGender = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return ['male', 'female', 'other', 'prefer_not_to_say'].includes(normalized) ? normalized : '';
};

const normalizeFullName = (payload = {}) => String(payload.fullName || '').trim();

const createProfile = async (req, res) => {
  try {
    const profileData = {
      ...req.body,
      profilePicture: req.files.profilePicture ? req.files.profilePicture[0].path : null,
      certificates: req.files.certificates ? req.files.certificates.map(f => f.path) : []
    };
    if ('showContactNumber' in profileData) {
      profileData.allowContactDisplay = parseBooleanLike(profileData.showContactNumber);
      delete profileData.showContactNumber;
    }
    if ('gender' in profileData) {
      const userUpdates = { gender: normalizeGender(profileData.gender) };
      const fullName = normalizeFullName(profileData);
      if (fullName) {
        userUpdates.fullName = fullName;
      }
      await User.findByIdAndUpdate(req.user._id, userUpdates, { runValidators: true });
      delete profileData.gender;
    }
    delete profileData.fullName;
    const profile = await professionalService.upsertProfile(req.user._id, profileData);
    res.status(201).json({ success: true, data: profile });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const searchProfessionals = async (req, res) => {
  try {
    const { q, profession, skills, location, country, state, city, town, page = 1, limit = 12 } = req.query;
    const filters = {
      query: q,
      profession,
      skills: skills ? skills.split(',') : [],
      location,
      country,
      state,
      city,
      town
    };
    const result = await professionalService.searchProfessionals(filters, page, limit, req.user?._id);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const aiSearch = async (req, res) => {
  try {
    const {
      problem,
      provider,
      allowedProfessions,
      selectedLocation,
      currentLocation
    } = req.body;
    const result = await professionalService.aiSearch({
      problem,
      provider,
      allowedProfessions,
      selectedLocation,
      currentLocation
    });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getProfile = async (req, res) => {
  try {
    const profile = await professionalService.getProfile(req.params.id, req.user?._id);
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Profile not found' });
    }
    res.json({ success: true, data: profile });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const createReview = async (req, res) => {
  try {
    const professional = req.body.professional || req.body.professionalId;
    const { rating, comment } = req.body;
    const review = new Review({ user: req.user._id, professional, rating, comment });
    await review.save();
    res.status(201).json({ success: true, data: review });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const createBookmark = async (req, res) => {
  try {
    const professional = req.body.professional || req.body.professionalId;

    const existing = await Bookmark.findOne({ user: req.user._id, professional });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Professional already bookmarked' });
    }

    const bookmark = new Bookmark({ user: req.user._id, professional });
    await bookmark.save();
    res.status(201).json({ success: true, data: bookmark });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const createSubscription = async (req, res) => {
  try {
    const subscription = await paymentService.createSubscription(req.user._id, req.body.planId);
    res.status(201).json({ success: true, data: subscription });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const detectProfession = async (req, res) => {
  try {
    const { description } = req.body;
    const result = await professionalService.detectProfession(description);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getGrowthDashboard = async (req, res) => {
  try {
    const data = await providerGrowthService.getDashboard(req.user._id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const activateGrowthFeature = async (req, res) => {
  try {
    const data = await providerGrowthService.activateFeature(req.user._id, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateWebsiteProfile = async (req, res) => {
  try {
    const data = await providerGrowthService.updateWebsiteProfile(req.user._id, req.body, req.files || {});
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const submitVerification = async (req, res) => {
  try {
    const data = await providerGrowthService.submitVerification(req.user._id, req.body, req.files || {});
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getGrowthActivity = async (req, res) => {
  try {
    const data = await providerGrowthService.getActivity(req.user._id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getWebsiteBySlug = async (req, res) => {
  try {
    const data = await providerWebsiteService.getPublicWebsiteBySlug(req.params.slug, req.user?._id);
    if (!data) {
      return res.status(404).json({ success: false, message: 'Website not found' });
    }

    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getWebsitePreviewBySlug = async (req, res) => {
  try {
    const data = await providerWebsiteService.getPreviewWebsiteBySlug(req.params.slug, req.user._id);
    if (!data) {
      return res.status(404).json({ success: false, message: 'Draft preview not found' });
    }

    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getWebsiteBookingSlots = async (req, res) => {
  try {
    const data = await providerWebsiteService.getBookingSlots(req.params.slug, req.query.date, {
      serviceId: req.query.serviceId
    });
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getWebsiteManager = async (req, res) => {
  try {
    const data = await providerWebsiteService.getManager(req.user._id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getMyRequests = async (req, res) => {
  try {
    const data = await providerWebsiteService.getMyRequests(req.user._id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const checkWebsiteSlugAvailability = async (req, res) => {
  try {
    const data = await providerWebsiteService.checkSlugAvailability(req.user._id, req.query.slug);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const saveWebsiteManager = async (req, res) => {
  try {
    const data = await providerWebsiteService.saveManager(req.user._id, req.body, req.files || {});
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateWebsitePublishStatus = async (req, res) => {
  try {
    const data = await providerWebsiteService.updatePublishStatus(req.user._id, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateWebsiteLeadStatus = async (req, res) => {
  try {
    const data = await providerWebsiteService.updateLeadStatus(req.user._id, req.params.id, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateWebsiteBookingStatus = async (req, res) => {
  try {
    const data = await providerWebsiteService.updateBookingStatus(req.user._id, req.params.id, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateWebsiteBookingPayment = async (req, res) => {
  try {
    const data = await providerWebsiteService.updateBookingPayment(req.user._id, req.params.id, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const resendWebsiteBookingOtp = async (req, res) => {
  try {
    const data = await providerWebsiteService.resendBookingProofOtp(req.user._id, req.params.id);
    res.json({ success: true, data, message: 'OTP resent to the customer email.' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateWebsiteOrderStatus = async (req, res) => {
  try {
    const data = await providerWebsiteService.updateOrderStatus(req.user._id, req.params.id, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateWebsiteOrderPayment = async (req, res) => {
  try {
    const data = await providerWebsiteService.updateOrderPayment(req.user._id, req.params.id, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const deleteProviderAdvertisement = async (req, res) => {
  try {
    const data = await providerGrowthService.deleteAdvertisement(req.user._id, req.params.id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const createWebsiteInquiry = async (req, res) => {
  try {
    const data = await providerWebsiteService.createInquiry(req.params.slug, req.body, req.user?._id);
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const createWebsiteBooking = async (req, res) => {
  try {
    const data = await providerWebsiteService.createBooking(req.params.slug, req.body, req.user?._id);
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const createWebsiteProductOrder = async (req, res) => {
  try {
    const data = await providerWebsiteService.createProductOrder(req.params.slug, req.body, req.user?._id);
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getProfessions = async (_req, res) => {
  try {
    const professions = await professionalService.getProfessionCatalog();
    res.json({ success: true, data: professions });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getProfessionCatalogEntries = async (req, res) => {
  try {
    const search = String(req.query.search || req.query.q || '').trim().toLowerCase();
    const skip = Math.max(0, Number(req.query.skip || 0));
    const limit = Math.max(0, Math.min(Number(req.query.limit || 0), 100));
    const professions = await professionalService.getProfessionCatalogEntries();
    const filtered = search
      ? professions.filter((entry) => {
          const values = [
            entry.name,
            entry.canonicalName,
            ...(entry.aliases || []),
            ...(entry.tags || []),
            ...(entry.relatedProfessions || [])
          ].map((value) => String(value || '').toLowerCase());
          return values.some((value) => value.includes(search));
        })
      : professions;
    const data = limit > 0 ? filtered.slice(skip, skip + limit) : filtered;
    res.json({
      success: true,
      data,
      meta: {
        total: filtered.length,
        skip,
        limit: limit || filtered.length,
        hasMore: limit > 0 ? skip + limit < filtered.length : false
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getMyProfile = async (req, res) => {
  try {
    const profile = await professionalService.getProfileByUserId(req.user._id, req.user._id);
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Profile not found' });
    }

    res.json({
      success: true,
      data: {
        ...profile,
        email: req.user.email || '',
        mobile: req.user.mobile || ''
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const requestContactOtp = async (req, res) => {
  try {
    const type = String(req.body.type || '').trim();
    const identifier = type === 'email' ? normalizeEmail(req.body.value) : normalizeMobile(req.body.value);

    if (!['email', 'mobile'].includes(type)) {
      throw new Error('Choose email or mobile to update.');
    }
    if (type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
      throw new Error('Enter a valid email address.');
    }
    if (type === 'mobile' && !/^\d{10}$/.test(identifier)) {
      throw new Error('Enter a valid 10-digit mobile number.');
    }
    if (String(req.user[type] || '').trim().toLowerCase() === identifier.toLowerCase()) {
      throw new Error(`This ${type} is already linked to your account.`);
    }

    const existing = await User.findOne({ [type]: identifier, _id: { $ne: req.user._id } });
    if (existing) {
      throw new Error(`This ${type} is already used by another account.`);
    }

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await OTPVerification.deleteMany({ user: req.user._id, type });
    await OTPVerification.create({ user: req.user._id, type, identifier, otp, expiresAt });

    if (type === 'email') {
      await authService.sendEmailWithResend({
        to: identifier,
        subject: 'Verify your new Nasdiya email',
        text: `Your OTP is ${otp}. It will expire in 10 minutes.`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; color: #1f2937;">
            <h2 style="margin-bottom: 12px;">Verify your new email</h2>
            <p style="margin-bottom: 16px;">Use this OTP to update your provider account email:</p>
            <div style="font-size: 32px; font-weight: 700; letter-spacing: 8px; padding: 16px 20px; background: #f3f6fb; border-radius: 12px; display: inline-block;">${otp}</div>
            <p style="margin-top: 16px;">This OTP will expire in 10 minutes.</p>
          </div>
        `
      });
    } else {
      console.log(`SMS OTP to ${identifier}: ${otp}`);
    }

    res.json({ success: true, message: `OTP sent to your new ${type}.` });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const verifyContactOtp = async (req, res) => {
  try {
    const type = String(req.body.type || '').trim();
    const identifier = type === 'email' ? normalizeEmail(req.body.value) : normalizeMobile(req.body.value);
    const otp = String(req.body.otp || '').trim();

    if (!['email', 'mobile'].includes(type)) {
      throw new Error('Choose email or mobile to update.');
    }
    if (!/^\d{6}$/.test(otp)) {
      throw new Error('Enter the 6-digit OTP.');
    }

    const record = await OTPVerification.findOne({ user: req.user._id, type, identifier, otp });
    if (!record || record.expiresAt < new Date()) {
      throw new Error('Invalid or expired OTP.');
    }

    const existing = await User.findOne({ [type]: identifier, _id: { $ne: req.user._id } });
    if (existing) {
      throw new Error(`This ${type} is already used by another account.`);
    }

    await User.findByIdAndUpdate(req.user._id, { [type]: identifier, isVerified: true }, { runValidators: true });
    await OTPVerification.deleteOne({ _id: record._id });

    const profile = await professionalService.getProfileByUserId(req.user._id, req.user._id);
    res.json({
      success: true,
      data: {
        ...profile,
        [type]: identifier
      },
      message: `${type === 'email' ? 'Email address' : 'Mobile number'} updated and verified.`
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateProfile = async (req, res) => {
  try {
    const payload = { ...req.body };
    const userUpdates = {};
    const files = req.files || {};

    const fullName = normalizeFullName(payload);
    if (fullName) {
      userUpdates.fullName = fullName;
    }
    delete payload.fullName;

    if ('gender' in payload) {
      userUpdates.gender = normalizeGender(payload.gender);
      delete payload.gender;
    }

    if ('baseCharge' in payload || 'visitingCharge' in payload || 'nightCharge' in payload || 'emergencyCharge' in payload) {
      payload.charges = {
        baseCharge: payload.baseCharge,
        visitingCharge: payload.visitingCharge,
        nightCharge: payload.nightCharge,
        emergencyCharge: payload.emergencyCharge
      };
      delete payload.baseCharge;
      delete payload.visitingCharge;
      delete payload.nightCharge;
      delete payload.emergencyCharge;
    }

    if ('showContactNumber' in payload) {
      payload.allowContactDisplay = parseBooleanLike(payload.showContactNumber);
      delete payload.showContactNumber;
    }

    if (files.profilePicture && files.profilePicture[0]) {
      payload.profilePicture = files.profilePicture[0].path;
    }

    if (files.certificates && files.certificates.length > 0) {
      payload.certificates = files.certificates.map((file) => file.path);
    }

    if (Object.keys(userUpdates).length > 0) {
      await User.findByIdAndUpdate(req.user._id, userUpdates, { runValidators: true });
    }

    const profile = await professionalService.upsertProfile(req.user._id, payload);
    res.json({ success: true, data: profile });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getRatings = async (req, res) => {
  try {
    const ratings = await professionalService.getRatings(req.params.id);
    res.json({ success: true, data: ratings });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getBookmarks = async (req, res) => {
  try {
    const bookmarks = await professionalService.getBookmarks(req.user._id);
    res.json({ success: true, data: bookmarks });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const removeBookmark = async (req, res) => {
  try {
    await Bookmark.findOneAndDelete({ user: req.user._id, professional: req.params.id });
    res.json({ success: true, message: 'Bookmark removed' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getDashboardSummary = async (req, res) => {
  try {
    const summary = await professionalService.getDashboardSummary(req.user._id);
    res.json({ success: true, data: summary });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  createProfile,
  searchProfessionals,
  aiSearch,
  getProfile,
  createReview,
  createBookmark,
  createSubscription,
  getGrowthDashboard,
  activateGrowthFeature,
  updateWebsiteProfile,
  submitVerification,
  getGrowthActivity,
  getWebsiteBySlug,
  getWebsitePreviewBySlug,
  getWebsiteBookingSlots,
  getWebsiteManager,
  getMyRequests,
  checkWebsiteSlugAvailability,
  saveWebsiteManager,
  updateWebsitePublishStatus,
  updateWebsiteLeadStatus,
  updateWebsiteBookingStatus,
  updateWebsiteBookingPayment,
  resendWebsiteBookingOtp,
  updateWebsiteOrderStatus,
  updateWebsiteOrderPayment,
  deleteProviderAdvertisement,
  createWebsiteInquiry,
  createWebsiteBooking,
  createWebsiteProductOrder,
  detectProfession,
  getProfessions,
  getProfessionCatalogEntries,
  getMyProfile,
  updateProfile,
  requestContactOtp,
  verifyContactOtp,
  getRatings,
  getBookmarks,
  removeBookmark,
  getDashboardSummary
};
