const ProviderGrowth = require('../models/ProviderGrowth');
const User = require('../models/User');
const ProfessionalProfile = require('../models/ProfessionalProfile');
const AdvertisementCreative = require('../models/AdvertisementCreative');
const logger = require('../utils/logger');
const advertisementCreativeService = require('./advertisementCreativeService');

const BOOST_PLAN = {
  id: 'boost',
  name: 'Boost Visibility',
  price: 99,
  billing: 'monthly',
  tagline: 'Get up to 3X more visibility and reach more customers.',
  benefits: [
    'Priority ranking in search results',
    'Higher appearance frequency in listings',
    'Great for providers who want faster lead growth'
  ]
};

const WEBSITE_PLAN = {
  id: 'website',
  name: 'Personal Website',
  price: 299,
  billing: 'monthly',
  tagline: 'Create a digital shop that looks polished and trustworthy.',
  includesBoost: true,
  benefits: [
    'Mini website inside the platform',
    'Unique shareable URL',
    'Detailed description, gallery, and booking section',
    'Boost Visibility included automatically'
  ]
};

const VERIFICATION_PLAN = {
  id: 'verification',
  name: 'Verification Badge',
  price: 99,
  billing: 'one-time',
  tagline: 'Show customers that your identity has been reviewed.',
  benefits: [
    'Verified label on profile and search results',
    'Higher trust with new customers',
    'Better chances of getting leads',
    'Small ranking advantage in discovery'
  ]
};

const ADVERTISEMENT_PLANS = [
  {
    id: 'ads-50k',
    name: 'Stadium Reach',
    price: 299,
    impressions: 50000,
    durationDays: 30,
    comparison: 'About the size of a full cricket stadium crowd.',
    tagline: '50,000 impressions over 30 days, whichever comes first.',
    benefits: [
      'Good for a strong local awareness push',
      'Tracked impressions with auto-stop at limit or 30 days',
      'Comparable to reaching one packed cricket stadium audience'
    ]
  },
  {
    id: 'ads-100k',
    name: 'Office Reach',
    price: 499,
    impressions: 100000,
    durationDays: 30,
    comparison: 'Comparable to reaching people across about 1,000 mid-sized offices of 100 employees each.',
    tagline: '100,000 impressions over 30 days, whichever comes first.',
    benefits: [
      'Designed for stronger repeat visibility',
      'Tracked impressions with auto-stop at limit or 30 days',
      'Comparable to visibility across around 1,000 offices'
    ]
  },
  {
    id: 'ads-250k',
    name: 'Town Reach',
    price: 999,
    impressions: 250000,
    durationDays: 30,
    comparison: 'Comparable to the population reach of a small city or town.',
    tagline: '250,000 impressions over 30 days, whichever comes first.',
    benefits: [
      'Best for wide-area brand recall',
      'Tracked impressions with auto-stop at limit or 30 days',
      'Comparable to reaching a small city or town population'
    ]
  }
];

const ADVERTISEMENT_LEVELS = [
  { id: 'city', label: 'City' },
  { id: 'state', label: 'State' },
  { id: 'national', label: 'Global' }
];

const addDays = (date, days) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
const getAdRunStart = (ad = {}) => ad?.startsAt || ad?.createdAt || null;

const cleanString = (value) => String(value || '').trim();
const normalizeCity = (value) => cleanString(value).replace(/\s+/g, ' ');
const normalizeState = (value) => cleanString(value).replace(/\s+/g, ' ');
const pickWebsiteAudio = (website = {}) => cleanString(website.backgroundAudioFile) || cleanString(website.backgroundAudioUrl);

const slugify = (value = '') => cleanString(value)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 60);

const areNamesConsistent = (left = '', right = '') => {
  const normalizedLeft = slugify(left).replace(/-/g, ' ');
  const normalizedRight = slugify(right).replace(/-/g, ' ');
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  return normalizedLeft === normalizedRight
    || normalizedLeft.includes(normalizedRight)
    || normalizedRight.includes(normalizedLeft);
};

const areMobilesConsistent = (left = '', right = '') => {
  const normalizedLeft = String(left || '').replace(/[^\d]/g, '');
  const normalizedRight = String(right || '').replace(/[^\d]/g, '');
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  return normalizedLeft === normalizedRight;
};

