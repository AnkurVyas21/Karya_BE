const cron = require('node-cron');
const Subscription = require('../models/Subscription');
const logger = require('../utils/logger');

cron.schedule('0 0 * * *', async () => {
  const now = new Date();
  const result = await Subscription.updateMany({ expiryDate: { $lt: now }, status: 'active' }, { status: 'expired' });
  logger.info(`Expired ${result.modifiedCount} subscriptions`);
});