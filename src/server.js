require('dotenv').config();
const app = require('./app');
const mongoose = require('mongoose');
const logger = require('./utils/logger');
const adminService = require('./services/adminService');
const ProviderGrowth = require('./models/ProviderGrowth');

const ensureProviderGrowthSlugIndex = async () => {
  try {
    // Old index: unique on websiteSlug with default null -> duplicates on { websiteSlug: null }
    // Drop it if present and recreate a partial unique index only for string slugs.
    await ProviderGrowth.collection.dropIndex('websiteSlug_1').catch(() => undefined);
    await ProviderGrowth.collection.createIndex(
      { websiteSlug: 1 },
      { unique: true, partialFilterExpression: { websiteSlug: { $type: 'string', $ne: '' } } }
    );
    logger.info('ProviderGrowth websiteSlug index ensured');
  } catch (error) {
    logger.error('ProviderGrowth websiteSlug index ensure failed', {
      message: error.message,
      stack: error.stack
    });
  }
};

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    logger.info('Connected to MongoDB');
    await ensureProviderGrowthSlugIndex();
    try {
      await adminService.ensureDefaultAdminAccount();
    } catch (error) {
      logger.error('Default admin bootstrap failed', {
        message: error.message,
        stack: error.stack
      });
    }

    // Start cron jobs after the database is ready
    require('./jobs/subscriptionExpiry');
    require('./jobs/messageRetention');

    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      logger.info(`Server running on port ${port}`);
    });
  })
  .catch((error) => {
    logger.error('MongoDB connection error:', error);
  });
