const AdvertisementCreative = require('../models/AdvertisementCreative');
const ProviderGrowth = require('../models/ProviderGrowth');
const ProfessionalProfile = require('../models/ProfessionalProfile');
const logger = require('../utils/logger');

const cleanString = (value) => String(value || '').trim();

const normalizeCity = (value) => cleanString(value).replace(/\s+/g, ' ');
const normalizeState = (value) => cleanString(value).replace(/\s+/g, ' ');
const normalizeCategory = (value) => cleanString(value).replace(/\s+/g, ' ').slice(0, 80);
const normalizeCategoryKey = (value) => normalizeCategory(value).toLowerCase();
const normalizeCategories = (values = []) => {
  const raw = Array.isArray(values) ? values : String(values || '').split(',');
  const seen = new Set();
  const result = [];
  for (const value of raw) {
    const normalized = normalizeCategory(value);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= 15) break;
  }
  return result;
};
const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const getAdRunStart = (ad = {}) => ad?.startsAt || ad?.createdAt || null;
const ACTIVE_ADS_CACHE_TTL_MS = Math.max(Number(process.env.ACTIVE_ADS_CACHE_TTL_MS || 20 * 1000) || (20 * 1000), 1000);

class AdvertisementCreativeService {
  constructor() {
    this.activeCreativesCache = new Map();
  }

  getActiveCreativesCacheKey(options = {}) {
    return JSON.stringify({
      city: normalizeCity(options.city).toLowerCase(),
      state: normalizeState(options.state).toLowerCase(),
      profession: normalizeCategory(options.profession).toLowerCase(),
      placement: cleanString(options.placement).toLowerCase() || 'home',
      globalOnly: Boolean(options.globalOnly),
      localOnly: Boolean(options.localOnly),
      limit: Math.max(1, Math.min(Number(options.limit || 5), 8))
    });
  }

  readActiveCreativesCache(key) {
    const entry = this.activeCreativesCache.get(key);
    if (!entry || entry.expiresAt <= Date.now()) {
      this.activeCreativesCache.delete(key);
      return null;
    }
    return entry.value;
  }

  writeActiveCreativesCache(key, value) {
    if (!key) {
      return;
    }
    this.activeCreativesCache.set(key, {
      value,
      expiresAt: Date.now() + ACTIVE_ADS_CACHE_TTL_MS
    });
  }

  invalidateActiveCreativesCache() {
    this.activeCreativesCache.clear();
  }

  cleanAdminMessage(value = '') {
    return cleanString(value).slice(0, 1200);
  }

  cleanDeletionNote(value = '') {
    return cleanString(value).slice(0, 500);
  }

  cleanPauseNote(value = '') {
    return cleanString(value).slice(0, 500);
  }

  getLevelPriority(level = '', { city = '', state = '', placement = 'home', globalOnly = false, localOnly = false } = {}) {
    const normalizedLevel = cleanString(level).toLowerCase();
    if (globalOnly) {
      return normalizedLevel === 'national' ? 100 : 0;
    }
    if (localOnly) {
      if (normalizedLevel === 'city' && city) return placement === 'home' ? 300 : 320;
      if (normalizedLevel === 'state' && state) return placement === 'home' ? 240 : 260;
      return 0;
    }

    if (placement === 'home') {
      if (normalizedLevel === 'national') return 300;
      if (normalizedLevel === 'city' && city) return 220;
      if (normalizedLevel === 'state' && state) return 180;
      return 0;
    }

    if (normalizedLevel === 'city' && city) return 300;
    if (normalizedLevel === 'state' && state) return 220;
    if (normalizedLevel === 'national') return 180;
    return 0;
  }

  getCategoryPriority(item, profession = '') {
    const selected = new Set((Array.isArray(item?.categories) ? item.categories : []).map(normalizeCategoryKey).filter(Boolean));
    const key = normalizeCategoryKey(profession);
    if (!key || selected.size === 0 || cleanString(item?.campaignType).toLowerCase() !== 'category') {
      return 0;
    }
    if (selected.has(key)) {
      return 420;
    }
    for (const category of selected) {
      if (category.includes(key) || key.includes(category)) {
        return 380;
      }
    }
    return 0;
  }

