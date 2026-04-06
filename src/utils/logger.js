const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

logger.add(new winston.transports.Console({
  format: process.env.NODE_ENV === 'production'
    ? winston.format.json()
    : winston.format.simple(),
}));

module.exports = logger;
