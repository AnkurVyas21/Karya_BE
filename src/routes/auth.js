const express = require('express');
const {
  signup,
  login,
  verifyOTP,
  resendOTP,
  getCurrentUser,
  updateCurrentUser,
  startSocialAuth,
  handleSocialCallback
} = require('../controllers/authController');
const authMiddleware = require('../middlewares/authMiddleware');
const validationMiddleware = require('../middlewares/validationMiddleware');
const Joi = require('joi');
const rateLimit = require('express-rate-limit');

const router = express.Router();

const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many login attempts. Please try again in a few minutes.'
  }
});

const signupSchema = Joi.object({
  firstName: Joi.string().required(),
  lastName: Joi.string().required(),
  email: Joi.string().email().required(),
  mobile: Joi.string().required(),
  password: Joi.string().min(6).required(),
  role: Joi.string().valid('user', 'professional').default('user'),
  profession: Joi.string().allow('').optional(),
  country: Joi.string().allow('').optional(),
  state: Joi.string().allow('').optional(),
  addressLine: Joi.string().allow('').optional(),
  city: Joi.string().allow('').optional(),
  town: Joi.string().allow('').optional(),
  area: Joi.string().allow('').optional(),
  pincode: Joi.string().allow('').optional(),
  serviceAreas: Joi.alternatives().try(
    Joi.array().items(Joi.string()),
    Joi.string().allow('')
  ).optional(),
  skills: Joi.alternatives().try(
    Joi.array().items(Joi.string()),
    Joi.string().allow('')
  ).optional(),
  specializations: Joi.alternatives().try(
    Joi.array().items(Joi.string()),
    Joi.string().allow('')
  ).optional(),
  description: Joi.string().allow('').optional(),
  allowContactDisplay: Joi.boolean().optional(),
  socialAccount: Joi.object({
    provider: Joi.string().valid('google', 'facebook', 'linkedin', 'x').required(),
    providerId: Joi.string().required(),
    email: Joi.string().allow('').optional(),
    displayName: Joi.string().allow('').optional(),
    avatarUrl: Joi.string().allow('').optional(),
    profileUrl: Joi.string().allow('').optional()
  }).optional()
});

const loginSchema = Joi.object({
  identifier: Joi.string().optional(),
  email: Joi.string().optional(),
  password: Joi.string().required()
}).or('identifier', 'email');

const otpSchema = Joi.object({
  otp: Joi.string().required(),
  type: Joi.string().valid('mobile', 'email').required(),
  identifier: Joi.string().required() // email or mobile
});

const updateCurrentUserSchema = Joi.object({
  firstName: Joi.string().allow('').optional(),
  lastName: Joi.string().allow('').optional(),
  email: Joi.string().email().allow('').optional(),
  mobile: Joi.string().allow('').optional(),
  password: Joi.string().min(6).allow('').optional(),
  profession: Joi.string().allow('').optional(),
  country: Joi.string().allow('').optional(),
  state: Joi.string().allow('').optional(),
  addressLine: Joi.string().allow('').optional(),
  city: Joi.string().allow('').optional(),
  town: Joi.string().allow('').optional(),
  area: Joi.string().allow('').optional(),
  pincode: Joi.string().allow('').optional()
});

router.post('/signup', validationMiddleware(signupSchema), signup);
router.post('/login', loginRateLimiter, validationMiddleware(loginSchema), login);
router.post('/verify-otp', validationMiddleware(otpSchema), verifyOTP);
router.post('/resend-otp', resendOTP);
router.get('/me', authMiddleware, getCurrentUser);
router.patch('/me', authMiddleware, validationMiddleware(updateCurrentUserSchema), updateCurrentUser);
router.get('/social/:provider/start', startSocialAuth);
router.get('/social/:provider/callback', handleSocialCallback);

module.exports = router;