  buildActiveCreativeDebugRow(item, context = {}) {
    const pack = context.pack || null;
    const normalizedPlacement = cleanString(context.placement).toLowerCase() || 'home';
    const priority = this.getLevelPriority(item.level, {
      city: context.city || '',
      state: context.state || '',
      placement: normalizedPlacement,
      globalOnly: Boolean(context.globalOnly),
      localOnly: Boolean(context.localOnly)
    });

    const reason = !pack
      ? 'no_matching_campaign_pack'
      : pack.status !== 'active'
        ? `campaign_not_active:${pack.status}`
        : pack.paused
          ? 'campaign_paused'
          : pack.expired
            ? 'campaign_expired'
            : !pack.hasRemainingImpressions
              ? 'impressions_exhausted'
              : priority <= 0
                ? 'location_priority_zero'
                : 'included';

    return {
      creativeId: item._id?.toString?.() || String(item._id || ''),
      advertisementId: String(item.advertisementId || ''),
      campaignType: String(item.campaignType || 'location'),
      level: String(item.level || ''),
      city: item.city || '',
      state: item.state || '',
      categories: Array.isArray(item.categories) ? item.categories : [],
      status: item.status || '',
      matchedByQuery: true,
      campaignFound: Boolean(pack),
      campaignStatus: pack?.status || '',
      campaignPaused: Boolean(pack?.paused),
      campaignExpired: Boolean(pack?.expired),
      hasRemainingImpressions: Boolean(pack?.hasRemainingImpressions),
      impressionsUsed: Number(pack?.impressionsUsed || 0),
      impressionsTotal: Number(pack?.impressionsTotal || 0),
      priority,
      reason
    };
  }

  getLastAdminMessage(creative) {
    const items = Array.isArray(creative?.adminMessages) ? creative.adminMessages : [];
    if (items.length === 0) {
      return null;
    }
    const last = items[items.length - 1];
    const message = cleanString(last?.message);
    return message ? { message, createdAt: last?.createdAt || null } : null;
  }

  async createOrReplaceCreative({ userId, advertisementId, level, city = '', state = '', categories = [], imagePath, imageWidth = 0, imageHeight = 0 }) {
    const stateDoc = await ProviderGrowth.findOne({ user: userId });
    if (!stateDoc) {
      throw new Error('Advertisement pack not found');
    }

    const pack = (stateDoc.advertisements || []).find((item) => String(item._id) === String(advertisementId));
    if (!pack || !['active', 'scheduled'].includes(String(pack.status || '').toLowerCase())) {
      throw new Error('No active or scheduled advertisement pack found for this campaign');
    }

    if (cleanString(pack.level).toLowerCase() !== cleanString(level).toLowerCase()) {
      throw new Error('Ad level does not match the purchased campaign');
    }

    if (Number(pack.impressionsUsed || 0) >= Number(pack.impressionsTotal || 0)) {
      throw new Error('This advertisement pack has already completed');
    }

    const normalizedCity = normalizeCity(city);
    const normalizedState = normalizeState(state);
    const campaignType = cleanString(pack.campaignType).toLowerCase() === 'category' ? 'category' : 'location';
    const normalizedCategories = normalizeCategories((Array.isArray(categories) && categories.length > 0) ? categories : pack.categories);

    if (level === 'city' && !normalizedCity) {
      throw new Error('City is required for city-level advertisements');
    }

    if (level === 'state' && !normalizedState) {
      throw new Error('State is required for state-level advertisements');
    }

    if (campaignType === 'category' && normalizedCategories.length === 0) {
      throw new Error('Select at least one category or profession for this category-based advertisement');
    }

    if (!imagePath) {
      throw new Error('Ad image is required');
    }

    const existing = await AdvertisementCreative.findOne({ user: userId, advertisementId: String(advertisementId) });
    const packStatus = String(pack.status || '').toLowerCase();
    if (existing && existing.status === 'approved' && packStatus !== 'scheduled') {
      throw new Error('This ad is already approved and cannot be changed');
    }

    const profile = await ProfessionalProfile.findOne({ user: userId }).lean();

    const payload = {
      user: userId,
      professionalProfile: profile?._id || null,
      advertisementId: String(advertisementId),
      campaignType,
      level,
      city: normalizedCity,
      state: normalizedState,
      categories: campaignType === 'category' ? normalizedCategories : [],
      imagePath: cleanString(imagePath),
      imageWidth: Number(imageWidth || 0),
      imageHeight: Number(imageHeight || 0),
      status: 'pending',
      rejectionReason: '',
      approvedAt: null
    };

    const creative = existing
      ? await AdvertisementCreative.findOneAndUpdate(
          { _id: existing._id },
          { $set: payload },
          { new: true }
        )
      : await AdvertisementCreative.create(payload);

    logger.info(`Ad creative submitted: ${creative._id} for user ${userId}`);
    this.invalidateActiveCreativesCache();
    return creative.toObject();
  }

