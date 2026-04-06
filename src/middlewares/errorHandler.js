const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  logger.error(err.stack);
  res.status(500).json({ success: false, message: 'Something went wrong!' });
};

module.exports = errorHandler;