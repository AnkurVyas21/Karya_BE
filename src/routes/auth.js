const express = require('express');
const {
  signup,
  login,
  verifyOTP,
  resendOTP,
  getPasswordEncryptionKey,
  sendPasswordResetOtp,
  verifyPasswordResetOtp,
  resetPassword,
  getCurrentUser,
  updateCurrentUser,
  updateCurrentUserProfilePicture,
  deactivateCurrentUserAccount,
  activateCurrentUserAccount,
  requestCurrentUserAccountDeletion,
  becomeProvider,
  requestBecomeProviderOtp,
  verifyBecomeProviderOtp,
  resendBecomeProviderOtp,
  startSocialAuth,
  handleSocialCallback
} = require('../controllers/authController');
const authMiddleware = require('../middlewares/authMiddleware');
const validationMiddleware = require('../middlewares/validationMiddleware');
const decryptPasswordPayload = require('../middlewares/decryptPasswordPayload');
const Joi = require('joi');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const persistUploadedFiles = require('../middlewares/persistUploadedFiles');
const { getUploadDestination } = require('../utils/uploadPaths');

const router = express.Router();
const upload = multer({ dest: getUploadDestination(), limits: { fileSize: 10 * 1024 * 1024 } });
const profilePictureUpload = multer({
  dest: getUploadDestination(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (String(file.mimetype || '').toLowerCase().startsWith('image/')) {
      cb(null, true);
      return;
    }
    cb(new Error('Upload a valid image file'));
  }
});

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
  fullName: Joi.string().min(2).required(),
  email: Joi.string().email().required(),
  mobile: Joi.string().required(),
  gender: Joi.string().valid('', 'male', 'female', 'other', 'prefer_not_to_say').allow('').optional(),
  password: Joi.string().min(6).required(),
  role: Joi.string().valid('user', 'professional').default('user'),
  profession: Joi.string().allow('').optional(),
  professionAliases: Joi.alternatives().try(
    Joi.array().items(Joi.string()),
    Joi.string().allow('')
  ).optional(),
  professionInferenceId: Joi.string().allow('').optional(),
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
  tags: Joi.alternatives().try(
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

const forgotPasswordEmailSchema = Joi.object({
  email: Joi.string().email().required()
});

const forgotPasswordOtpSchema = Joi.object({
  email: Joi.string().email().required(),
  otp: Joi.string().pattern(/^\d{6}$/).required()
});

const resetPasswordSchema = Joi.object({
  email: Joi.string().email().required(),
  otp: Joi.string().pattern(/^\d{6}$/).required(),
  password: Joi.string().min(6).required()
});

const providerConversionOtpSchema = Joi.object({
  otp: Joi.string().pattern(/^\d{6}$/).required()
});

const updateCurrentUserSchema = Joi.object({
  fullName: Joi.string().allow('').optional(),
  email: Joi.string().email().allow('').optional(),
  mobile: Joi.string().allow('').optional(),
  password: Joi.string().min(6).allow('').optional(),
  gender: Joi.string().valid('', 'male', 'female', 'other', 'prefer_not_to_say').allow('').optional(),
  profession: Joi.string().allow('').optional(),
  professionAliases: Joi.alternatives().try(
    Joi.array().items(Joi.string()),
    Joi.string().allow('')
  ).optional(),
  professionInferenceId: Joi.string().allow('').optional(),
  description: Joi.string().allow('').optional(),
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
  tags: Joi.alternatives().try(
    Joi.array().items(Joi.string()),
    Joi.string().allow('')
  ).optional(),
  allowContactDisplay: Joi.boolean().optional(),
  country: Joi.string().allow('').optional(),
  state: Joi.string().allow('').optional(),
  addressLine: Joi.string().allow('').optional(),
  city: Joi.string().allow('').optional(),
  town: Joi.string().allow('').optional(),
  area: Joi.string().allow('').optional(),
  pincode: Joi.string().allow('').optional()
});

router.get('/password-key', getPasswordEncryptionKey);
router.post('/signup', decryptPasswordPayload, validationMiddleware(signupSchema), signup);
router.post('/login', loginRateLimiter, decryptPasswordPayload, validationMiddleware(loginSchema), login);
router.post('/verify-otp', validationMiddleware(otpSchema), verifyOTP);
router.post('/resend-otp', resendOTP);
router.post('/forgot-password/send-otp', validationMiddleware(forgotPasswordEmailSchema), sendPasswordResetOtp);
router.post('/forgot-password/verify-otp', validationMiddleware(forgotPasswordOtpSchema), verifyPasswordResetOtp);
router.post('/forgot-password/reset', decryptPasswordPayload, validationMiddleware(resetPasswordSchema), resetPassword);
router.get('/me', authMiddleware, getCurrentUser);
router.patch('/me', authMiddleware, decryptPasswordPayload, validationMiddleware(updateCurrentUserSchema), updateCurrentUser);
router.post('/me/profile-picture', authMiddleware, profilePictureUpload.single('profilePicture'), persistUploadedFiles, updateCurrentUserProfilePicture);
router.post('/me/account/deactivate', authMiddleware, deactivateCurrentUserAccount);
router.post('/me/account/activate', authMiddleware, activateCurrentUserAccount);
router.post('/me/account/request-deletion', authMiddleware, requestCurrentUserAccountDeletion);
router.post('/me/become-provider/request-otp', authMiddleware, requestBecomeProviderOtp);
router.post('/me/become-provider/verify-otp', authMiddleware, validationMiddleware(providerConversionOtpSchema), verifyBecomeProviderOtp);
router.post('/me/become-provider/resend-otp', authMiddleware, resendBecomeProviderOtp);
router.post(
  '/me/become-provider',
  authMiddleware,
  upload.fields([{ name: 'profilePicture', maxCount: 1 }, { name: 'certificates', maxCount: 5 }]),
  persistUploadedFiles,
  becomeProvider
);
router.get('/social/:provider/start', startSocialAuth);
router.get('/social/:provider/callback', handleSocialCallback);

module.exports = router;
