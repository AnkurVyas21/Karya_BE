const express = require('express');
const {
  createProfile,
  searchProfessionals,
  aiSearch,
  getProfile,
  createReview,
  createBookmark,
  createSubscription,
  detectProfession,
  getMyProfile,
  updateProfile,
  getRatings,
  getBookmarks,
  removeBookmark,
  getDashboardSummary
} = require('../controllers/professionalController');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

const router = express.Router();

router.post('/profile', authMiddleware, roleMiddleware(['professional']), upload.fields([{ name: 'profilePicture', maxCount: 1 }, { name: 'certificates', maxCount: 5 }]), createProfile);
router.get('/profile', authMiddleware, roleMiddleware(['professional', 'admin']), getMyProfile);
router.put('/profile', authMiddleware, roleMiddleware(['professional', 'admin']), updateProfile);
router.get('/dashboard/summary', authMiddleware, roleMiddleware(['professional', 'admin']), getDashboardSummary);
router.get('/search', searchProfessionals);
router.post('/search/ai', aiSearch);
router.get('/bookmarks', authMiddleware, getBookmarks);
router.delete('/bookmark/:id', authMiddleware, removeBookmark);
router.get('/:id/ratings', getRatings);
router.get('/:id', getProfile);
router.post('/review', authMiddleware, createReview);
router.post('/bookmark', authMiddleware, createBookmark);
router.post('/subscription', authMiddleware, roleMiddleware(['professional']), createSubscription);
router.post('/detect-profession', detectProfession);

module.exports = router;
