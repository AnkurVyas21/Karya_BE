const express = require('express');
const Joi = require('joi');
const validationMiddleware = require('../middlewares/validationMiddleware');
const adminService = require('../services/adminService');

const router = express.Router();

const trackVisitSchema = Joi.object({
  visitorId: Joi.string().trim().max(100).required(),
  path: Joi.string().trim().max(220).required(),
  pageType: Joi.string().trim().allow('').max(80).optional(),
  referrer: Joi.string().trim().allow('').max(500).optional()
});

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (Array.isArray(forwarded)) {
    return String(forwarded[0] || '').split(',')[0].trim();
  }

  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || '';
};

router.post('/visit', validationMiddleware(trackVisitSchema), async (req, res) => {
  try {
    const visit = await adminService.recordSiteVisit({
      ...req.body,
      userAgent: req.get('user-agent') || '',
      ipAddress: getClientIp(req)
    });

    res.status(201).json({
      success: true,
      data: visit
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = router;
