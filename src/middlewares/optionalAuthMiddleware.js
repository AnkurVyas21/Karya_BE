const jwt = require('jsonwebtoken');
const User = require('../models/User');

const optionalAuthMiddleware = async (req, _res, next) => {
  try {
    const header = String(req.header('Authorization') || '').trim();
    if (!header.startsWith('Bearer ')) {
      return next();
    }

    const token = header.slice(7).trim();
    if (!token) {
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (user && !user.isBanned) {
      req.user = user;
    }
  } catch (_error) {
    // Ignore invalid optional auth and continue as a public request.
  }

  next();
};

module.exports = optionalAuthMiddleware;
