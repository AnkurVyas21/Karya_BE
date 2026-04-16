const express = require('express');
const Joi = require('joi');
const multer = require('multer');
const validationMiddleware = require('../middlewares/validationMiddleware');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');
const advertisementCreativeService = require('../services/advertisementCreativeService');

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

const activeAdsSchema = Joi.object({
  city: Joi.string().trim().allow('').max(80).optional(),
  state: Joi.string().trim().allow('').max(80).optional(),
  placement: Joi.string().trim().valid('home', 'messages').optional(),
  globalOnly: Joi.boolean().truthy('true').truthy('1').falsy('false').falsy('0').optional(),
  limit: Joi.number().integer().min(1).max(8).optional()
});

const viewSchema = Joi.object({
  creativeId: Joi.string().trim().required()
});

const clickSchema = Joi.object({
  creativeId: Joi.string().trim().required()
});

const createCreativeSchema = Joi.object({
  advertisementId: Joi.string().trim().required(),
  level: Joi.string().trim().valid('city', 'state', 'national').required(),
  city: Joi.string().trim().allow('').max(80).optional(),
  state: Joi.string().trim().allow('').max(80).optional(),
  imageWidth: Joi.number().integer().min(0).max(8000).optional(),
  imageHeight: Joi.number().integer().min(0).max(8000).optional()
});

router.get('/active', validationMiddleware(activeAdsSchema, 'query'), async (req, res) => {
  try {
    const data = await advertisementCreativeService.getActiveCreatives({
      city: req.query.city,
      state: req.query.state,
      placement: req.query.placement,
      globalOnly: req.query.globalOnly,
      limit: req.query.limit
    });
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/view', validationMiddleware(viewSchema), async (req, res) => {
  try {
    await advertisementCreativeService.recordView({ creativeId: req.body.creativeId });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/click', validationMiddleware(clickSchema), async (req, res) => {
  try {
    await advertisementCreativeService.recordClick({ creativeId: req.body.creativeId });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Provider uploads creative after buying a pack.
router.post(
  '/creative',
  authMiddleware,
  roleMiddleware(['professional']),
  upload.single('image'),
  validationMiddleware(createCreativeSchema),
  async (req, res) => {
    try {
      const file = req.file;
      if (!file?.path) {
        return res.status(400).json({ success: false, message: 'Ad image is required' });
      }

      const data = await advertisementCreativeService.createOrReplaceCreative({
        userId: req.user._id,
        advertisementId: req.body.advertisementId,
        level: req.body.level,
        city: req.body.city,
        state: req.body.state,
        imagePath: file.path,
        imageWidth: req.body.imageWidth,
        imageHeight: req.body.imageHeight
      });

      res.status(201).json({ success: true, data });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }
);

module.exports = router;
