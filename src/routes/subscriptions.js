const express = require('express');
const authMiddleware = require('../middlewares/authMiddleware');
const { subscriptionPlans, getSubscriptionPlan } = require('../constants/subscriptionPlans');
const paymentService = require('../services/paymentService');

const router = express.Router();

router.get('/plans', (req, res) => {
  res.json({ success: true, data: subscriptionPlans });
});

router.get('/plans/:id', (req, res) => {
  const plan = getSubscriptionPlan(req.params.id);
  if (!plan) {
    return res.status(404).json({ success: false, message: 'Plan not found' });
  }

  res.json({ success: true, data: plan });
});

router.get('/status', authMiddleware, async (req, res) => {
  try {
    const status = await paymentService.getSubscriptionStatus(req.user._id);
    if (!status) {
      return res.status(404).json({ success: false, message: 'No active subscription' });
    }

    res.json({ success: true, data: status });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = router;