class ProviderGrowthService {
  async getOrCreateState(userId) {
    let state = await ProviderGrowth.findOne({ user: userId });
    if (!state) {
      state = await ProviderGrowth.create({ user: userId });
    }

    return this.normalizeState(state);
  }

  async normalizeState(state) {
    if (!state) {
      return null;
    }

    let changed = false;
    const now = new Date();

    if (state.boost?.active && state.boost.expiryDate && state.boost.expiryDate < now) {
      state.boost.active = false;
      changed = true;
    }

    if (state.website?.active && state.website.expiryDate && state.website.expiryDate < now) {
      state.website.active = false;
      changed = true;
    }

    const nextAdvertisements = (state.advertisements || []).map((ad) => {
      if (ad.status === 'scheduled' && ad.startsAt && ad.startsAt <= now) {
        ad.status = 'active';
        changed = true;
      }
      const runStart = getAdRunStart(ad);
      if (ad.status === 'active' && runStart && addDays(new Date(runStart), 30) < now) {
        ad.status = 'completed';
        ad.completedAt = ad.completedAt || now;
        changed = true;
      }
      if (ad.status === 'active' && Number(ad.impressionsUsed || 0) >= Number(ad.impressionsTotal || 0)) {
        ad.status = 'completed';
        ad.completedAt = ad.completedAt || new Date();
        changed = true;
      }
      return ad;
    });
    state.advertisements = nextAdvertisements;

    if (changed) {
      await state.save();
    }

    return state;
  }

  async ensureWebsiteSlug(state, userId) {
    if (state.websiteSlug) {
      return state.websiteSlug;
    }

    const user = await User.findById(userId).lean();
    const base = slugify([user?.firstName, user?.lastName].filter(Boolean).join(' ')) || `provider-${String(userId).slice(-6)}`;
    let candidate = base;
    let suffix = 2;

    while (await ProviderGrowth.exists({ websiteSlug: candidate, user: { $ne: userId } })) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }

