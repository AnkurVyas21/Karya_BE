const Subscription = require('../models/Subscription');
const logger = require('../utils/logger');
const { getSubscriptionPlan } = require('../constants/subscriptionPlans');

class PaymentService {
  inferPlan(subscription) {
    let inferredPlanId = 'growth';
    const durationDays = Math.round((subscription.expiryDate - subscription.startDate) / (24 * 60 * 60 * 1000));
    if (durationDays <= 35) {
      inferredPlanId = 'starter';
    } else if (durationDays >= 170) {
      inferredPlanId = 'pro';
    }

    return getSubscriptionPlan(inferredPlanId);
  }

  async createSubscription(userId, planId = 'growth') {
    const plan = getSubscriptionPlan(planId);
    if (!plan) {
      throw new Error('Invalid subscription plan');
    }

    await Subscription.updateMany({ user: userId, status: 'active' }, { status: 'expired' });

    const paymentId = 'mock_' + Date.now();
    const startDate = new Date();
    const expiryDate = new Date(startDate.getTime() + plan.durationMonths * 30 * 24 * 60 * 60 * 1000);
    const subscription = new Subscription({ user: userId, paymentId, startDate, expiryDate });
    await subscription.save();
    logger.info(`Subscription created for user: ${userId}, plan: ${plan.id}`);
    return { ...subscription.toObject(), plan };
  }

  async getSubscriptionStatus(userId) {
    const subscription = await Subscription.findOne({ user: userId, status: 'active' }).sort({ expiryDate: -1 });
    if (!subscription) {
      return null;
    }

    const plan = this.inferPlan(subscription);

    return {
      id: subscription._id.toString(),
      paymentId: subscription.paymentId,
      status: subscription.status,
      startDate: subscription.startDate,
      expiryDate: subscription.expiryDate,
      plan
    };
  }

  async getSubscriptionHistory(userId) {
    const subscriptions = await Subscription.find({ user: userId }).sort({ startDate: -1 });

    return subscriptions.map((subscription) => ({
      id: subscription._id.toString(),
      paymentId: subscription.paymentId,
      status: subscription.status,
      startDate: subscription.startDate,
      expiryDate: subscription.expiryDate,
      createdAt: subscription.createdAt || subscription.startDate,
      updatedAt: subscription.updatedAt || subscription.expiryDate,
      plan: this.inferPlan(subscription)
    }));
  }
}

module.exports = new PaymentService();
