const express = require('express');
const authMiddleware = require('../middlewares/authMiddleware');
const {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead
} = require('../controllers/notificationController');

const router = express.Router();

router.use(authMiddleware);
router.get('/', listNotifications);
router.patch('/read-all', markAllNotificationsRead);
router.patch('/:id/read', markNotificationRead);

module.exports = router;
