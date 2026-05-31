const cron = require('node-cron');
const AdvertisementCreative = require('../models/AdvertisementCreative');
const Bookmark = require('../models/Bookmark');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const OTPVerification = require('../models/OTPVerification');
const ProfessionalProfile = require('../models/ProfessionalProfile');
const ProviderArticle = require('../models/ProviderArticle');
const ProviderBooking = require('../models/ProviderBooking');
const ProviderGrowth = require('../models/ProviderGrowth');
const ProviderLead = require('../models/ProviderLead');
const ProviderOffer = require('../models/ProviderOffer');
const ProviderProduct = require('../models/ProviderProduct');
const ProviderProductOrder = require('../models/ProviderProductOrder');
const ProviderSEOConfig = require('../models/ProviderSEOConfig');
const ProviderService = require('../models/ProviderService');
const ProviderThemeConfig = require('../models/ProviderThemeConfig');
const ProviderWebsite = require('../models/ProviderWebsite');
const Review = require('../models/Review');
const Subscription = require('../models/Subscription');
const User = require('../models/User');
const WebsiteTransaction = require('../models/WebsiteTransaction');
const logger = require('../utils/logger');

const purgeExpiredUserDeletionRequests = async () => {
  const users = await User.find({
    accountStatus: 'deletion_scheduled',
    deletionScheduledAt: { $ne: null, $lte: new Date() }
  }).select('_id');

  if (!users.length) {
    return;
  }

  for (const user of users) {
    const userId = user._id;
    const profileIds = (await ProfessionalProfile.find({ user: userId }).select('_id'))
      .map((profile) => profile._id);
    const conversationIds = (await Conversation.find({
      $or: [{ customer: userId }, { professional: userId }]
    }).select('_id')).map((conversation) => conversation._id);

    await Promise.all([
      AdvertisementCreative.deleteMany({ user: userId }),
      Bookmark.deleteMany({ $or: [{ user: userId }, { professional: { $in: profileIds } }] }),
      Message.deleteMany({ $or: [{ conversation: { $in: conversationIds } }, { sender: userId }] }),
      Conversation.deleteMany({ _id: { $in: conversationIds } }),
      Notification.deleteMany({ userId }),
      OTPVerification.deleteMany({ user: userId }),
      Review.deleteMany({ $or: [{ user: userId }, { professional: { $in: profileIds } }] }),
      Subscription.deleteMany({ user: userId }),
      ProviderArticle.deleteMany({ providerId: userId }),
      ProviderBooking.deleteMany({ providerId: userId }),
      ProviderGrowth.deleteMany({ user: userId }),
      ProviderLead.deleteMany({ providerId: userId }),
      ProviderOffer.deleteMany({ providerId: userId }),
      ProviderProduct.deleteMany({ providerId: userId }),
      ProviderProductOrder.deleteMany({ providerId: userId }),
      ProviderSEOConfig.deleteMany({ providerId: userId }),
      ProviderService.deleteMany({ providerId: userId }),
      ProviderThemeConfig.deleteMany({ providerId: userId }),
      ProviderWebsite.deleteMany({ providerId: userId }),
      WebsiteTransaction.deleteMany({ providerId: userId }),
      ProfessionalProfile.deleteMany({ user: userId }),
      User.deleteOne({ _id: userId })
    ]);
  }

  logger.info(`Purged ${users.length} user accounts after 30-day deletion window`);
};

purgeExpiredUserDeletionRequests().catch((error) => {
  logger.error('User account deletion purge failed', error);
});

cron.schedule('45 0 * * *', async () => {
  try {
    await purgeExpiredUserDeletionRequests();
  } catch (error) {
    logger.error('User account deletion purge failed', error);
  }
});

module.exports = {
  purgeExpiredUserDeletionRequests
};
