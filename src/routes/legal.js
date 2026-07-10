const express = require('express');
const legalDocumentService = require('../services/legalDocumentService');

const router = express.Router();

router.get('/:type', async (req, res) => {
  try {
    const data = await legalDocumentService.getPublicDocument(req.params.type);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = router;
