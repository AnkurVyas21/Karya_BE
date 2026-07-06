const passwordCryptoService = require('../services/passwordCryptoService');

const decryptPasswordPayload = (req, res, next) => {
  try {
    if (req.body?.passwordEncrypted) {
      req.body.password = passwordCryptoService.decryptPassword(req.body.passwordEncrypted);
      delete req.body.passwordEncrypted;
    }

    next();
  } catch (_error) {
    res.status(400).json({
      success: false,
      message: 'Unable to decrypt password. Please refresh the page and try again.'
    });
  }
};

module.exports = decryptPasswordPayload;
