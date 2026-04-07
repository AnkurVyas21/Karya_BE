const authService = require('../services/authService');

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
    await authService.verifyOTP(identifier, otp, type);
    res.json({ success: true, message: 'Verified' });
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

module.exports = { signup, login, verifyOTP, resendOTP };