    state.websiteSlug = candidate;
    await state.save();
    return candidate;
  }

  async getDashboard(userId) {
    const [state, profile, user, creativeMap] = await Promise.all([
      this.getOrCreateState(userId),
      ProfessionalProfile.findOne({ user: userId }).lean(),
      User.findById(userId).lean(),
      advertisementCreativeService.getCreativeMapForUser(userId)
    ]);

    const websiteSlug = state.websiteSlug || (state.website?.active ? await this.ensureWebsiteSlug(state, userId) : '');
    const visibleAds = (state.advertisements || []).filter((item) => item.status === 'active' || item.status === 'scheduled');
    const activeAds = visibleAds.filter((item) => item.status === 'active');
    const runningAds = activeAds.filter((item) => !item.paused);
    const usedImpressions = activeAds.reduce((sum, item) => sum + Number(item.impressionsUsed || 0), 0);
    const totalImpressions = activeAds.reduce((sum, item) => sum + Number(item.impressionsTotal || 0), 0);

    return {
      freeSignup: {
        enabled: true,
        title: 'Provider signup is free',
        note: 'Providers can register, complete profiles, and start appearing on the platform without paying upfront.'
      },
      profileOverview: {
        fullName: [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim(),
        profession: profile?.profession || '',
        location: profile?.location || '',
        profileViews: Number(profile?.viewCount || 0),
        websiteUrlPath: websiteSlug ? `/provider/site/${websiteSlug}` : '',
        isProfileComplete: Boolean(profile?.profession && (profile?.location || profile?.city || profile?.state))
      },
      boost: {
        ...BOOST_PLAN,
        status: this.getBoostStatus(state),
        active: this.hasActiveBoost(state),
        expiresAt: state.boost?.expiryDate || null
      },
      website: {
        ...WEBSITE_PLAN,
        status: this.getWebsiteStatus(state),
        active: this.hasActiveWebsite(state),
        expiresAt: state.website?.expiryDate || null,
        slug: websiteSlug || '',
        websiteUrlPath: websiteSlug ? `/provider/site/${websiteSlug}` : '',
        headline: cleanString(state.website?.headline),
        description: cleanString(state.website?.description) || cleanString(profile?.description),
        backgroundAudioUrl: pickWebsiteAudio(state.website),
        bookingEnabled: state.website?.bookingEnabled !== false,
        appointmentNote: cleanString(state.website?.appointmentNote),
        imageCount: Array.isArray(state.website?.galleryImages) ? state.website.galleryImages.length : 0,
        videoCount: Array.isArray(state.website?.galleryVideos) ? state.website.galleryVideos.length : 0
      },
      advertisements: {
        levels: ADVERTISEMENT_LEVELS,
        plans: ADVERTISEMENT_PLANS,
        activeCount: runningAds.length,
        pausedCount: activeAds.length - runningAds.length,
        totalImpressions,
        usedImpressions,
        remainingImpressions: Math.max(totalImpressions - usedImpressions, 0),
        status: runningAds.length > 0 ? 'Running' : activeAds.length > 0 ? 'Paused' : 'Not active',
        items: visibleAds.map((item) => ({
          id: item._id.toString(),
          level: item.level,
          planId: item.planId,
          planName: item.planName,
          amount: item.amount,
          impressionsTotal: item.impressionsTotal,
          impressionsUsed: item.impressionsUsed,
          impressionsRemaining: Math.max(Number(item.impressionsTotal || 0) - Number(item.impressionsUsed || 0), 0),
          expiresAt: getAdRunStart(item) ? addDays(new Date(getAdRunStart(item)), 30) : null,
          startsAt: getAdRunStart(item),
          status: item.status,
          paused: Boolean(item.paused),
          pausedAt: item.pausedAt || null,
          pauseNote: cleanString(item.pauseNote),
          creative: creativeMap.get(String(item._id)) || null,
          createdAt: item.createdAt
        }))
      },
      verification: {
        ...VERIFICATION_PLAN,
        status: this.getVerificationStatus(state),
        badgeActive: Boolean(state.verification?.badgeActive),
        feePaid: Boolean(state.verification?.feePaid),
        paidAt: state.verification?.paidAt || null,
        rejectionReason: cleanString(state.verification?.rejectionReason),
        reviewerNotes: cleanString(state.verification?.reviewerNotes),
        submittedAt: state.verification?.submittedAt || null,
        reviewedAt: state.verification?.reviewedAt || null,
        nameMatch: Boolean(state.verification?.nameMatch),
        mobileMatch: Boolean(state.verification?.mobileMatch)
      }
    };
  }

  hasActiveBoost(state) {
    const boostActive = Boolean(state?.boost?.active && state.boost?.expiryDate && state.boost.expiryDate > new Date());
    const websiteIncludesBoost = Boolean(state?.website?.active && state.website?.expiryDate && state.website.expiryDate > new Date());
    return boostActive || websiteIncludesBoost;
  }

  hasActiveWebsite(state) {
    return Boolean(state?.website?.active && state.website?.expiryDate && state.website.expiryDate > new Date());
  }

  hasVerificationBadge(state) {
    return Boolean(state?.verification?.badgeActive && state?.verification?.status === 'approved');
  }

  getBoostStatus(state) {
    return this.hasActiveBoost(state) ? 'Boosted' : 'Free';
  }

  getWebsiteStatus(state) {
    return this.hasActiveWebsite(state) ? 'Live' : 'Not active';
  }

  getVerificationStatus(state) {
    const status = cleanString(state?.verification?.status || 'not_started');
    if (status === 'approved') return 'Verified';
    if (status === 'pending') return 'Under review';
    if (status === 'rejected') return 'Rejected';
    return 'Not verified';
  }

  async activateFeature(userId, payload = {}) {
    const feature = cleanString(payload.feature).toLowerCase();
    const state = await this.getOrCreateState(userId);
    const now = new Date();

    if (feature === 'boost') {
      state.boost.active = true;
      state.boost.startDate = now;
      state.boost.expiryDate = addDays(now, 30);
      state.boost.monthlyPrice = BOOST_PLAN.price;
      await state.save();
      logger.info(`Boost activated for provider ${userId}`);
      return this.getDashboard(userId);
    }

    if (feature === 'website') {
      state.website.active = true;
      state.website.startDate = now;
      state.website.expiryDate = addDays(now, 30);
      state.website.monthlyPrice = WEBSITE_PLAN.price;
      state.boost.active = true;
      state.boost.startDate = now;
      state.boost.expiryDate = addDays(now, 30);
      if (!state.website.headline || !state.website.description) {
        const profile = await ProfessionalProfile.findOne({ user: userId }).lean();
        state.website.headline = state.website.headline || cleanString(profile?.profession || 'My Service Website');
        state.website.description = state.website.description || cleanString(profile?.description);
      }
      await state.save();
      await this.ensureWebsiteSlug(state, userId);
      logger.info(`Website plan activated for provider ${userId}`);
      return this.getDashboard(userId);
    }

    if (feature === 'verification') {
      state.verification.feePaid = true;
      state.verification.paidAt = now;
      if (state.verification.status === 'not_started') {
        state.verification.reviewerNotes = 'Payment received. Upload documents to start verification.';
      }
      await state.save();
      logger.info(`Verification fee marked paid for provider ${userId}`);
      return this.getDashboard(userId);
    }

    if (feature === 'advertisement') {
      const level = cleanString(payload.level).toLowerCase();
      const planId = cleanString(payload.planId).toLowerCase();
      const scheduleMode = cleanString(payload.scheduleMode).toLowerCase();
      const extendFromAdId = cleanString(payload.extendFromAdId);
      const city = normalizeCity(payload.city);
      const stateName = normalizeState(payload.state);
      const plan = ADVERTISEMENT_PLANS.find((item) => item.id === planId);
      const validLevel = ADVERTISEMENT_LEVELS.find((item) => item.id === level);

      if (!plan || !validLevel) {
        throw new Error('Invalid advertisement level or plan');
      }
      if (level === 'city' && !city) {
        throw new Error('City is required for city-level advertisements');
      }
      if (level === 'state' && !stateName) {
        throw new Error('State is required for state-level advertisements');
      }

      let startsAt = now;
      let status = 'active';
      if (scheduleMode === 'after-current' && extendFromAdId) {
        const baseAd = (state.advertisements || []).find((item) => String(item._id) === extendFromAdId);
        if (!baseAd) {
          throw new Error('Could not find the running advertisement to extend from');
        }
        const baseRunStart = getAdRunStart(baseAd);
        startsAt = baseRunStart ? addDays(new Date(baseRunStart), 30) : addDays(now, 30);
        if (startsAt > now) {
          status = 'scheduled';
        }
      }

      state.advertisements.push({
        level,
        planId: plan.id,
        planName: `${validLevel.label} - ${plan.name}`,
        amount: plan.price,
        impressionsTotal: plan.impressions,
        impressionsUsed: 0,
        status,
        startsAt,
        extendFromAdId,
        createdAt: now
      });
      await state.save();
      const createdAd = state.advertisements[state.advertisements.length - 1];

      if (extendFromAdId && createdAd?._id) {
        const sourceCreative = await AdvertisementCreative.findOne({ user: userId, advertisementId: extendFromAdId });
        if (sourceCreative) {
          await AdvertisementCreative.findOneAndUpdate(
            { user: userId, advertisementId: String(createdAd._id) },
            {
              $set: {
                user: sourceCreative.user,
                professionalProfile: sourceCreative.professionalProfile || null,
                advertisementId: String(createdAd._id),
                level,
                city: level === 'city' ? city : '',
                state: level === 'city' || level === 'state' ? stateName : '',
                imagePath: sourceCreative.imagePath,
                imageWidth: Number(sourceCreative.imageWidth || 0),
                imageHeight: Number(sourceCreative.imageHeight || 0),
                status: sourceCreative.status,
                rejectionReason: sourceCreative.rejectionReason || '',
                approvedAt: sourceCreative.approvedAt || null,
                versions: Array.isArray(sourceCreative.versions) ? sourceCreative.versions : [],
                adminMessages: Array.isArray(sourceCreative.adminMessages) ? sourceCreative.adminMessages : [],
                views: 0,
                clicks: 0
              }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
        }
      }
      logger.info(`Advertisement activated for provider ${userId} with ${plan.id} / ${level} / ${status}`);
      return this.getDashboard(userId);
    }

    throw new Error('Invalid feature selection');
  }

  async updateWebsiteProfile(userId, payload = {}, files = {}) {
    const state = await this.getOrCreateState(userId);
    if (!this.hasActiveWebsite(state)) {
      throw new Error('Activate Personal Website before editing it');
    }

    state.website.headline = cleanString(payload.headline || state.website.headline);
    state.website.description = cleanString(payload.description || state.website.description);
    state.website.bookingEnabled = !['false', '0', 'off'].includes(String(payload.bookingEnabled ?? state.website.bookingEnabled).toLowerCase());
    state.website.appointmentNote = cleanString(payload.appointmentNote || state.website.appointmentNote);
    if ('backgroundAudioUrl' in payload) {
      state.website.backgroundAudioUrl = cleanString(payload.backgroundAudioUrl || '');
    }

    const imageFiles = Array.isArray(files.websiteImages) ? files.websiteImages.map((item) => item.path) : [];
    const videoFiles = Array.isArray(files.websiteVideos) ? files.websiteVideos.map((item) => item.path) : [];
    const audioFile = Array.isArray(files.backgroundAudio) ? files.backgroundAudio[0]?.path : '';
    if (imageFiles.length > 0) {
      state.website.galleryImages = [...(state.website.galleryImages || []), ...imageFiles];
    }
    if (videoFiles.length > 0) {
      state.website.galleryVideos = [...(state.website.galleryVideos || []), ...videoFiles];
    }
    if (audioFile) {
      state.website.backgroundAudioFile = audioFile;
    }

    await state.save();
    await this.ensureWebsiteSlug(state, userId);
    logger.info(`Website content updated for provider ${userId}`);
    return this.getDashboard(userId);
  }

  async submitVerification(userId, payload = {}, files = {}) {
    const state = await this.getOrCreateState(userId);
    const user = await User.findById(userId).lean();
    const profile = await ProfessionalProfile.findOne({ user: userId }).lean();
    const aadhaarFile = Array.isArray(files.aadhaarDocument) ? files.aadhaarDocument[0]?.path : '';
    const panFile = Array.isArray(files.panDocument) ? files.panDocument[0]?.path : '';

    if (!state.verification?.feePaid) {
      throw new Error('Pay the verification fee before submitting documents');
    }

    if (!aadhaarFile && !state.verification?.aadhaarDocument) {
      throw new Error('Aadhar Card is required for verification');
    }

    const profileName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
    const submittedName = cleanString(payload.fullName || profileName);
    const submittedMobile = cleanString(payload.mobile || user?.mobile || '');

    state.verification.status = 'pending';
    state.verification.submittedAt = new Date();
    state.verification.reviewedAt = null;
    state.verification.badgeActive = false;
    state.verification.rejectionReason = '';
    state.verification.reviewerNotes = 'Awaiting manual verification review.';
    state.verification.nameMatch = areNamesConsistent(profileName, submittedName);
    state.verification.mobileMatch = areMobilesConsistent(user?.mobile, submittedMobile) || !cleanString(user?.mobile);
    if (aadhaarFile) {
      state.verification.aadhaarDocument = aadhaarFile;
    }
    if (panFile) {
      state.verification.panDocument = panFile;
    }

    await state.save();
    logger.info(`Verification submitted for provider ${userId}`);
    return this.getDashboard(userId);
  }

  async getActivity(userId) {
    const state = await this.getOrCreateState(userId);
    const items = [];

    if (state.boost?.startDate) {
      items.push({
        id: `boost-${state.boost.startDate.getTime()}`,
        type: 'boost',
        label: BOOST_PLAN.name,
        amount: BOOST_PLAN.price,
        status: this.hasActiveBoost(state) ? 'active' : 'expired',
        createdAt: state.boost.startDate,
        expiresAt: state.boost.expiryDate
      });
    }

    if (state.website?.startDate) {
      items.push({
        id: `website-${state.website.startDate.getTime()}`,
        type: 'website',
        label: WEBSITE_PLAN.name,
        amount: WEBSITE_PLAN.price,
        status: this.hasActiveWebsite(state) ? 'active' : 'expired',
        createdAt: state.website.startDate,
        expiresAt: state.website.expiryDate
      });
    }

    (state.advertisements || []).forEach((ad) => {
      items.push({
        id: ad._id.toString(),
        type: 'advertisement',
        label: ad.planName,
        amount: ad.amount,
        status: ad.status,
        createdAt: ad.createdAt,
        impressionsTotal: ad.impressionsTotal,
        impressionsUsed: ad.impressionsUsed,
        impressionsRemaining: Math.max(Number(ad.impressionsTotal || 0) - Number(ad.impressionsUsed || 0), 0)
      });
    });

    if (state.verification?.submittedAt) {
      items.push({
        id: `verification-${state.verification.submittedAt.getTime()}`,
        type: 'verification',
        label: VERIFICATION_PLAN.name,
        amount: VERIFICATION_PLAN.price,
        status: state.verification.status,
        createdAt: state.verification.submittedAt,
        reviewedAt: state.verification.reviewedAt,
        reason: cleanString(state.verification.rejectionReason)
      });
    }

    items.sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime());

    return {
      summary: {
        total: items.length,
        active: items.filter((item) => item.status === 'active' || item.status === 'approved' || item.status === 'pending').length,
        spent: items.reduce((sum, item) => sum + Number(item.amount || 0), 0)
      },
      items
    };
  }

  async getGrowthStatesForUsers(userIds = []) {
    if (userIds.length === 0) {
      return new Map();
    }

    const states = await ProviderGrowth.find({ user: { $in: userIds } });
    const result = new Map();

    for (const state of states) {
      const normalized = await this.normalizeState(state);
      result.set(String(normalized.user), this.buildPublicState(normalized));
    }

    return result;
  }

  buildPublicState(state) {
    const activeAds = (state.advertisements || []).filter((item) => item.status === 'active' && !item.paused);
    return {
      boostActive: this.hasActiveBoost(state),
      websiteActive: this.hasActiveWebsite(state),
      websiteSlug: state.websiteSlug || '',
      verifiedBadge: this.hasVerificationBadge(state),
      verificationStatus: state.verification?.status || 'not_started',
      website: {
        headline: cleanString(state.website?.headline),
        description: cleanString(state.website?.description),
        galleryImages: Array.isArray(state.website?.galleryImages) ? state.website.galleryImages : [],
        galleryVideos: Array.isArray(state.website?.galleryVideos) ? state.website.galleryVideos : [],
        backgroundAudioUrl: pickWebsiteAudio(state.website),
        bookingEnabled: state.website?.bookingEnabled !== false,
        appointmentNote: cleanString(state.website?.appointmentNote)
      },
      activeAdvertisements: activeAds.map((item) => ({
        id: item._id.toString(),
        level: item.level,
        planName: item.planName,
        impressionsTotal: item.impressionsTotal,
        impressionsUsed: item.impressionsUsed,
        impressionsRemaining: Math.max(Number(item.impressionsTotal || 0) - Number(item.impressionsUsed || 0), 0)
      }))
    };
  }

  async recordAdImpressions(userIds = []) {
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return;
    }

    const states = await ProviderGrowth.find({
      user: { $in: userIds },
      'advertisements.status': 'active'
    });

    for (const state of states) {
      let changed = false;
      for (const ad of state.advertisements || []) {
        if (ad.status !== 'active') {
          continue;
        }

        ad.impressionsUsed = Number(ad.impressionsUsed || 0) + 1;
        if (Number(ad.impressionsUsed || 0) >= Number(ad.impressionsTotal || 0)) {
          ad.status = 'completed';
          ad.completedAt = new Date();
        }
        changed = true;
        break;
      }

      if (changed) {
        await state.save();
      }
    }
  }

  getRankingBoost(publicState = {}) {
    let score = 0;
    if (publicState.boostActive) {
      score += 18;
    }
    if (publicState.verifiedBadge) {
      score += 8;
    }
    if ((publicState.activeAdvertisements || []).length > 0) {
      score += 5;
    }
    return score;
  }

  async getWebsiteBySlug(slug, viewerId = null, professionalService) {
    const cleanSlug = slugify(slug);
    if (!cleanSlug) {
      return null;
    }

    const state = await ProviderGrowth.findOne({ websiteSlug: cleanSlug });
    if (!state) {
      return null;
    }

    const normalized = await this.normalizeState(state);
    if (!this.hasActiveWebsite(normalized)) {
      return null;
    }

    await ProfessionalProfile.findOneAndUpdate({ user: normalized.user }, { $inc: { viewCount: 1 } });
    const profile = await professionalService.getProfileByUserId(normalized.user, viewerId);
    if (!profile) {
      return null;
    }

    return {
      ...profile,
      websiteSlug: cleanSlug,
      website: {
        headline: cleanString(normalized.website?.headline) || profile.profession || 'My Service Website',
        description: cleanString(normalized.website?.description) || profile.description || '',
        galleryImages: Array.isArray(normalized.website?.galleryImages) ? normalized.website.galleryImages : [],
        galleryVideos: Array.isArray(normalized.website?.galleryVideos) ? normalized.website.galleryVideos : [],
        backgroundAudioUrl: pickWebsiteAudio(normalized.website),
        bookingEnabled: normalized.website?.bookingEnabled !== false,
        appointmentNote: cleanString(normalized.website?.appointmentNote),
        active: true
      }
    };
  }
}

module.exports = new ProviderGrowthService();
