const authService = require('../services/authService');
const { socialAuthService } = require('../services/socialAuthService');

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
    res.status(400).json({ success: false, message: error.message });
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
    res.status(400).json({ success: false, message: error.message });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { email, otp, password } = req.body;
    await authService.resetPasswordWithOtp(email, otp, password);
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
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

const becomeProvider = async (req, res) => {
  try {
    const { user, token } = await authService.becomeProvider(req.user._id);
    res.json({
      success: true,
      message: 'Provider profile started',
      data: { user, token }
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
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups'
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
      returnUrl: req.query.returnUrl
    });
    res.redirect(authorizationUrl);
  } catch (error) {
    sendSocialPopupResponse(res, 400, frontendOrigin || '*', {
      type: 'error',
      provider: req.params.provider,
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
  sendPasswordResetOtp,
  verifyPasswordResetOtp,
  resetPassword,
  getCurrentUser,
  updateCurrentUser,
  becomeProvider,
  startSocialAuth,
  handleSocialCallback
};
