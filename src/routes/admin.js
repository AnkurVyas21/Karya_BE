const express = require('express');
const User = require('../models/User');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');
const persistUploadedFiles = require('../middlewares/persistUploadedFiles');
const adminService = require('../services/adminService');
const advertisementCreativeService = require('../services/advertisementCreativeService');
const websiteTemplateMediaService = require('../services/websiteTemplateMediaService');
const multer = require('multer');
const { getUploadDestination } = require('../utils/uploadPaths');

const router = express.Router();
const upload = multer({ dest: getUploadDestination(), limits: { fileSize: 30 * 1024 * 1024 } });

router.use(authMiddleware, roleMiddleware(['admin']));

router.get('/overview', async (req, res) => {
  try {
    const data = await adminService.getOverview({
      from: req.query.from,
      to: req.query.to
    });
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.get('/users', async (_req, res) => {
  try {
    const data = await adminService.getUsers();
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.get('/providers', async (_req, res) => {
  try {
    const data = await adminService.getProviders();
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.get('/providers/:id', async (req, res) => {
  try {
    const data = await adminService.getProviderDetails(req.params.id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.patch('/providers/:id/verification', async (req, res) => {
  try {
    const data = await adminService.setProviderVerification(req.params.id, req.body || {});
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.get('/transactions', async (_req, res) => {
  try {
    const data = await adminService.getTransactions();
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.get('/professions', async (_req, res) => {
  try {
    const data = await adminService.getProfessions();
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.get('/customer-requests', async (_req, res) => {
  try {
    const data = await adminService.getCustomerRequests();
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.patch('/customer-requests/bookings/:id/email', async (req, res) => {
  try {
    const data = await adminService.updateCustomerRequestBookingEmail(req.params.id, req.body || {});
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/customer-requests/bookings/:id/resend-otp', async (req, res) => {
  try {
    const data = await adminService.resendCustomerRequestBookingOtp(req.params.id);
    res.json({ success: true, data, message: 'OTP resent to the customer email.' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.patch('/customer-requests/bookings/:id/status', async (req, res) => {
  try {
    const data = await adminService.updateCustomerRequestBookingStatus(req.params.id, req.body || {});
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.patch('/customer-requests/bookings/:id/payment', async (req, res) => {
  try {
    const data = await adminService.updateCustomerRequestBookingPayment(req.params.id, req.body || {});
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.get('/website-template-media', async (_req, res) => {
  try {
    const data = await websiteTemplateMediaService.list();
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/website-template-media', upload.single('media'), persistUploadedFiles, async (req, res) => {
  try {
    const data = await websiteTemplateMediaService.create(req.body || {}, req.file, req.user?._id);
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.patch('/website-template-media/:id', async (req, res) => {
  try {
    const data = await websiteTemplateMediaService.update(req.params.id, req.body || {});
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.delete('/website-template-media/:id', async (req, res) => {
  try {
    const data = await websiteTemplateMediaService.remove(req.params.id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.get('/ads', async (req, res) => {
  try {
    const data = await advertisementCreativeService.listForAdmin({ status: req.query.status || '' });
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.get('/ads/:id', async (req, res) => {
  try {
    const data = await advertisementCreativeService.getForAdmin({ creativeId: req.params.id });
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.patch('/ads/:id/status', async (req, res) => {
  try {
    const data = await advertisementCreativeService.setStatus({
      creativeId: req.params.id,
      status: req.body.status,
      rejectionReason: req.body.rejectionReason || ''
    });
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.patch('/ads/:id/pause', async (req, res) => {
  try {
    const paused = Boolean(req.body.paused);
    const data = await advertisementCreativeService.setCampaignPaused({
      creativeId: req.params.id,
      paused,
      adminId: req.user?._id,
      note: req.body.note || ''
    });
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/ads/:id/message', async (req, res) => {
  try {
    const data = await advertisementCreativeService.addAdminMessage({
      creativeId: req.params.id,
      adminId: req.user?._id,
      message: req.body.message || ''
    });
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.delete('/ads/:id', async (req, res) => {
  try {
    const data = await advertisementCreativeService.deleteForAdmin({
      creativeId: req.params.id,
      adminId: req.user?._id,
      note: req.body?.note || 'Deleted by admin. This campaign is not refundable and has been removed from live placements.'
    });
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.patch('/ban/:id', async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.id, { isBanned: true });
    res.json({ success: true, message: 'User banned' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.patch('/unban/:id', async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.id, { isBanned: false });
    res.json({ success: true, message: 'User unbanned' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = router;
