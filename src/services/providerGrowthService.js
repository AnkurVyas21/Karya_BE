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
  billing: 'weekly',
  tagline: 'Get up to 3X more visibility and reach more customers.',
  benefits: [
    'Priority ranking in search results',
    'Higher appearance frequency in listings',
    'Great for providers who want faster lead growth'
  ]
};

const WEBSITE_PLAN = {
  id: 'website',
  name: 'Business Website Manager',
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

const BOOST_REACH_OPTIONS = [
  { id: 'city', label: 'City visibility', weekPrice: 99 },
  { id: 'state', label: 'State visibility', weekPrice: 199 },
  { id: 'global', label: 'Global visibility', weekPrice: 399 }
];

const BOOST_DURATION_OPTIONS = [
  { id: 'week', label: '1 week', multiplier: 1, durationDays: 7, durationMonths: 0 },
  { id: 'month', label: '1 month', multiplier: 2, durationDays: 30, durationMonths: 1 },
  { id: '12months', label: '12 months', multiplier: 12, durationDays: 360, durationMonths: 12 }
];

const WEBSITE_BILLING_OPTIONS = [
  { id: 'website-1m', durationMonths: 1, monthlyPrice: 299 },
  { id: 'website-6m', durationMonths: 6, monthlyPrice: 249 },
  { id: 'website-12m', durationMonths: 12, monthlyPrice: 199 }
];

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
    name: 'Basic Ad',
    price: 299,
    categoryPrice: 499,
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
    name: 'Growth Ad',
    price: 599,
    categoryPrice: 799,
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
    name: 'Premium Ad',
    price: 999,
    categoryPrice: 1299,
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
const ADVERTISEMENT_CAMPAIGN_TYPES = [
  {
    id: 'location',
    label: 'Location-based advertisement',
    note: 'Shown across eligible Nasdiya ad placements including homepage and relevant internal pages, depending on availability, targeting, and active campaign load.'
  },
  {
    id: 'category',
    label: 'Category / Profession-based advertisement',
    note: 'Shown on selected profession and related service search pages for higher-intent visibility.',
    maxCategories: 15
  }
];
const MAX_AD_CATEGORIES = 15;
const PROVIDER_PLAN_FEATURES = new Set(['boost', 'website', 'advertisement', 'verification']);

const addDays = (date, days) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
const getAdRunStart = (ad = {}) => ad?.startsAt || ad?.createdAt || null;

const cleanString = (value) => String(value || '').trim();
const parseBooleanLike = (value) => {
  if (typeof value === 'boolean') {
    return value;
  }
  return ['true', '1', 'yes', 'on'].includes(cleanString(value).toLowerCase());
};
const normalizePaymentMethod = (value) => {
  const method = cleanString(value).toLowerCase();
  return ['card', 'upi', 'netbanking'].includes(method) ? method : 'unknown';
};
const paymentMethodLabel = (value) => {
  const labels = {
    card: 'Credit / debit card',
    upi: 'UPI',
    netbanking: 'Net banking',
    unknown: 'Payment method not recorded'
  };
  return labels[normalizePaymentMethod(value)] || labels.unknown;
};
const normalizeCity = (value) => cleanString(value).replace(/\s+/g, ' ');
const normalizeState = (value) => cleanString(value).replace(/\s+/g, ' ');
const normalizeCategory = (value) => cleanString(value).replace(/\s+/g, ' ').slice(0, 80);
const normalizeCategories = (values = []) => {
  const raw = Array.isArray(values) ? values : String(values || '').split(',');
  const seen = new Set();
  const result = [];
  for (const value of raw) {
    const normalized = normalizeCategory(value);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
    if (result.length >= MAX_AD_CATEGORIES) {
      break;
    }
  }
  return result;
};
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
    const base = slugify(user?.fullName || '') || `provider-${String(userId).slice(-6)}`;
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
    const allAdvertisements = Array.isArray(state.advertisements) ? state.advertisements : [];
    const visibleAds = allAdvertisements.filter((item) => item.status === 'active' || item.status === 'scheduled');
    const historyAds = allAdvertisements
      .filter((item) => item.status === 'completed' || item.status === 'deleted')
      .sort((left, right) => {
        const leftTime = new Date(left.deletedAt || left.completedAt || left.createdAt || 0).getTime();
        const rightTime = new Date(right.deletedAt || right.completedAt || right.createdAt || 0).getTime();
        return rightTime - leftTime;
      });
    const activeAds = visibleAds.filter((item) => item.status === 'active');
    const runningAds = activeAds.filter((item) => !item.paused);
    const usedImpressions = activeAds.reduce((sum, item) => sum + Number(item.impressionsUsed || 0), 0);
    const totalImpressions = activeAds.reduce((sum, item) => sum + Number(item.impressionsTotal || 0), 0);

    const toAdvertisementRow = (item) => ({
      id: item._id.toString(),
      campaignType: item.campaignType || 'location',
      level: item.level,
      city: cleanString(item.city),
      state: cleanString(item.state),
      categories: Array.isArray(item.categories) ? item.categories : [],
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
      deletedAt: item.deletedAt || null,
      deletionNote: cleanString(item.deletionNote),
      completedAt: item.completedAt || null,
      creative: creativeMap.get(String(item._id)) || null,
      createdAt: item.createdAt
    });

    return {
      freeSignup: {
        enabled: true,
        title: 'Provider signup is free',
        note: 'Providers can register, complete profiles, and start appearing on the platform without paying upfront.'
      },
      profileOverview: {
        fullName: user?.fullName || '',
        mobile: cleanString(user?.mobile),
        profession: profile?.profession || '',
        location: profile?.location || '',
        city: cleanString(profile?.city),
        state: cleanString(profile?.state),
        profilePicture: cleanString(profile?.profilePicture),
        profileViews: Number(profile?.viewCount || 0),
        websiteUrlPath: websiteSlug ? `/provider/site/${websiteSlug}` : '',
        isProfileComplete: Boolean(profile?.profession && (profile?.location || profile?.city || profile?.state))
      },
      boost: {
        ...BOOST_PLAN,
        reachOptions: BOOST_REACH_OPTIONS,
        durationOptions: BOOST_DURATION_OPTIONS,
        selectedReach: cleanString(state.boost?.reach) || 'city',
        selectedDuration: cleanString(state.boost?.durationId) || 'week',
        amount: Number(state.boost?.amount || BOOST_PLAN.price),
        city: cleanString(state.boost?.city),
        state: cleanString(state.boost?.state),
        durationDays: Number(state.boost?.durationDays || 7),
        status: this.getBoostStatus(state),
        active: this.hasActiveBoost(state),
        expiresAt: state.boost?.expiryDate || null
      },
      website: {
        ...WEBSITE_PLAN,
        billingOptions: WEBSITE_BILLING_OPTIONS.map((option) => ({
          ...option,
          total: option.monthlyPrice * option.durationMonths
        })),
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
        campaignTypes: ADVERTISEMENT_CAMPAIGN_TYPES,
        levels: ADVERTISEMENT_LEVELS,
        plans: ADVERTISEMENT_PLANS,
        activeCount: runningAds.length,
        pausedCount: activeAds.length - runningAds.length,
        totalImpressions,
        usedImpressions,
        remainingImpressions: Math.max(totalImpressions - usedImpressions, 0),
        status: runningAds.length > 0 ? 'Running' : activeAds.length > 0 ? 'Paused' : 'Not active',
        deletedCount: historyAds.filter((item) => item.status === 'deleted').length,
        historyCount: historyAds.length,
        items: visibleAds.map(toAdvertisementRow),
        historyItems: historyAds.map(toAdvertisementRow)
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

  recordPurchaseTransaction(state, payload = {}) {
    state.purchaseTransactions = Array.isArray(state.purchaseTransactions) ? state.purchaseTransactions : [];
    state.purchaseTransactions.push({
      feature: payload.feature,
      relatedId: cleanString(payload.relatedId),
      planId: cleanString(payload.planId),
      planName: cleanString(payload.planName),
      label: cleanString(payload.label),
      amount: Number(payload.amount || 0),
      currency: 'INR',
      status: cleanString(payload.status || 'paid'),
      paymentMethod: normalizePaymentMethod(payload.paymentMethod),
      paymentReference: cleanString(payload.paymentReference),
      autoPay: parseBooleanLike(payload.autoPay),
      autoRenew: parseBooleanLike(payload.autoRenew),
      paidAt: payload.paidAt || new Date(),
      startsAt: payload.startsAt || null,
      expiresAt: payload.expiresAt || null,
      metadata: payload.metadata || {}
    });
  }

  async activateFeature(userId, payload = {}) {
    const feature = cleanString(payload.feature).toLowerCase();
    const state = await this.getOrCreateState(userId);
    const now = new Date();

    if (feature === 'boost') {
      const selectedReach = BOOST_REACH_OPTIONS.find((option) => option.id === cleanString(payload.reach).toLowerCase()) || BOOST_REACH_OPTIONS[0];
      const selectedDuration = BOOST_DURATION_OPTIONS.find((option) => option.id === cleanString(payload.durationId).toLowerCase()) || BOOST_DURATION_OPTIONS[0];
      const amount = selectedReach.weekPrice * selectedDuration.multiplier;
      const expiresAt = addDays(now, selectedDuration.durationDays);
      state.boost.active = true;
      state.boost.startDate = now;
      state.boost.expiryDate = expiresAt;
      state.boost.monthlyPrice = selectedDuration.durationMonths > 0 ? Math.round(amount / selectedDuration.durationMonths) : amount;
      state.boost.amount = amount;
      state.boost.reach = selectedReach.id;
      state.boost.city = selectedReach.id === 'city' ? cleanString(payload.city) : '';
      state.boost.state = selectedReach.id === 'city' || selectedReach.id === 'state' ? cleanString(payload.state) : '';
      state.boost.durationId = selectedDuration.id;
      state.boost.durationDays = selectedDuration.durationDays;
      this.recordPurchaseTransaction(state, {
        feature,
        relatedId: `boost-${now.getTime()}`,
        planId: `boost-${selectedReach.id}-${selectedDuration.id}`,
        planName: `${selectedReach.label} - ${selectedDuration.label}`,
        label: BOOST_PLAN.name,
        amount,
        status: 'active',
        paymentMethod: payload.paymentMethod,
        paymentReference: payload.paymentReference,
        autoPay: payload.autoPay,
        autoRenew: payload.autoRenew,
        paidAt: now,
        startsAt: now,
        expiresAt,
        metadata: {
          reach: selectedReach.id,
          durationId: selectedDuration.id,
          durationDays: selectedDuration.durationDays,
          monthlyPrice: state.boost.monthlyPrice
        }
      });
      await state.save();
      logger.info(`Boost activated for provider ${userId}`);
      return this.getDashboard(userId);
    }

    if (feature === 'website') {
      const requestedMonths = Number(payload.durationMonths || 1);
      const selectedPlan = WEBSITE_BILLING_OPTIONS.find((option) => option.durationMonths === requestedMonths) || WEBSITE_BILLING_OPTIONS[0];
      const durationDays = selectedPlan.durationMonths * 30;
      const amount = selectedPlan.monthlyPrice * selectedPlan.durationMonths;
      const expiresAt = addDays(now, durationDays);
      state.website.active = true;
      state.website.startDate = now;
      state.website.expiryDate = expiresAt;
      state.website.monthlyPrice = selectedPlan.monthlyPrice;
      state.boost.active = true;
      state.boost.startDate = now;
      state.boost.expiryDate = expiresAt;
      if (!state.website.headline || !state.website.description) {
        const profile = await ProfessionalProfile.findOne({ user: userId }).lean();
        state.website.headline = state.website.headline || cleanString(profile?.profession || 'My Service Website');
        state.website.description = state.website.description || cleanString(profile?.description);
      }
      this.recordPurchaseTransaction(state, {
        feature,
        relatedId: `website-${now.getTime()}`,
        planId: selectedPlan.id,
        planName: `${WEBSITE_PLAN.name} - ${selectedPlan.durationMonths} month${selectedPlan.durationMonths === 1 ? '' : 's'}`,
        label: WEBSITE_PLAN.name,
        amount,
        status: 'active',
        paymentMethod: payload.paymentMethod,
        paymentReference: payload.paymentReference,
        autoPay: payload.autoPay,
        autoRenew: payload.autoRenew,
        paidAt: now,
        startsAt: now,
        expiresAt,
        metadata: {
          durationMonths: selectedPlan.durationMonths,
          durationDays,
          monthlyPrice: selectedPlan.monthlyPrice,
          includesBoost: true
        }
      });
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
      this.recordPurchaseTransaction(state, {
        feature,
        relatedId: `verification-${now.getTime()}`,
        planId: VERIFICATION_PLAN.id,
        planName: VERIFICATION_PLAN.name,
        label: VERIFICATION_PLAN.name,
        amount: VERIFICATION_PLAN.price,
        status: 'paid',
        paymentMethod: payload.paymentMethod,
        paymentReference: payload.paymentReference,
        autoPay: payload.autoPay,
        autoRenew: payload.autoRenew,
        paidAt: now,
        startsAt: now,
        metadata: {
          billing: VERIFICATION_PLAN.billing
        }
      });
      await state.save();
      logger.info(`Verification fee marked paid for provider ${userId}`);
      return this.getDashboard(userId);
    }

    if (feature === 'advertisement') {
      const level = cleanString(payload.level).toLowerCase();
      const planId = cleanString(payload.planId).toLowerCase();
      const campaignType = cleanString(payload.campaignType).toLowerCase() === 'category' ? 'category' : 'location';
      const scheduleMode = cleanString(payload.scheduleMode).toLowerCase();
      const extendFromAdId = cleanString(payload.extendFromAdId);
      const city = normalizeCity(payload.city);
      const stateName = normalizeState(payload.state);
      const categories = normalizeCategories(payload.categories);
      const plan = ADVERTISEMENT_PLANS.find((item) => item.id === planId);
      const validLevel = ADVERTISEMENT_LEVELS.find((item) => item.id === level);
      const amount = campaignType === 'category' ? Number(plan?.categoryPrice || plan?.price || 0) : Number(plan?.price || 0);

      if (!plan || !validLevel) {
        throw new Error('Invalid advertisement level or plan');
      }
      if (campaignType === 'category' && categories.length === 0) {
        throw new Error('Select at least one category or profession for category-based advertisements');
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
        campaignType,
        level,
        city: level === 'city' ? city : '',
        state: level === 'city' || level === 'state' ? stateName : '',
        categories: campaignType === 'category' ? categories : [],
        planId: plan.id,
        planName: `${validLevel.label} - ${campaignType === 'category' ? plan.name.replace('Ad', 'Category Ad') : plan.name}`,
        amount,
        impressionsTotal: plan.impressions,
        impressionsUsed: 0,
        status,
        startsAt,
        extendFromAdId,
        createdAt: now
      });
      const createdAd = state.advertisements[state.advertisements.length - 1];
      this.recordPurchaseTransaction(state, {
        feature,
        relatedId: createdAd?._id ? String(createdAd._id) : '',
        planId: plan.id,
        planName: createdAd?.planName || `${validLevel.label} - ${plan.name}`,
        label: 'Advertisement System',
        amount,
        status,
        paymentMethod: payload.paymentMethod,
        paymentReference: payload.paymentReference,
        autoPay: payload.autoPay,
        autoRenew: payload.autoRenew,
        paidAt: now,
        startsAt,
        expiresAt: addDays(new Date(startsAt), Number(plan.durationDays || 30)),
        metadata: {
          campaignType,
          level,
          city: level === 'city' ? city : '',
          state: level === 'city' || level === 'state' ? stateName : '',
          categories: campaignType === 'category' ? categories : [],
          impressionsTotal: plan.impressions,
          durationDays: Number(plan.durationDays || 30)
        }
      });
      await state.save();

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
                campaignType,
                categories: campaignType === 'category' ? categories : [],
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
      logger.info(`Advertisement activated for provider ${userId} with ${plan.id} / ${level} / ${campaignType} / ${status}`);
      const dashboard = await this.getDashboard(userId);
      return {
        ...dashboard,
        createdAdvertisementId: createdAd?._id ? String(createdAd._id) : '',
        createdAdvertisementPath: createdAd?._id ? `/provider/ads/create/${createdAd._id}` : ''
      };
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

  async deleteAdvertisement(userId, advertisementId) {
    const state = await this.getOrCreateState(userId);
    const item = (state.advertisements || []).find((ad) => String(ad._id) === String(advertisementId));
    if (!item) {
      throw new Error('Advertisement pack not found');
    }

    if (String(item.status || '').toLowerCase() === 'deleted') {
      throw new Error('This ad has already been deleted');
    }

    await advertisementCreativeService.deleteForProvider({
      userId,
      advertisementId,
      note: 'Deleted by provider. This campaign is not refundable and has been removed from live placements.'
    });

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

    const profileName = user?.fullName || '';
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
    const items = (state.purchaseTransactions || [])
      .filter((transaction) => PROVIDER_PLAN_FEATURES.has(cleanString(transaction.feature)))
      .map((transaction) => this.serializePurchaseTransaction(transaction, state));
    const existingKeys = new Set(items.map((item) => `${item.type}:${item.relatedId}`));

    items.push(...this.buildLegacyPurchaseItems(state, existingKeys));
    items.sort((left, right) => new Date(right.createdAt || right.paidAt || 0).getTime() - new Date(left.createdAt || left.paidAt || 0).getTime());

    return {
      summary: {
        total: items.length,
        active: items.filter((item) => item.currentlyActive).length,
        autoRenew: items.filter((item) => item.autoRenew).length,
        spent: items.reduce((sum, item) => sum + Number(item.amount || 0), 0)
      },
      items
    };
  }

  serializePurchaseTransaction(transaction, state) {
    const feature = cleanString(transaction.feature);
    const relatedId = cleanString(transaction.relatedId);
    const relatedAd = feature === 'advertisement'
      ? (state.advertisements || []).find((ad) => String(ad._id) === relatedId)
      : null;
    const status = this.resolvePurchaseStatus(transaction, state, relatedAd);
    const startsAt = transaction.startsAt || relatedAd?.startsAt || relatedAd?.createdAt || transaction.paidAt || transaction.createdAt;
    const expiresAt = transaction.expiresAt || (relatedAd ? addDays(new Date(getAdRunStart(relatedAd)), 30) : null);
    const paidAt = transaction.paidAt || transaction.createdAt || startsAt;

    const item = {
      id: transaction._id?.toString() || relatedId || `${feature}-${new Date(paidAt || 0).getTime()}`,
      relatedId,
      type: feature,
      label: cleanString(transaction.label) || this.featureLabel(feature),
      planId: cleanString(transaction.planId),
      planName: cleanString(transaction.planName) || cleanString(transaction.label) || this.featureLabel(feature),
      amount: Number(transaction.amount || 0),
      currency: cleanString(transaction.currency || 'INR'),
      status,
      currentlyActive: this.isPurchaseCurrentlyActive(feature, status, expiresAt),
      createdAt: paidAt,
      paidAt,
      startsAt,
      expiresAt,
      paymentMethod: normalizePaymentMethod(transaction.paymentMethod),
      paymentMethodLabel: paymentMethodLabel(transaction.paymentMethod),
      paymentReference: cleanString(transaction.paymentReference),
      autoPay: Boolean(transaction.autoPay),
      autoRenew: Boolean(transaction.autoRenew),
      billingMode: transaction.autoPay ? 'Auto pay' : 'One-time payment',
      renewalMode: transaction.autoRenew ? 'Auto renew enabled' : 'Manual renewal',
      metadata: transaction.metadata || {}
    };

    if (relatedAd) {
      item.impressionsTotal = Number(relatedAd.impressionsTotal || item.metadata?.impressionsTotal || 0);
      item.impressionsUsed = Number(relatedAd.impressionsUsed || 0);
      item.impressionsRemaining = Math.max(item.impressionsTotal - item.impressionsUsed, 0);
      item.paused = Boolean(relatedAd.paused);
      item.createdAt = relatedAd.createdAt || item.createdAt;
    }

    if (feature === 'verification') {
      item.reviewedAt = state.verification?.reviewedAt || null;
      item.reason = cleanString(state.verification?.rejectionReason);
    }

    return item;
  }

  resolvePurchaseStatus(transaction, state, relatedAd = null) {
    const feature = cleanString(transaction.feature);
    const now = new Date();

    if (feature === 'advertisement' && relatedAd) {
      if (relatedAd.status === 'active' && relatedAd.paused) {
        return 'paused';
      }
      return cleanString(relatedAd.status || transaction.status || 'paid');
    }

    if (feature === 'boost' || feature === 'website') {
      const startsAt = transaction.startsAt ? new Date(transaction.startsAt) : null;
      const expiresAt = transaction.expiresAt ? new Date(transaction.expiresAt) : null;
      if (startsAt && startsAt > now) {
        return 'scheduled';
      }
      if (expiresAt && expiresAt < now) {
        return 'expired';
      }
      if (expiresAt && expiresAt >= now) {
        return 'active';
      }
    }

    if (feature === 'verification') {
      const status = cleanString(state.verification?.status || transaction.status);
      if (status === 'approved' && state.verification?.badgeActive) {
        return 'active';
      }
      if (status === 'pending' || status === 'rejected') {
        return status;
      }
      return state.verification?.feePaid ? 'paid' : cleanString(transaction.status || 'paid');
    }

    return cleanString(transaction.status || 'paid');
  }

  isPurchaseCurrentlyActive(feature, status, expiresAt = null) {
    const normalized = cleanString(status);
    if (feature === 'verification') {
      return normalized === 'active';
    }
    if (feature === 'advertisement') {
      return normalized === 'active';
    }
    if (normalized !== 'active') {
      return false;
    }
    if (!expiresAt) {
      return true;
    }
    return new Date(expiresAt).getTime() >= Date.now();
  }

  buildLegacyPurchaseItems(state, existingKeys = new Set()) {
    const items = [];
    const addLegacy = (item) => {
      const key = `${item.type}:${item.relatedId}`;
      if (!existingKeys.has(key)) {
        items.push({
          ...item,
          paymentMethod: 'unknown',
          paymentMethodLabel: paymentMethodLabel('unknown'),
          paymentReference: '',
          autoPay: false,
          autoRenew: false,
          billingMode: 'One-time payment',
          renewalMode: 'Manual renewal',
          legacy: true
        });
      }
    };

    const boostStartTime = state.boost?.startDate ? new Date(state.boost.startDate).getTime() : 0;
    const websiteStartTime = state.website?.startDate ? new Date(state.website.startDate).getTime() : 0;
    const boostWasIncludedWithWebsite = boostStartTime > 0 && boostStartTime === websiteStartTime;

    if (state.boost?.startDate && !boostWasIncludedWithWebsite) {
      const startsAt = state.boost.startDate;
      const relatedId = `boost-${new Date(startsAt).getTime()}`;
      const reach = BOOST_REACH_OPTIONS.find((option) => option.id === cleanString(state.boost?.reach)) || BOOST_REACH_OPTIONS[0];
      const duration = BOOST_DURATION_OPTIONS.find((option) => option.id === cleanString(state.boost?.durationId)) || null;
      const expiresAt = state.boost.expiryDate || null;
      const status = expiresAt && new Date(expiresAt).getTime() >= Date.now() ? 'active' : 'expired';
      addLegacy({
        id: relatedId,
        relatedId,
        type: 'boost',
        label: BOOST_PLAN.name,
        planId: `boost-${reach.id}-${duration?.id || 'legacy'}`,
        planName: `${reach.label}${duration ? ` - ${duration.label}` : ''}`,
        amount: Number(state.boost.amount || BOOST_PLAN.price),
        currency: 'INR',
        status,
        currentlyActive: status === 'active',
        createdAt: startsAt,
        paidAt: startsAt,
        startsAt,
        expiresAt,
        metadata: {
          reach: state.boost.reach,
          durationId: state.boost.durationId,
          durationDays: state.boost.durationDays,
          monthlyPrice: state.boost.monthlyPrice
        }
      });
    }

    if (state.website?.startDate) {
      const startsAt = state.website.startDate;
      const expiresAt = state.website.expiryDate || null;
      const relatedId = `website-${new Date(startsAt).getTime()}`;
      const durationDays = startsAt && expiresAt
        ? Math.max(30, Math.round((new Date(expiresAt).getTime() - new Date(startsAt).getTime()) / 86400000))
        : 30;
      const durationMonths = Math.max(1, Math.round(durationDays / 30));
      const amount = Number(state.website.monthlyPrice || WEBSITE_PLAN.price) * durationMonths;
      const status = expiresAt && new Date(expiresAt).getTime() >= Date.now() ? 'active' : 'expired';
      addLegacy({
        id: relatedId,
        relatedId,
        type: 'website',
        label: WEBSITE_PLAN.name,
        planId: `website-${durationMonths}m`,
        planName: `${WEBSITE_PLAN.name} - ${durationMonths} month${durationMonths === 1 ? '' : 's'}`,
        amount,
        currency: 'INR',
        status,
        currentlyActive: status === 'active',
        createdAt: startsAt,
        paidAt: startsAt,
        startsAt,
        expiresAt,
        metadata: {
          durationMonths,
          monthlyPrice: state.website.monthlyPrice,
          includesBoost: true
        }
      });
    }

    (state.advertisements || []).forEach((ad) => {
      const relatedId = ad._id.toString();
      const startsAt = getAdRunStart(ad);
      const expiresAt = startsAt ? addDays(new Date(startsAt), 30) : null;
      const status = ad.status === 'active' && ad.paused ? 'paused' : cleanString(ad.status || 'active');
      addLegacy({
        id: relatedId,
        relatedId,
        type: 'advertisement',
        label: 'Advertisement System',
        planId: cleanString(ad.planId),
        planName: cleanString(ad.planName) || 'Advertisement pack',
        amount: Number(ad.amount || 0),
        currency: 'INR',
        status,
        currentlyActive: status === 'active',
        createdAt: ad.createdAt,
        paidAt: ad.createdAt,
        startsAt,
        expiresAt,
        impressionsTotal: ad.impressionsTotal,
        impressionsUsed: ad.impressionsUsed,
        impressionsRemaining: Math.max(Number(ad.impressionsTotal || 0) - Number(ad.impressionsUsed || 0), 0),
        paused: Boolean(ad.paused),
        metadata: {
          campaignType: ad.campaignType,
          level: ad.level,
          city: ad.city,
          state: ad.state,
          categories: ad.categories || []
        }
      });
    });

    const verificationDate = state.verification?.paidAt || state.verification?.submittedAt;
    if (verificationDate) {
      const status = this.resolvePurchaseStatus({
        feature: 'verification',
        status: state.verification?.status || 'paid'
      }, state);
      const relatedId = `verification-${new Date(verificationDate).getTime()}`;
      addLegacy({
        id: relatedId,
        relatedId,
        type: 'verification',
        label: VERIFICATION_PLAN.name,
        planId: VERIFICATION_PLAN.id,
        planName: VERIFICATION_PLAN.name,
        amount: Number(state.verification?.fee || VERIFICATION_PLAN.price),
        currency: 'INR',
        status,
        currentlyActive: status === 'active',
        createdAt: verificationDate,
        paidAt: verificationDate,
        startsAt: verificationDate,
        expiresAt: null,
        reviewedAt: state.verification?.reviewedAt,
        reason: cleanString(state.verification?.rejectionReason),
        metadata: {
          billing: VERIFICATION_PLAN.billing
        }
      });
    }

    return items;
  }

  featureLabel(feature) {
    if (feature === 'boost') return BOOST_PLAN.name;
    if (feature === 'website') return WEBSITE_PLAN.name;
    if (feature === 'advertisement') return 'Advertisement System';
    if (feature === 'verification') return VERIFICATION_PLAN.name;
    return 'Provider plan';
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
        campaignType: item.campaignType || 'location',
        level: item.level,
        categories: Array.isArray(item.categories) ? item.categories : [],
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
