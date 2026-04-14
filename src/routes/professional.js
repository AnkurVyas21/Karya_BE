const express = require('express');
const {
  createProfile,
  searchProfessionals,
  aiSearch,
  getProfile,
  createReview,
  createBookmark,
  createSubscription,
  getGrowthDashboard,
  activateGrowthFeature,
  updateWebsiteProfile,
  submitVerification,
  getGrowthActivity,
  getWebsiteBySlug,
  detectProfession,
  getProfessions,
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
router.put('/profile', authMiddleware, roleMiddleware(['professional', 'admin']), upload.fields([{ name: 'profilePicture', maxCount: 1 }, { name: 'certificates', maxCount: 5 }]), updateProfile);
router.get('/dashboard/summary', authMiddleware, roleMiddleware(['professional', 'admin']), getDashboardSummary);
router.get('/growth/dashboard', authMiddleware, roleMiddleware(['professional', 'admin']), getGrowthDashboard);
router.get('/growth/activity', authMiddleware, roleMiddleware(['professional', 'admin']), getGrowthActivity);
router.post('/growth/activate', authMiddleware, roleMiddleware(['professional']), activateGrowthFeature);
router.put(
  '/growth/website',
  authMiddleware,
  roleMiddleware(['professional']),
  upload.fields([{ name: 'websiteImages', maxCount: 8 }, { name: 'websiteVideos', maxCount: 3 }]),
  updateWebsiteProfile
);
router.post(
  '/growth/verification',
  authMiddleware,
  roleMiddleware(['professional']),
  upload.fields([{ name: 'aadhaarDocument', maxCount: 1 }, { name: 'panDocument', maxCount: 1 }]),
  submitVerification
);
router.get('/professions', getProfessions);
router.get('/search', searchProfessionals);
router.post('/search/ai', aiSearch);
router.get('/bookmarks', authMiddleware, getBookmarks);
router.delete('/bookmark/:id', authMiddleware, removeBookmark);
router.get('/website/:slug', getWebsiteBySlug);
router.get('/:id/ratings', getRatings);
router.get('/:id', getProfile);
router.post('/review', authMiddleware, createReview);
router.post('/bookmark', authMiddleware, createBookmark);
router.post('/subscription', authMiddleware, roleMiddleware(['professional']), createSubscription);
router.post('/detect-profession', detectProfession);

module.exports = router;
