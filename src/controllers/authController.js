const authService = require('../services/authService');
const passwordCryptoService = require('../services/passwordCryptoService');
const { socialAuthService } = require('../services/socialAuthService');

const sendError = (res, error) => {
  if (error.retryAfterSeconds) {
    res.set('Retry-After', String(error.retryAfterSeconds));
  }
  res.status(error.statusCode || 400).json({ success: false, message: error.message });
};

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

const buildProviderConversionPayload = (body = {}, files = {}) => {
  const payload = { ...(body || {}) };
  const userUpdates = {};

  const fullName = normalizeFullName(payload);
  if (fullName) {
    userUpdates.fullName = fullName;
  }
  delete payload.fullName;

  if ('gender' in payload) {
    userUpdates.gender = normalizeGender(payload.gender);
    delete payload.gender;
  }

  delete payload.email;
  delete payload.mobile;
  delete payload.password;
  delete payload.confirmPassword;

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

  return { payload, userUpdates };
};

const signup = async (req, res) => {
  try {
    const user = await authService.signup(req.body);
    res.status(201).json({
      success: true,
      message: 'User created, verify OTP',
      data: {
        user
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const login = async (req, res) => {
  try {
    const identifier = req.body.identifier || req.body.email;
    const { user, token } = await authService.login(identifier, req.body.password);
    res.json({
      success: true,
      message: 'Logged in',
      data: { user, token }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const verifyOTP = async (req, res) => {
  try {
    const { otp, type, identifier } = req.body;
    const { user, token } = await authService.verifyOTP(identifier, otp, type);
    res.json({
      success: true,
      message: 'Verified',
      data: { user, token }
    });
  } catch (error) {
    sendError(res, error);
  }
};

const resendOTP = async (req, res) => {
  try {
    const { email, mobile, type = 'email' } = req.body;
    const identifier = type === 'mobile' ? mobile : email;
    await authService.resendOTP(identifier, type);
    res.json({ success: true, message: 'OTP resent successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const sendPasswordResetOtp = async (req, res) => {
  try {
    await authService.sendPasswordResetOtp(req.body.email);
    res.json({ success: true, message: 'Password reset OTP sent successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const verifyPasswordResetOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    await authService.verifyPasswordResetOtp(email, otp);
    res.json({ success: true, message: 'OTP verified successfully' });
  } catch (error) {
    sendError(res, error);
  }
};

const resetPassword = async (req, res) => {
  try {
    const { email, otp, password } = req.body;
    await authService.resetPasswordWithOtp(email, otp, password);
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    sendError(res, error);
  }
};

const getPasswordEncryptionKey = (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    success: true,
    data: passwordCryptoService.publicDescriptor()
  });
};

const getCurrentUser = async (req, res) => {
  try {
    const user = await authService.getCurrentUserProfile(req.user._id);
    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateCurrentUser = async (req, res) => {
  try {
    const user = await authService.updateCurrentUserProfile(req.user._id, req.body);
    res.json({
      success: true,
      message: 'Profile updated',
      data: user
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateCurrentUserPreferences = async (req, res) => {
  try {
    const user = await authService.updateCurrentUserPreferences(req.user._id, req.body);
    res.json({
      success: true,
      message: 'Preferences updated',
      data: user
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateCurrentUserProfilePicture = async (req, res) => {
  try {
    const file = req.file || req.files?.profilePicture?.[0] || req.files?.image?.[0];
    if (!file?.path) {
      return res.status(400).json({ success: false, message: 'Profile image is required' });
    }

    if (!String(file.mimetype || '').toLowerCase().startsWith('image/')) {
      return res.status(400).json({ success: false, message: 'Upload a valid image file' });
    }

    const user = await authService.updateCurrentUserProfilePicture(req.user._id, file.path);
    res.json({
      success: true,
      message: 'Profile image updated',
      data: user
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const deactivateCurrentUserAccount = async (req, res) => {
  try {
    const user = await authService.deactivateCurrentUserAccount(req.user._id);
    res.json({
      success: true,
      message: 'Account deactivated. You can sign in and activate it again from your profile.',
      data: user
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const activateCurrentUserAccount = async (req, res) => {
  try {
    const user = await authService.activateCurrentUserAccount(req.user._id);
    res.json({
      success: true,
      message: 'Account activated. Any pending deletion request has been cancelled.',
      data: user
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const requestCurrentUserAccountDeletion = async (req, res) => {
  try {
    const user = await authService.requestCurrentUserAccountDeletion(req.user._id);
    res.json({
      success: true,
      message: 'Account deletion scheduled. Your account will stay deactivated for 30 days first.',
      data: user
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const becomeProvider = async (req, res) => {
  try {
    const { payload, userUpdates } = buildProviderConversionPayload(req.body, req.files || {});
    const { user, token, profile } = await authService.becomeProvider(req.user._id, payload, userUpdates);
    res.json({
      success: true,
      message: 'Provider profile started',
      data: { user, token, profile }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const requestBecomeProviderOtp = async (req, res) => {
  try {
    const { payload, userUpdates } = buildProviderConversionPayload(req.body);
    const user = await authService.requestProviderConversionOtp(req.user._id, payload, userUpdates);
    res.json({
      success: true,
      message: 'OTP sent to your account email',
      data: { user }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const verifyBecomeProviderOtp = async (req, res) => {
  try {
    const { user, token, profile } = await authService.verifyProviderConversionOtp(req.user._id, req.body?.otp);
    res.json({
      success: true,
      message: 'Provider account verified',
      data: { user, token, profile }
    });
  } catch (error) {
    sendError(res, error);
  }
};

const resendBecomeProviderOtp = async (req, res) => {
  try {
    const user = await authService.resendProviderConversionOtp(req.user._id);
    res.json({
      success: true,
      message: 'OTP resent to your account email',
      data: { user }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const sendSocialPopupResponse = (res, statusCode, targetOrigin, payload) => {
  res
    .status(statusCode)
    .set({
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8',
      'Cross-Origin-Opener-Policy': 'unsafe-none'
    })
    .send(socialAuthService.renderPopupResponse(targetOrigin, payload));
};

const startSocialAuth = async (req, res) => {
  const frontendOrigin = String(req.query.frontendOrigin || '').trim();
  try {
    const authorizationUrl = socialAuthService.createAuthorizationUrl(req.params.provider, req, {
      intent: req.query.intent,
      signupRole: req.query.signupRole,
      frontendOrigin,
      returnUrl: req.query.returnUrl,
      requestId: req.query.requestId
    });
    res
      .set({
        'Cache-Control': 'no-store',
        'Cross-Origin-Opener-Policy': 'unsafe-none'
      })
      .redirect(authorizationUrl);
  } catch (error) {
    sendSocialPopupResponse(res, 400, frontendOrigin || '*', {
      type: 'error',
      provider: req.params.provider,
      requestId: req.query.requestId,
      message: error.message
    });
  }
};

const handleSocialCallback = async (req, res) => {
  try {
    const result = await socialAuthService.handleCallback(req.params.provider, req);
    sendSocialPopupResponse(res, 200, result.targetOrigin, result.payload);
  } catch (error) {
    sendSocialPopupResponse(res, 400, '*', {
      type: 'error',
      provider: req.params.provider,
      message: error.message
    });
  }
};

module.exports = {
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
  updateCurrentUserPreferences,
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
};
