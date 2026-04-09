const professionalService = require('../services/professionalService');
const paymentService = require('../services/paymentService');
const Review = require('../models/Review');
const Bookmark = require('../models/Bookmark');
const User = require('../models/User');

const createProfile = async (req, res) => {
  try {
    const profileData = {
      ...req.body,
      profilePicture: req.files.profilePicture ? req.files.profilePicture[0].path : null,
      certificates: req.files.certificates ? req.files.certificates.map(f => f.path) : []
    };
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

const getMyProfile = async (req, res) => {
  try {
    const profile = await professionalService.getProfileByUserId(req.user._id, req.user._id);
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Profile not found' });
    }

    res.json({ success: true, data: profile });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateProfile = async (req, res) => {
  try {
    const payload = { ...req.body };
    const userUpdates = {};
    const files = req.files || {};

    if ('firstName' in payload) {
      userUpdates.firstName = payload.firstName;
      delete payload.firstName;
    }

    if ('lastName' in payload) {
      userUpdates.lastName = payload.lastName;
      delete payload.lastName;
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
      payload.allowContactDisplay = Boolean(payload.showContactNumber);
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
  detectProfession,
  getMyProfile,
  updateProfile,
  getRatings,
  getBookmarks,
  removeBookmark,
  getDashboardSummary
};