  async getCampaignMapForAdvertisementIds(advertisementIds = []) {
    const ids = (advertisementIds || []).map((id) => String(id)).filter(Boolean);
    if (ids.length === 0) {
      return new Map();
    }

    const idSet = new Set(ids);

    const growthDocs = await ProviderGrowth.find({ 'advertisements._id': { $in: ids } })
      .populate('user')
      .lean();

    const map = new Map();
    for (const doc of growthDocs) {
      for (const pack of doc.advertisements || []) {
        const key = String(pack._id);
        if (!idSet.has(key)) {
          continue;
        }
        map.set(key, {
          id: key,
          campaignType: pack.campaignType || 'location',
          level: pack.level,
          categories: Array.isArray(pack.categories) ? pack.categories : [],
          planId: pack.planId,
          planName: pack.planName,
          amount: Number(pack.amount || 0),
          impressionsTotal: Number(pack.impressionsTotal || 0),
          impressionsUsed: Number(pack.impressionsUsed || 0),
          status: pack.status,
          createdAt: pack.createdAt || null,
          completedAt: pack.completedAt || null,
          deletedAt: pack.deletedAt || null,
          deletionNote: pack.deletionNote || '',
          paused: Boolean(pack.paused),
          pausedAt: pack.pausedAt || null,
          pauseNote: pack.pauseNote || '',
          pausedBy: pack.pausedBy || null,
          providerUserId: doc.user?._id ? doc.user._id.toString() : (doc.user ? String(doc.user) : ''),
          provider: doc.user
            ? {
                userId: doc.user._id.toString(),
                fullName: doc.user.fullName || '',
                email: doc.user.email || '',
                mobile: doc.user.mobile || ''
              }
            : null
        });
      }
    }

    return map;
  }

  async listForAdmin({ status = '' } = {}) {
    const normalizedStatus = cleanString(status).toLowerCase();
    const match = {};
    if (['pending', 'approved', 'rejected', 'deleted'].includes(normalizedStatus)) {
      match.status = normalizedStatus;
    }

    const items = await AdvertisementCreative.find(match)
      .populate('user')
      .populate('professionalProfile')
      .sort({ createdAt: -1 })
      .lean();

    const campaignMap = await this.getCampaignMapForAdvertisementIds(items.map((item) => item.advertisementId));

    return items.map((item) => ({
      id: item._id.toString(),
      advertisementId: item.advertisementId,
      campaignType: item.campaignType || 'location',
      level: item.level,
      city: item.city || '',
      state: item.state || '',
      categories: Array.isArray(item.categories) ? item.categories : [],
      status: item.status,
      rejectionReason: item.rejectionReason || '',
      approvedAt: item.approvedAt || null,
      deletedAt: item.deletedAt || null,
      deletionNote: item.deletionNote || '',
      createdAt: item.createdAt,
      views: Number(item.views || 0),
      clicks: Number(item.clicks || 0),
      lastAdminMessage: this.getLastAdminMessage(item),
      imagePath: item.imagePath,
      imageWidth: Number(item.imageWidth || 0),
      imageHeight: Number(item.imageHeight || 0),
      campaign: campaignMap.get(String(item.advertisementId)) || null,
      provider: item.user
        ? {
            userId: item.user._id.toString(),
            fullName: item.user.fullName || '',
            email: item.user.email || '',
            mobile: item.user.mobile || ''
          }
        : null,
      profession: item.professionalProfile?.profession || ''
    }));
  }

