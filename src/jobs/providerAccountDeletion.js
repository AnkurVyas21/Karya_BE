const cron = require('node-cron');
const ProfessionalProfile = require('../models/ProfessionalProfile');
const ProviderGrowth = require('../models/ProviderGrowth');
const ProviderWebsite = require('../models/ProviderWebsite');
const User = require('../models/User');
const logger = require('../utils/logger');

const purgeExpiredProviderDeletionRequests = async () => {
  const profiles = await ProfessionalProfile.find({
    accountStatus: 'deletion_scheduled',
    deletionScheduledAt: { $ne: null, $lte: new Date() }
  }).select('_id user');

  if (!profiles.length) {
    return;
  }

  for (const profile of profiles) {
    const userId = profile.user;

    await Promise.all([
      ProviderWebsite.updateMany(
        { providerId: userId },
        { $set: { status: 'unpublished', isPurchased: false } }
      ),
      ProviderGrowth.findOneAndUpdate(
        { user: userId },
        {
          $set: {
            'website.active': false,
            'boost.active': false
          },
          $unset: { websiteSlug: '' }
        }
      ),
      User.findByIdAndUpdate(userId, { role: 'user' }),
      ProfessionalProfile.deleteOne({ _id: profile._id })
    ]);
  }

  logger.info(`Purged ${profiles.length} provider accounts after 30-day deletion window`);
};

purgeExpiredProviderDeletionRequests().catch((error) => {
  logger.error('Provider account deletion purge failed', error);
});

cron.schedule('35 0 * * *', async () => {
  try {
    await purgeExpiredProviderDeletionRequests();
  } catch (error) {
    logger.error('Provider account deletion purge failed', error);
  }
});

module.exports = {
  purgeExpiredProviderDeletionRequests
};
