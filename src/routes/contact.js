const express = require('express');
const Joi = require('joi');
const validationMiddleware = require('../middlewares/validationMiddleware');
const receiptEmailService = require('../services/receiptEmailService');

const router = express.Router();

const contactSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).required(),
  email: Joi.string().trim().email().max(160).required(),
  category: Joi.string().trim().max(80).required(),
  message: Joi.string().trim().min(10).max(4000).required()
});

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

router.post('/', validationMiddleware(contactSchema), async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim();
  const category = String(req.body.category || '').trim();
  const message = String(req.body.message || '').trim();

  const sent = await receiptEmailService.sendReceipt({
    to: 'support@nasdiya.com',
    subject: `Nasdiya Contact/Feedback: ${category}`,
    replyTo: email,
    html: `
      <h2>New Contact/Feedback Message</h2>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Category:</strong> ${escapeHtml(category)}</p>
      <p><strong>Message:</strong></p>
      <p style="white-space: pre-line;">${escapeHtml(message)}</p>
    `
  });

  if (!sent) {
    return res.status(503).json({
      success: false,
      message: 'Could not send your message right now. Please email support@nasdiya.com directly.'
    });
  }

  res.status(201).json({ success: true });
});

module.exports = router;