  async getForAdmin({ creativeId }) {
    const creative = await AdvertisementCreative.findById(creativeId)
      .populate('user')
      .populate('professionalProfile')
      .lean();

    if (!creative) {
      throw new Error('Ad creative not found');
    }

    const campaignMap = await this.getCampaignMapForAdvertisementIds([creative.advertisementId]);
    const campaign = campaignMap.get(String(creative.advertisementId)) || null;

    return {
      id: creative._id.toString(),
      advertisementId: creative.advertisementId,
      campaignType: creative.campaignType || 'location',
      level: creative.level,
      city: creative.city || '',
      state: creative.state || '',
      categories: Array.isArray(creative.categories) ? creative.categories : [],
      status: creative.status,
      rejectionReason: creative.rejectionReason || '',
      approvedAt: creative.approvedAt || null,
      deletedAt: creative.deletedAt || null,
      deletionNote: creative.deletionNote || '',
      createdAt: creative.createdAt,
      updatedAt: creative.updatedAt,
      views: Number(creative.views || 0),
      clicks: Number(creative.clicks || 0),
      adminMessages: Array.isArray(creative.adminMessages) ? creative.adminMessages.map((msg) => ({
        adminId: msg?.adminId || null,
        message: cleanString(msg?.message || ''),
        createdAt: msg?.createdAt || null
      })) : [],
      lastAdminMessage: this.getLastAdminMessage(creative),
      imagePath: creative.imagePath,
      imageWidth: Number(creative.imageWidth || 0),
      imageHeight: Number(creative.imageHeight || 0),
      campaign,
      provider: creative.user
        ? {
            userId: creative.user._id.toString(),
            fullName: creative.user.fullName || '',
            email: creative.user.email || '',
            mobile: creative.user.mobile || ''
          }
        : null,
      profession: creative.professionalProfile?.profession || ''
    };
  }

  async setCampaignPaused({ creativeId, paused, adminId, note = '' }) {
    const shouldPause = Boolean(paused);
    const pauseNote = shouldPause ? this.cleanPauseNote(note) : '';

    const creative = await AdvertisementCreative.findById(creativeId);
    if (!creative) {
      throw new Error('Ad creative not found');
    }

    const growth = await ProviderGrowth.findOne({ user: creative.user });
    if (!growth) {
      throw new Error('Provider campaign not found');
    }

    const pack = (growth.advertisements || []).find((item) => String(item._id) === String(creative.advertisementId));
    if (!pack) {
      throw new Error('Advertisement pack not found for this creative');
    }

    if (pack.status !== 'active') {
      throw new Error('Only active campaigns can be paused/resumed');
    }

    if (shouldPause) {
      pack.paused = true;
      pack.pausedAt = new Date();
      pack.pausedBy = adminId || null;
      pack.pauseNote = pauseNote;
    } else {
      pack.paused = false;
      pack.pausedAt = null;
      pack.pausedBy = null;
      pack.pauseNote = '';
    }

    await growth.save();
    this.invalidateActiveCreativesCache();

    const campaignMap = await this.getCampaignMapForAdvertisementIds([creative.advertisementId]);
    return campaignMap.get(String(creative.advertisementId)) || null;
  }

