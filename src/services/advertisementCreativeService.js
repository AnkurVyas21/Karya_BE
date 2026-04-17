const AdvertisementCreative = require('../models/AdvertisementCreative');
const ProviderGrowth = require('../models/ProviderGrowth');
const ProfessionalProfile = require('../models/ProfessionalProfile');
const logger = require('../utils/logger');

const cleanString = (value) => String(value || '').trim();

const normalizeCity = (value) => cleanString(value).replace(/\s+/g, ' ');
const normalizeState = (value) => cleanString(value).replace(/\s+/g, ' ');
const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class AdvertisementCreativeService {
  cleanAdminMessage(value = '') {
    return cleanString(value).slice(0, 1200);
  }

  cleanPauseNote(value = '') {
    return cleanString(value).slice(0, 500);
  }

  getLevelPriority(level = '', { city = '', state = '', placement = 'home', globalOnly = false } = {}) {
    const normalizedLevel = cleanString(level).toLowerCase();
    if (globalOnly) {
      return normalizedLevel === 'national' ? 100 : 0;
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

  buildActiveCreativeDebugRow(item, context = {}) {
    const pack = context.pack || null;
    const normalizedPlacement = cleanString(context.placement).toLowerCase() || 'home';
    const priority = this.getLevelPriority(item.level, {
      city: context.city || '',
      state: context.state || '',
      placement: normalizedPlacement,
      globalOnly: Boolean(context.globalOnly)
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
      level: String(item.level || ''),
      city: item.city || '',
      state: item.state || '',
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

  async createOrReplaceCreative({ userId, advertisementId, level, city = '', state = '', imagePath, imageWidth = 0, imageHeight = 0 }) {
    const stateDoc = await ProviderGrowth.findOne({ user: userId });
    if (!stateDoc) {
      throw new Error('Advertisement pack not found');
    }

    const pack = (stateDoc.advertisements || []).find((item) => String(item._id) === String(advertisementId));
    if (!pack || pack.status !== 'active') {
      throw new Error('No active advertisement pack found for this campaign');
    }

    if (cleanString(pack.level).toLowerCase() !== cleanString(level).toLowerCase()) {
      throw new Error('Ad level does not match the purchased campaign');
    }

    if (Number(pack.impressionsUsed || 0) >= Number(pack.impressionsTotal || 0)) {
      throw new Error('This advertisement pack has already completed');
    }

    const normalizedCity = normalizeCity(city);
    const normalizedState = normalizeState(state);

    if (level === 'city' && !normalizedCity) {
      throw new Error('City is required for city-level advertisements');
    }

    if (level === 'state' && !normalizedState) {
      throw new Error('State is required for state-level advertisements');
    }

    if (!imagePath) {
      throw new Error('Ad image is required');
    }

    const existing = await AdvertisementCreative.findOne({ user: userId, advertisementId: String(advertisementId) });
    if (existing && existing.status === 'approved') {
      throw new Error('This ad is already approved and cannot be changed');
    }

    const profile = await ProfessionalProfile.findOne({ user: userId }).lean();

    const payload = {
      user: userId,
      professionalProfile: profile?._id || null,
      advertisementId: String(advertisementId),
      level,
      city: normalizedCity,
      state: normalizedState,
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
          level: pack.level,
          planId: pack.planId,
          planName: pack.planName,
          amount: Number(pack.amount || 0),
          impressionsTotal: Number(pack.impressionsTotal || 0),
          impressionsUsed: Number(pack.impressionsUsed || 0),
          status: pack.status,
          createdAt: pack.createdAt || null,
          completedAt: pack.completedAt || null,
          paused: Boolean(pack.paused),
          pausedAt: pack.pausedAt || null,
          pauseNote: pack.pauseNote || '',
          pausedBy: pack.pausedBy || null,
          providerUserId: doc.user?._id ? doc.user._id.toString() : (doc.user ? String(doc.user) : ''),
          provider: doc.user
            ? {
                userId: doc.user._id.toString(),
                fullName: [doc.user.firstName, doc.user.lastName].filter(Boolean).join(' ').trim(),
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
    if (['pending', 'approved', 'rejected'].includes(normalizedStatus)) {
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
      level: item.level,
      city: item.city || '',
      state: item.state || '',
      status: item.status,
      rejectionReason: item.rejectionReason || '',
      approvedAt: item.approvedAt || null,
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
            fullName: [item.user.firstName, item.user.lastName].filter(Boolean).join(' ').trim(),
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
      level: creative.level,
      city: creative.city || '',
      state: creative.state || '',
      status: creative.status,
      rejectionReason: creative.rejectionReason || '',
      approvedAt: creative.approvedAt || null,
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
            fullName: [creative.user.firstName, creative.user.lastName].filter(Boolean).join(' ').trim(),
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

    if (creative.status === 'approved' && nextStatus !== 'approved') {
      throw new Error('Approved ads cannot be reverted');
    }

    creative.status = nextStatus;
    creative.rejectionReason = nextStatus === 'rejected' ? cleanString(rejectionReason) : '';
    creative.approvedAt = nextStatus === 'approved' ? new Date() : null;

    await creative.save();
    logger.info(`Ad creative ${creativeId} status changed to ${nextStatus}`);
    return creative.toObject();
  }

  async getActiveCreatives({ city = '', state = '', placement = 'home', globalOnly = false, debug = false, limit = 5 } = {}) {
    const normalizedCity = normalizeCity(city);
    const normalizedState = normalizeState(state);
    const shouldShowGlobalOnly = Boolean(globalOnly);
    const now = new Date();
    const shouldDebug = Boolean(debug);
    const match = { status: 'approved' };
    if (shouldShowGlobalOnly) {
      match.level = 'national';
    } else {
      const locationClauses = [{ level: 'national' }];
      if (normalizedCity) {
        locationClauses.push({ level: 'city', city: { $regex: `^${escapeRegex(normalizedCity)}$`, $options: 'i' } });
      }
      if (normalizedState) {
        locationClauses.push({ level: 'state', state: { $regex: `^${escapeRegex(normalizedState)}$`, $options: 'i' } });
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
        const expired = ad.createdAt ? new Date(ad.createdAt).getTime() + (30 * 24 * 60 * 60 * 1000) <= now.getTime() : false;
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
          globalOnly: shouldShowGlobalOnly
        })
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
            limit: Math.max(1, Math.min(Number(limit || 5), 8))
          },
          matchedCreatives: creatives.length,
          rows: prioritized.map((item) => this.buildActiveCreativeDebugRow(item, {
            city: normalizedCity,
            state: normalizedState,
            placement,
            globalOnly: shouldShowGlobalOnly,
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
        level: item.level,
        city: item.city || '',
        state: item.state || '',
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
            limit: Math.max(1, Math.min(Number(limit || 5), 8))
          },
          matchedCreatives: creatives.length,
          rows: prioritized.map((item) => this.buildActiveCreativeDebugRow(item, {
            city: normalizedCity,
            state: normalizedState,
            placement,
            globalOnly: shouldShowGlobalOnly,
            pack: item._pack
          }))
        }
      };
    }

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
    if (pack.createdAt && new Date(pack.createdAt).getTime() + (30 * 24 * 60 * 60 * 1000) <= Date.now()) {
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
