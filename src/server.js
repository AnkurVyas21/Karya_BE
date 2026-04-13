require('dotenv').config();
const app = require('./app');
const mongoose = require('mongoose');
const logger = require('./utils/logger');
const adminService = require('./services/adminService');

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    logger.info('Connected to MongoDB');
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