  async addAdminMessage({ creativeId, adminId, message }) {
    const text = this.cleanAdminMessage(message);
    if (!text) {
      throw new Error('Message is required');
    }

    const creative = await AdvertisementCreative.findById(creativeId);
    if (!creative) {
      throw new Error('Ad creative not found');
    }

    creative.adminMessages = Array.isArray(creative.adminMessages) ? creative.adminMessages : [];
    creative.adminMessages.push({
      adminId: adminId || null,
      message: text,
      createdAt: new Date()
    });

    await creative.save();
    logger.info(`Admin message added for ad creative ${creativeId}`);
    return creative.toObject();
  }

  async setStatus({ creativeId, status, rejectionReason = '' }) {
    const nextStatus = cleanString(status).toLowerCase();
    if (!['approved', 'rejected', 'pending'].includes(nextStatus)) {
      throw new Error('Invalid status');
    }

    const creative = await AdvertisementCreative.findById(creativeId);
    if (!creative) {
      throw new Error('Ad creative not found');
    }

    if (creative.status === 'deleted') {
      throw new Error('Deleted ads cannot be moderated');
    }

    if (creative.status === 'approved' && nextStatus !== 'approved') {
      throw new Error('Approved ads cannot be reverted');
    }

    creative.status = nextStatus;
    creative.rejectionReason = nextStatus === 'rejected' ? cleanString(rejectionReason) : '';
    creative.approvedAt = nextStatus === 'approved' ? new Date() : null;
    creative.deletedAt = null;
    creative.deletedBy = null;
    creative.deletionNote = '';

    await creative.save();
    logger.info(`Ad creative ${creativeId} status changed to ${nextStatus}`);
    this.invalidateActiveCreativesCache();
    return creative.toObject();
  }

  async deleteForProvider({ userId, advertisementId, note = '' }) {
    return this.deleteCampaign({
      userId,
      advertisementId,
      actorId: userId,
      actorRole: 'provider',
      note
    });
  }

  async deleteForAdmin({ creativeId, adminId, note = '' }) {
    const creative = await AdvertisementCreative.findById(creativeId);
    if (!creative) {
      throw new Error('Ad creative not found');
    }

    return this.deleteCampaign({
      userId: creative.user,
      advertisementId: creative.advertisementId,
      actorId: adminId || null,
      actorRole: 'admin',
      note
    });
  }

  async deleteCampaign({ userId, advertisementId, actorId = null, actorRole = 'provider', note = '' }) {
    const growth = await ProviderGrowth.findOne({ user: userId });
    if (!growth) {
      throw new Error('Provider campaign not found');
    }

    const pack = (growth.advertisements || []).find((item) => String(item._id) === String(advertisementId));
    if (!pack) {
      throw new Error('Advertisement pack not found');
    }

    if (String(pack.status || '').toLowerCase() === 'deleted') {
      throw new Error('This ad campaign is already deleted');
    }

    const now = new Date();
    const deletionNote = this.cleanDeletionNote(note)
      || (actorRole === 'admin'
        ? 'Deleted by admin. This campaign is not refundable.'
        : 'Deleted by provider. This campaign is not refundable.');

    pack.status = 'deleted';
    pack.paused = false;
    pack.pausedAt = null;
    pack.pausedBy = null;
    pack.pauseNote = '';
    pack.deletedAt = now;
    pack.deletedBy = actorId || null;
    pack.deletionNote = deletionNote;
    await growth.save();

    await AdvertisementCreative.updateMany(
      { user: userId, advertisementId: String(advertisementId) },
      {
        $set: {
          status: 'deleted',
          deletedAt: now,
          deletedBy: actorId || null,
          deletionNote,
          approvedAt: null,
          rejectionReason: ''
        }
      }
    );

    logger.info(`Advertisement ${advertisementId} deleted by ${actorRole} for user ${userId}`);
    this.invalidateActiveCreativesCache();
    const campaignMap = await this.getCampaignMapForAdvertisementIds([String(advertisementId)]);
    return campaignMap.get(String(advertisementId)) || null;
  }

