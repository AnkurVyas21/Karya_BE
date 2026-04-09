const cron = require('node-cron');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const logger = require('../utils/logger');

const purgeExpiredDeletedConversations = async () => {
  const threshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const conversations = await Conversation.find({
    customerDeletedAt: { $ne: null, $lte: threshold },
    professionalDeletedAt: { $ne: null, $lte: threshold }
  }).select('_id');

  if (!conversations.length) {
    return;
  }

  const ids = conversations.map((conversation) => conversation._id);
  await Message.deleteMany({ conversation: { $in: ids } });
  const result = await Conversation.deleteMany({ _id: { $in: ids } });
  logger.info(`Purged ${result.deletedCount} conversations after 30-day retention`);
};

purgeExpiredDeletedConversations().catch((error) => {
  logger.error('Message retention purge failed', error);
});

cron.schedule('15 0 * * *', async () => {
  try {
    await purgeExpiredDeletedConversations();
  } catch (error) {
    logger.error('Message retention purge failed', error);
  }
});
