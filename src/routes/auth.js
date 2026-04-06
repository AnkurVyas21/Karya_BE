const express = require('express');
const { signup, login, verifyOTP, resendOTP } = require('../controllers/authController');
const authMiddleware = require('../middlewares/authMiddleware');
const validationMiddleware = require('../middlewares/validationMiddleware');
const Joi = require('joi');

const router = express.Router();

const signupSchema = Joi.object({
  firstName: Joi.string().required(),
  lastName: Joi.string().required(),
  email: Joi.string().email().required(),
  mobile: Joi.string().required(),
  password: Joi.string().min(6).required(),
  role: Joi.string().valid('user', 'professional').default('user')
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

const otpSchema = Joi.object({
  otp: Joi.string().required(),
  type: Joi.string().valid('mobile', 'email').required(),
  identifier: Joi.string().required() // email or mobile
});

router.post('/signup', validationMiddleware(signupSchema), signup);
router.post('/login', validationMiddleware(loginSchema), login);
router.post('/verify-otp', validationMiddleware(otpSchema), verifyOTP);
router.post('/resend-otp', resendOTP);

module.exports = router;