  async getActiveCreatives({ city = '', state = '', profession = '', placement = 'home', globalOnly = false, localOnly = false, debug = false, limit = 5 } = {}) {
    const normalizedCity = normalizeCity(city);
    const normalizedState = normalizeState(state);
    const normalizedProfession = normalizeCategory(profession);
    const shouldShowGlobalOnly = Boolean(globalOnly);
    const shouldShowLocalOnly = Boolean(localOnly) && !shouldShowGlobalOnly;
    const now = new Date();
    const shouldDebug = Boolean(debug);
    const cacheKey = shouldDebug ? '' : this.getActiveCreativesCacheKey({
      city: normalizedCity,
      state: normalizedState,
      profession: normalizedProfession,
      placement,
      globalOnly: shouldShowGlobalOnly,
      localOnly: shouldShowLocalOnly,
      limit
    });
    const cached = cacheKey ? this.readActiveCreativesCache(cacheKey) : null;
    if (cached) {
      return cached;
    }

    const match = { status: 'approved' };
    if (shouldShowGlobalOnly) {
      match.level = 'national';
      match.campaignType = { $ne: 'category' };
    } else {
      const locationClauses = shouldShowLocalOnly ? [] : [{ level: 'national', campaignType: { $ne: 'category' } }];
      if (normalizedCity) {
        locationClauses.push({ level: 'city', campaignType: { $ne: 'category' }, city: { $regex: `^${escapeRegex(normalizedCity)}$`, $options: 'i' } });
      }
      if (normalizedState) {
        locationClauses.push({ level: 'state', campaignType: { $ne: 'category' }, state: { $regex: `^${escapeRegex(normalizedState)}$`, $options: 'i' } });
      }
      if (normalizedProfession && ['search', 'category'].includes(cleanString(placement).toLowerCase())) {
        const categoryMatch = { $regex: `^${escapeRegex(normalizedProfession)}$`, $options: 'i' };
        if (!shouldShowLocalOnly) {
          locationClauses.push({ level: 'national', campaignType: 'category', categories: categoryMatch });
        }
        if (normalizedCity) {
          locationClauses.push({ level: 'city', campaignType: 'category', city: { $regex: `^${escapeRegex(normalizedCity)}$`, $options: 'i' }, categories: categoryMatch });
        }
        if (normalizedState) {
          locationClauses.push({ level: 'state', campaignType: 'category', state: { $regex: `^${escapeRegex(normalizedState)}$`, $options: 'i' }, categories: categoryMatch });
        }
      }
      if (locationClauses.length === 0) {
        return shouldDebug ? {
          items: [],
          debug: {
            query: {
              city: normalizedCity,
              state: normalizedState,
              placement: cleanString(placement).toLowerCase() || 'home',
              globalOnly: shouldShowGlobalOnly,
              localOnly: shouldShowLocalOnly,
              limit: Math.max(1, Math.min(Number(limit || 5), 8))
            },
            matchedCreatives: 0,
            rows: []
          }
        } : [];
      }
      match.$or = locationClauses;
    }

    const creatives = await AdvertisementCreative.find(match)
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();

    if (creatives.length === 0) {
      return shouldDebug ? {
        items: [],
        debug: {
          query: {
            city: normalizedCity,
            state: normalizedState,
            placement: cleanString(placement).toLowerCase() || 'home',
            globalOnly: shouldShowGlobalOnly,
            localOnly: shouldShowLocalOnly,
            limit: Math.max(1, Math.min(Number(limit || 5), 8))
          },
          matchedCreatives: 0,
          rows: []
        }
      } : [];
    }

    // Filter out creatives whose packs have completed or are no longer active.
    const advertisementIds = creatives.map((item) => String(item.advertisementId));
    const growthDocs = await ProviderGrowth.find({ 'advertisements._id': { $in: advertisementIds } }).lean();
    const activePackIds = new Set();
    const packById = new Map();

    for (const doc of growthDocs) {
      for (const ad of doc.advertisements || []) {
        const runStart = getAdRunStart(ad);
        const expired = runStart ? new Date(runStart).getTime() + (30 * 24 * 60 * 60 * 1000) <= now.getTime() : false;
        const hasRemainingImpressions = Number(ad.impressionsUsed || 0) < Number(ad.impressionsTotal || 0);
        const packState = {
          id: String(ad._id),
          status: String(ad.status || ''),
          paused: Boolean(ad.paused),
          expired,
          hasRemainingImpressions,
          impressionsUsed: Number(ad.impressionsUsed || 0),
          impressionsTotal: Number(ad.impressionsTotal || 0)
        };
        packById.set(String(ad._id), packState);
        if (ad.status === 'active' && !ad.paused && !expired && Number(ad.impressionsUsed || 0) < Number(ad.impressionsTotal || 0)) {
          activePackIds.add(String(ad._id));
        }
      }
    }

    const prioritized = creatives
      .map((item) => ({
        ...item,
        _pack: packById.get(String(item.advertisementId)) || null,
        _priority: this.getLevelPriority(item.level, {
          city: normalizedCity,
          state: normalizedState,
          placement: cleanString(placement).toLowerCase() || 'home',
          globalOnly: shouldShowGlobalOnly,
          localOnly: shouldShowLocalOnly
        }) + this.getCategoryPriority(item, normalizedProfession)
      }));

    const filtered = prioritized
      .filter((item) => activePackIds.has(String(item.advertisementId)))
      .filter((item) => item._priority > 0)
      .sort((left, right) => {
        if (right._priority !== left._priority) {
          return right._priority - left._priority;
        }
        return new Date(right.updatedAt || right.createdAt || 0).getTime() - new Date(left.updatedAt || left.createdAt || 0).getTime();
      })
      .slice(0, Math.max(1, Math.min(Number(limit || 5), 8)));
    if (filtered.length === 0) {
      return shouldDebug ? {
        items: [],
        debug: {
          query: {
            city: normalizedCity,
            state: normalizedState,
            placement: cleanString(placement).toLowerCase() || 'home',
            globalOnly: shouldShowGlobalOnly,
            localOnly: shouldShowLocalOnly,
            limit: Math.max(1, Math.min(Number(limit || 5), 8))
          },
          matchedCreatives: creatives.length,
          rows: prioritized.map((item) => this.buildActiveCreativeDebugRow(item, {
            city: normalizedCity,
            state: normalizedState,
            placement,
            globalOnly: shouldShowGlobalOnly,
            localOnly: shouldShowLocalOnly,
            pack: item._pack
          }))
        }
      } : [];
    }

    // Fetch provider profiles for click-through + ProviderGrowth for website slugs.
    const userIds = [...new Set(filtered.map((item) => String(item.user)))];
    const [profiles, growthStates] = await Promise.all([
      ProfessionalProfile.find({ user: { $in: userIds } }).lean(),
      ProviderGrowth.find({ user: { $in: userIds } }).lean()
    ]);
    const profileByUser = new Map(profiles.map((p) => [String(p.user), p]));
    const growthByUser = new Map(growthStates.map((g) => [String(g.user), g]));

    const items = filtered.map((item) => {
      const profile = profileByUser.get(String(item.user));
      const growth = growthByUser.get(String(item.user));
      const websiteSlug = cleanString(growth?.websiteSlug) || '';
      const hasWebsite = Boolean(growth?.website?.active) && Boolean(growth?.website?.expiryDate) && new Date(growth.website.expiryDate) > new Date() && Boolean(websiteSlug);
      const targetPath = hasWebsite
        ? `/provider/site/${websiteSlug}`
        : profile?._id
          ? `/provider/${profile._id.toString()}`
          : '/search';

      return {
        id: item._id.toString(),
        advertisementId: item.advertisementId,
        campaignType: item.campaignType || 'location',
        level: item.level,
        city: item.city || '',
        state: item.state || '',
        categories: Array.isArray(item.categories) ? item.categories : [],
        imagePath: item.imagePath,
        imageWidth: Number(item.imageWidth || 0),
        imageHeight: Number(item.imageHeight || 0),
        providerName: '',
        profession: cleanString(profile?.profession || ''),
        targetPath,
        ctaMessage: hasWebsite
          ? 'Clicking this ad opens the provider website.'
          : 'Clicking this ad opens the provider profile where customers can call or message.'
      };
    });

    if (shouldDebug) {
      return {
        items,
        debug: {
          query: {
            city: normalizedCity,
            state: normalizedState,
            placement: cleanString(placement).toLowerCase() || 'home',
            globalOnly: shouldShowGlobalOnly,
            localOnly: shouldShowLocalOnly,
            limit: Math.max(1, Math.min(Number(limit || 5), 8))
          },
          matchedCreatives: creatives.length,
          rows: prioritized.map((item) => this.buildActiveCreativeDebugRow(item, {
            city: normalizedCity,
            state: normalizedState,
            placement,
            globalOnly: shouldShowGlobalOnly,
            localOnly: shouldShowLocalOnly,
            pack: item._pack
          }))
        }
      };
    }

    this.writeActiveCreativesCache(cacheKey, items);
    return items;
  }

