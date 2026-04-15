const AdvertisementCreative = require('../models/AdvertisementCreative');
const ProviderGrowth = require('../models/ProviderGrowth');
const ProfessionalProfile = require('../models/ProfessionalProfile');
const logger = require('../utils/logger');

const cleanString = (value) => String(value || '').trim();

const normalizeCity = (value) => cleanString(value).replace(/\s+/g, ' ');
const normalizeState = (value) => cleanString(value).replace(/\s+/g, ' ');

class AdvertisementCreativeService {
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
      imagePath: item.imagePath,
      imageWidth: Number(item.imageWidth || 0),
      imageHeight: Number(item.imageHeight || 0),
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

  async getActiveCreatives({ city = '', limit = 5 } = {}) {
    const normalizedCity = normalizeCity(city);
    const match = { status: 'approved' };
    if (normalizedCity) {
      match.$or = [{ level: 'city', city: normalizedCity }, { level: 'national' }];
    } else {
      // Without a city context, only show national ads.
      match.level = 'national';
    }

    const creatives = await AdvertisementCreative.find(match)
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(Math.max(1, Math.min(Number(limit || 5), 8)))
      .lean();

    if (creatives.length === 0) {
      return [];
    }

    // Filter out creatives whose packs have completed or are no longer active.
    const advertisementIds = creatives.map((item) => String(item.advertisementId));
    const growthDocs = await ProviderGrowth.find({ 'advertisements._id': { $in: advertisementIds } }).lean();
    const activePackIds = new Set();

    for (const doc of growthDocs) {
      for (const ad of doc.advertisements || []) {
        if (ad.status === 'active' && Number(ad.impressionsUsed || 0) < Number(ad.impressionsTotal || 0)) {
          activePackIds.add(String(ad._id));
        }
      }
    }

    const filtered = creatives.filter((item) => activePackIds.has(String(item.advertisementId)));
    if (filtered.length === 0) {
      return [];
    }

    // Fetch provider profiles for click-through + ProviderGrowth for website slugs.
    const userIds = [...new Set(filtered.map((item) => String(item.user)))];
    const [profiles, growthStates] = await Promise.all([
      ProfessionalProfile.find({ user: { $in: userIds } }).lean(),
      ProviderGrowth.find({ user: { $in: userIds } }).lean()
    ]);
    const profileByUser = new Map(profiles.map((p) => [String(p.user), p]));
    const growthByUser = new Map(growthStates.map((g) => [String(g.user), g]));

    return filtered.map((item) => {
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
        targetPath
      };
    });
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
        rejectionReason: row.rejectionReason || ''
      });
    }
    return map;
  }
}

module.exports = new AdvertisementCreativeService();
