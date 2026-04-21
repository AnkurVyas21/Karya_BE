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
  getWebsitePreviewBySlug,
  getWebsiteManager,
  saveWebsiteManager,
  updateWebsitePublishStatus,
  createWebsiteInquiry,
  createWebsiteBooking,
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
const optionalAuthMiddleware = require('../middlewares/optionalAuthMiddleware');
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
router.get('/growth/website-manager', authMiddleware, roleMiddleware(['professional', 'admin']), getWebsiteManager);
router.post('/growth/activate', authMiddleware, roleMiddleware(['professional']), activateGrowthFeature);
router.put(
  '/growth/website',
  authMiddleware,
  roleMiddleware(['professional']),
  upload.fields([{ name: 'websiteImages', maxCount: 8 }, { name: 'websiteVideos', maxCount: 3 }, { name: 'backgroundAudio', maxCount: 1 }]),
  updateWebsiteProfile
);
router.put(
  '/growth/website-manager',
  authMiddleware,
  roleMiddleware(['professional']),
  upload.fields([
    { name: 'heroImage', maxCount: 1 },
    { name: 'logoImage', maxCount: 1 },
    { name: 'galleryImages', maxCount: 12 },
    { name: 'galleryVideos', maxCount: 6 }
  ]),
  saveWebsiteManager
);
router.patch('/growth/website-manager/publish', authMiddleware, roleMiddleware(['professional']), updateWebsitePublishStatus);
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
router.get('/website/preview/:slug', authMiddleware, roleMiddleware(['professional', 'admin']), getWebsitePreviewBySlug);
router.get('/website/:slug', optionalAuthMiddleware, getWebsiteBySlug);
router.post('/website/:slug/inquiries', optionalAuthMiddleware, createWebsiteInquiry);
router.post('/website/:slug/bookings', optionalAuthMiddleware, createWebsiteBooking);
router.get('/:id/ratings', getRatings);
router.get('/:id', getProfile);
router.post('/review', authMiddleware, createReview);
router.post('/bookmark', authMiddleware, createBookmark);
router.post('/subscription', authMiddleware, roleMiddleware(['professional']), createSubscription);
router.post('/detect-profession', detectProfession);

module.exports = router;