  async recordView({ creativeId } = {}) {
    const creative = await AdvertisementCreative.findById(creativeId);
    if (!creative || creative.status !== 'approved') {
      return null;
    }

    const growth = await ProviderGrowth.findOne({ user: creative.user });
    if (!growth) {
      return null;
    }

    const pack = (growth.advertisements || []).find((item) => String(item._id) === String(creative.advertisementId));
    if (!pack || pack.status !== 'active') {
      return null;
    }
    if (pack.paused) {
      return null;
    }
    const packRunStart = getAdRunStart(pack);
    if (packRunStart && new Date(packRunStart).getTime() + (30 * 24 * 60 * 60 * 1000) <= Date.now()) {
      pack.status = 'completed';
      pack.completedAt = pack.completedAt || new Date();
      await growth.save();
      return null;
    }

    // Decrement remaining impressions by counting a view as an impression.
    pack.impressionsUsed = Number(pack.impressionsUsed || 0) + 1;
    if (Number(pack.impressionsUsed || 0) >= Number(pack.impressionsTotal || 0)) {
      pack.status = 'completed';
      pack.completedAt = pack.completedAt || new Date();
    }

    creative.views = Number(creative.views || 0) + 1;

    await Promise.all([growth.save(), creative.save()]);
    this.invalidateActiveCreativesCache();
    return { ok: true };
  }

  async recordClick({ creativeId } = {}) {
    const creative = await AdvertisementCreative.findById(creativeId);
    if (!creative || creative.status !== 'approved') {
      return null;
    }

    creative.clicks = Number(creative.clicks || 0) + 1;
    await creative.save();
    return { ok: true };
  }

  async getCreativeMapForUser(userId) {
    const rows = await AdvertisementCreative.find({ user: userId }).lean();
    const map = new Map();
    for (const row of rows) {
      map.set(String(row.advertisementId), {
        id: row._id.toString(),
        campaignType: row.campaignType || 'location',
        level: row.level,
        city: row.city || '',
        state: row.state || '',
        categories: Array.isArray(row.categories) ? row.categories : [],
        status: row.status,
        views: Number(row.views || 0),
        clicks: Number(row.clicks || 0),
        imagePath: row.imagePath,
        rejectionReason: row.rejectionReason || '',
        lastAdminMessage: this.getLastAdminMessage(row)
      });
    }
    return map;
  }
}

module.exports = new AdvertisementCreativeService();
