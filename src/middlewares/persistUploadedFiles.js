const mediaStorageService = require('../services/mediaStorageService');

module.exports = async (req, res, next) => {
  try {
    await mediaStorageService.persistRequestFiles(req);
    next();
  } catch (error) {
    next(error);
  }
};
