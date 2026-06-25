const AdvertisementCreative = require('../models/AdvertisementCreative');
const ProviderGrowth = require('../models/ProviderGrowth');
const ProfessionalProfile = require('../models/ProfessionalProfile');
const logger = require('../utils/logger');
const mongoose = require('mongoose');

const cleanString = (value) => String(value || '').trim();
const AD_PLACEMENTS = ['home', 'messages', 'search', 'category', 'internal'];
const AD_PLACEMENT_SET = new Set(AD_PLACEMENTS);

const parseListInput = (values = []) => {
  if (Array.isArray(values)) {
    return values;
  }
  const text = String(values || '').trim();
  if (!text) {
    return [];
  }
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch (_error) {
      // Fall back to comma-separated parsing.
    }
  }
  return text.split(',');
};
const normalizeCity = (value) => cleanString(value).replace(/\s+/g, ' ');
const normalizeState = (value) => cleanString(value).replace(/\s+/g, ' ');
const normalizeLocationList = (values = []) => {
  const raw = parseListInput(values);
  const seen = new Set();
  const result = [];
  for (const value of raw) {
    const normalized = cleanString(value).replace(/\s+/g, ' ');
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
};
const normalizeCategory = (value) => cleanString(value).replace(/\s+/g, ' ').slice(0, 80);
const normalizeCategoryKey = (value) => normalizeCategory(value).toLowerCase();
const normalizeCategories = (values = []) => {
  const raw = parseListInput(values);
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
const normalizePlacement = (value = '') => {
  const placement = cleanString(value).toLowerCase();
  return AD_PLACEMENT_SET.has(placement) ? placement : 'home';
};
const normalizePlacements = (values = []) => {
  const raw = parseListInput(values);
  const seen = new Set();
  const result = [];
  for (const value of raw) {
    const normalized = normalizePlacement(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result.length ? result : ['home'];
};
const normalizeTargetUrl = (value = '') => {
  const target = cleanString(value).slice(0, 1000);
  if (!target) {
    return '';
  }
  if (/^https?:\/\//i.test(target) || target.startsWith('/')) {
    return target;
  }
  return `https://${target}`;
};
const parseOptionalDate = (value = '') => {
  const raw = cleanString(value);
  if (!raw) {
    return null;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
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

  getAllowedPlacements() {
    return [...AD_PLACEMENTS];
  }

  isAdminCreativeLive(creative = {}, now = new Date()) {
    if (String(creative?.source || 'provider') !== 'admin') {
      return false;
    }
    if (String(creative?.status || '').toLowerCase() !== 'approved') {
      return false;
    }
    if (creative?.isActive === false) {
      return false;
    }
    const startsAt = creative?.startsAt ? new Date(creative.startsAt) : null;
    const endsAt = creative?.endsAt ? new Date(creative.endsAt) : null;
    if (startsAt && startsAt.getTime() > now.getTime()) {
      return false;
    }
    if (endsAt && endsAt.getTime() <= now.getTime()) {
      return false;
    }
    return true;
  }

  getAdminCreativePriority(item, context = {}) {
    const base = Number(item?.priority || 0) + 10000;
    const locationPriority = this.getLevelPriority(item?.level, {
      city: context.city || '',
      state: context.state || '',
      placement: normalizePlacement(context.placement),
      globalOnly: Boolean(context.globalOnly),
      localOnly: Boolean(context.localOnly)
    });
    const categoryPriority = this.getCategoryPriority(item, context.profession || '');
    return base + locationPriority + categoryPriority;
  }

  adminCreativeMatchesContext(item, context = {}) {
    const placement = normalizePlacement(context.placement);
    const placements = normalizePlacements(item?.placements);
    if (!placements.includes(placement)) {
      return false;
    }

    const normalizedCity = normalizeCity(context.city);
    const normalizedState = normalizeState(context.state);
    const normalizedProfession = normalizeCategory(context.profession);
    const normalizedLevel = cleanString(item?.level).toLowerCase() || 'national';
    const campaignType = cleanString(item?.campaignType).toLowerCase() === 'category' ? 'category' : 'location';

    if (context.globalOnly) {
      return normalizedLevel === 'national' && campaignType !== 'category';
    }

    if (normalizedLevel === 'city') {
      if (!normalizedCity) {
        return false;
      }
      const targetCities = normalizeLocationList(item?.cities?.length ? item.cities : [item.city]);
      const cityKey = normalizedCity.toLowerCase();
      if (!targetCities.some((city) => city.toLowerCase() === cityKey)) {
        return false;
      }
    }

    if (normalizedLevel === 'state' || normalizedLevel === 'city') {
      if (!normalizedState) {
        return false;
      }
      const targetStates = normalizeLocationList(item?.states?.length ? item.states : [item.state]);
      const stateKey = normalizedState.toLowerCase();
      if (!targetStates.some((state) => state.toLowerCase() === stateKey)) {
        return false;
      }
    }

    if (context.localOnly && normalizedLevel === 'national') {
      return false;
    }

    if (campaignType === 'category') {
      if (!normalizedProfession || !['search', 'category'].includes(placement)) {
        return false;
      }
      return this.getCategoryPriority(item, normalizedProfession) > 0;
    }

    return true;
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
      cities: normalizeLocationList(item.cities),
      states: normalizeLocationList(item.states),
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
      durationDays: Number(pack?.durationDays || 0),
      runStart: pack?.runStart || null,
      expiresAt: pack?.expiresAt || null,
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

  readBoolean(value, fallback = false) {
    if (typeof value === 'boolean') {
      return value;
    }
    const normalized = cleanString(value).toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'off', ''].includes(normalized)) {
      return false;
    }
    return fallback;
  }

  hasPayloadField(payload = {}, key = '') {
    return Object.prototype.hasOwnProperty.call(payload || {}, key);
  }

  buildManagedPayload(payload = {}, { partial = false } = {}) {
    const set = {};
    const include = (key) => !partial || this.hasPayloadField(payload, key);

    if (include('title')) {
      set.title = cleanString(payload.title).slice(0, 120) || 'Admin advertisement';
    }

    if (include('targetUrl')) {
      const targetUrl = normalizeTargetUrl(payload.targetUrl);
      if (!targetUrl) {
        throw new Error('Ad link is required');
      }
      set.targetUrl = targetUrl;
    }

    if (include('placements')) {
      set.placements = normalizePlacements(payload.placements);
    }

    if (include('priority')) {
      const priority = Math.round(Number(payload.priority || 0));
      set.priority = Math.max(0, Math.min(Number.isFinite(priority) ? priority : 0, 9999));
    }

    if (include('level')) {
      const level = cleanString(payload.level).toLowerCase() || 'national';
      if (!['city', 'state', 'national'].includes(level)) {
        throw new Error('Invalid ad visibility level');
      }
      set.level = level;
    }

    if (include('campaignType')) {
      set.campaignType = cleanString(payload.campaignType).toLowerCase() === 'category' ? 'category' : 'location';
    }

    if (include('city') || include('cities')) {
      const cities = normalizeLocationList(payload.cities || payload.city);
      set.city = cities[0] || normalizeCity(payload.city);
      set.cities = cities.length ? cities : (set.city ? [set.city] : []);
    }

    if (include('state') || include('states')) {
      const states = normalizeLocationList(payload.states || payload.state);
      set.state = states[0] || normalizeState(payload.state);
      set.states = states.length ? states : (set.state ? [set.state] : []);
    }

    if (include('categories')) {
      set.categories = normalizeCategories(payload.categories);
    }

    if (include('startsAt')) {
      set.startsAt = parseOptionalDate(payload.startsAt);
    }

    if (include('endsAt')) {
      set.endsAt = parseOptionalDate(payload.endsAt);
    }

    if (include('isActive')) {
      set.isActive = this.readBoolean(payload.isActive, true);
    }

    const level = set.level || 'national';
    const campaignType = set.campaignType || 'location';
    if (!partial) {
      if (level === 'city' && normalizeLocationList(set.cities).length === 0) {
        throw new Error('Choose at least one city for city-level admin ads');
      }
      if ((level === 'city' || level === 'state') && normalizeLocationList(set.states).length === 0) {
        throw new Error('Choose at least one state for city or state admin ads');
      }
      if (campaignType === 'category' && normalizeCategories(set.categories).length === 0) {
        throw new Error('Choose at least one profession/category for category admin ads');
      }
    }

    const startsAt = this.hasPayloadField(set, 'startsAt') ? set.startsAt : null;
    const endsAt = this.hasPayloadField(set, 'endsAt') ? set.endsAt : null;
    if (startsAt && endsAt && startsAt.getTime() >= endsAt.getTime()) {
      throw new Error('End date must be after start date');
    }

    return set;
  }

  managedStatusLabel(item = {}) {
    if (String(item?.status || '').toLowerCase() === 'deleted') {
      return 'archived';
    }
    if (!this.isAdminCreativeLive(item)) {
      const now = Date.now();
      if (item?.startsAt && new Date(item.startsAt).getTime() > now) {
        return 'scheduled';
      }
      if (item?.endsAt && new Date(item.endsAt).getTime() <= now) {
        return 'expired';
      }
      return 'paused';
    }
    return 'active';
  }

  serializeManagedAd(item = {}) {
    return {
      id: item._id?.toString?.() || String(item.id || ''),
      advertisementId: item.advertisementId || '',
      source: 'admin',
      title: item.title || 'Admin advertisement',
      targetUrl: item.targetUrl || '',
      placements: normalizePlacements(item.placements),
      priority: Number(item.priority || 0),
      campaignType: item.campaignType || 'location',
      level: item.level || 'national',
      city: item.city || '',
      state: item.state || '',
      cities: normalizeLocationList(item.cities),
      states: normalizeLocationList(item.states),
      categories: Array.isArray(item.categories) ? item.categories : [],
      status: item.status || 'approved',
      managedStatus: this.managedStatusLabel(item),
      isActive: item.isActive !== false,
      startsAt: item.startsAt || null,
      endsAt: item.endsAt || null,
      deletedAt: item.deletedAt || null,
      deletionNote: item.deletionNote || '',
      imagePath: item.imagePath || '',
      imageWidth: Number(item.imageWidth || 0),
      imageHeight: Number(item.imageHeight || 0),
      views: Number(item.views || 0),
      clicks: Number(item.clicks || 0),
      createdAt: item.createdAt || null,
      updatedAt: item.updatedAt || null,
      managedBy: item.managedBy
        ? {
            userId: item.managedBy._id?.toString?.() || String(item.managedBy || ''),
            fullName: item.managedBy.fullName || '',
            email: item.managedBy.email || ''
          }
        : null
    };
  }

  async listManagedForAdmin({ includeDeleted = true } = {}) {
    const match = { source: 'admin' };
    if (!includeDeleted) {
      match.status = { $ne: 'deleted' };
    }

    const items = await AdvertisementCreative.find(match)
      .populate('managedBy')
      .sort({ status: 1, priority: -1, updatedAt: -1, createdAt: -1 })
      .lean();

    return items.map((item) => this.serializeManagedAd(item));
  }

  async createManagedForAdmin({ adminId, payload = {}, file = null }) {
    const imagePath = cleanString(file?.path);
    if (!imagePath) {
      throw new Error('Ad image is required');
    }

    const set = this.buildManagedPayload(payload);
    const creative = await AdvertisementCreative.create({
      ...set,
      source: 'admin',
      user: adminId,
      managedBy: adminId || null,
      professionalProfile: null,
      advertisementId: `admin-${new mongoose.Types.ObjectId().toString()}`,
      imagePath,
      imageWidth: Number(payload.imageWidth || 0),
      imageHeight: Number(payload.imageHeight || 0),
      status: 'approved',
      approvedAt: new Date(),
      rejectionReason: '',
      deletedAt: null,
      deletedBy: null,
      deletionNote: ''
    });

    logger.info(`Admin managed ad created: ${creative._id}`);
    this.invalidateActiveCreativesCache();
    return this.serializeManagedAd(creative.toObject());
  }

  async updateManagedForAdmin({ creativeId, adminId, payload = {}, file = null }) {
    const creative = await AdvertisementCreative.findOne({ _id: creativeId, source: 'admin' });
    if (!creative) {
      throw new Error('Admin ad not found');
    }
    if (creative.status === 'deleted') {
      throw new Error('Archived admin ads cannot be edited');
    }

    const set = this.buildManagedPayload(payload, { partial: true });
    const nextLevel = set.level || creative.level || 'national';
    const nextCampaignType = set.campaignType || creative.campaignType || 'location';
    const nextCities = this.hasPayloadField(set, 'cities') ? set.cities : normalizeLocationList(creative.cities?.length ? creative.cities : [creative.city]);
    const nextStates = this.hasPayloadField(set, 'states') ? set.states : normalizeLocationList(creative.states?.length ? creative.states : [creative.state]);
    const nextCategories = this.hasPayloadField(set, 'categories') ? set.categories : normalizeCategories(creative.categories);
    const nextStartsAt = this.hasPayloadField(set, 'startsAt') ? set.startsAt : (creative.startsAt || null);
    const nextEndsAt = this.hasPayloadField(set, 'endsAt') ? set.endsAt : (creative.endsAt || null);

    if (nextLevel === 'city' && nextCities.length === 0) {
      throw new Error('Choose at least one city for city-level admin ads');
    }
    if ((nextLevel === 'city' || nextLevel === 'state') && nextStates.length === 0) {
      throw new Error('Choose at least one state for city or state admin ads');
    }
    if (nextCampaignType === 'category' && nextCategories.length === 0) {
      throw new Error('Choose at least one profession/category for category admin ads');
    }
    if (nextStartsAt && nextEndsAt && new Date(nextStartsAt).getTime() >= new Date(nextEndsAt).getTime()) {
      throw new Error('End date must be after start date');
    }

    Object.assign(creative, set);
    if (file?.path) {
      creative.imagePath = cleanString(file.path);
      creative.imageWidth = Number(payload.imageWidth || creative.imageWidth || 0);
      creative.imageHeight = Number(payload.imageHeight || creative.imageHeight || 0);
    }
    creative.managedBy = adminId || creative.managedBy || null;
    creative.status = 'approved';
    creative.approvedAt = creative.approvedAt || new Date();
    creative.deletedAt = null;
    creative.deletedBy = null;
    creative.deletionNote = '';

    await creative.save();
    this.invalidateActiveCreativesCache();
    return this.serializeManagedAd(creative.toObject());
  }

  async archiveManagedForAdmin({ creativeId, adminId, note = '' }) {
    const creative = await AdvertisementCreative.findOne({ _id: creativeId, source: 'admin' });
    if (!creative) {
      throw new Error('Admin ad not found');
    }

    creative.status = 'deleted';
    creative.isActive = false;
    creative.deletedAt = new Date();
    creative.deletedBy = adminId || null;
    creative.deletionNote = this.cleanDeletionNote(note) || 'Archived by admin.';
    await creative.save();

    this.invalidateActiveCreativesCache();
    return this.serializeManagedAd(creative.toObject());
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
    const packCities = normalizeLocationList(pack.cities);
    const packStates = normalizeLocationList(pack.states);
    const targetCities = level === 'city' ? normalizeLocationList(packCities.length ? packCities : [normalizedCity || pack.city]) : [];
    const targetStates = level === 'city' || level === 'state' ? normalizeLocationList(packStates.length ? packStates : [normalizedState || pack.state]) : [];

    if (level === 'city' && targetCities.length === 0) {
      throw new Error('City is required for city-level advertisements');
    }

    if ((level === 'city' || level === 'state') && targetStates.length === 0) {
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
      city: level === 'city' ? targetCities[0] || '' : '',
      state: level === 'city' || level === 'state' ? targetStates[0] || '' : '',
      cities: targetCities,
      states: targetStates,
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
          cities: normalizeLocationList(pack.cities),
          states: normalizeLocationList(pack.states),
          durationDays: Number(pack.durationDays || 30),
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

  async getReconciledGrowthDocsForAdvertisementIds(advertisementIds = [], now = new Date()) {
    const ids = (advertisementIds || []).map((id) => String(id)).filter(Boolean);
    if (ids.length === 0) {
      return [];
    }

    const idSet = new Set(ids);
    const growthDocs = await ProviderGrowth.find({ 'advertisements._id': { $in: ids } });

    for (const doc of growthDocs) {
      let changed = false;
      for (const ad of doc.advertisements || []) {
        const adId = String(ad._id);
        if (!idSet.has(adId)) {
          continue;
        }

        if (ad.status === 'scheduled' && ad.startsAt && new Date(ad.startsAt).getTime() <= now.getTime()) {
          ad.status = 'active';
          changed = true;
        }

        const runStart = getAdRunStart(ad);
        const durationDays = Number(ad.durationDays || 30);
        const expiresAt = runStart ? new Date(new Date(runStart).getTime() + (durationDays * 24 * 60 * 60 * 1000)) : null;
        const expired = expiresAt ? expiresAt.getTime() <= now.getTime() : false;
        const impressionsExhausted = Number(ad.impressionsUsed || 0) >= Number(ad.impressionsTotal || 0);
        if (ad.status === 'active' && (expired || impressionsExhausted)) {
          ad.status = 'completed';
          ad.completedAt = ad.completedAt || now;
          changed = true;
        }
      }

      if (changed) {
        await doc.save();
      }
    }

    return growthDocs.map((doc) => doc.toObject());
  }

  getActivePackMaps(growthDocs = [], now = new Date()) {
    const activePackIds = new Set();
    const packById = new Map();

    for (const doc of growthDocs) {
      for (const ad of doc.advertisements || []) {
        const runStart = getAdRunStart(ad);
        const durationDays = Number(ad.durationDays || 30);
        const expiresAt = runStart ? new Date(new Date(runStart).getTime() + (durationDays * 24 * 60 * 60 * 1000)) : null;
        const expired = expiresAt ? expiresAt.getTime() <= now.getTime() : false;
        const hasRemainingImpressions = Number(ad.impressionsUsed || 0) < Number(ad.impressionsTotal || 0);
        const packState = {
          id: String(ad._id),
          status: String(ad.status || ''),
          paused: Boolean(ad.paused),
          expired,
          durationDays,
          runStart,
          expiresAt,
          hasRemainingImpressions,
          impressionsUsed: Number(ad.impressionsUsed || 0),
          impressionsTotal: Number(ad.impressionsTotal || 0)
        };
        packById.set(String(ad._id), packState);
        if (ad.status === 'active' && !ad.paused && !expired && hasRemainingImpressions) {
          activePackIds.add(String(ad._id));
        }
      }
    }

    return { activePackIds, packById };
  }

  async hydrateActiveCreativeItems(filtered = []) {
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
        campaignType: item.campaignType || 'location',
        level: item.level,
        city: item.city || '',
        state: item.state || '',
        cities: normalizeLocationList(item.cities),
        states: normalizeLocationList(item.states),
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
  }

  hydrateActiveAdminCreativeItems(items = []) {
    return items.map((item) => ({
      id: item._id.toString(),
      advertisementId: item.advertisementId,
      source: 'admin',
      title: item.title || 'Sponsored',
      campaignType: item.campaignType || 'location',
      level: item.level,
      city: item.city || '',
      state: item.state || '',
      cities: normalizeLocationList(item.cities),
      states: normalizeLocationList(item.states),
      categories: Array.isArray(item.categories) ? item.categories : [],
      imagePath: item.imagePath,
      imageWidth: Number(item.imageWidth || 0),
      imageHeight: Number(item.imageHeight || 0),
      providerName: 'Nasdiya',
      profession: cleanString(item.title || 'Sponsored'),
      targetUrl: item.targetUrl || '',
      targetPath: item.targetUrl || '',
      ctaMessage: 'Clicking this ad opens the advertiser link selected by Nasdiya.'
    }));
  }

  async getActiveAdminCreatives({ city = '', state = '', profession = '', placement = 'home', globalOnly = false, localOnly = false, limit = 8 } = {}) {
    const normalizedPlacement = normalizePlacement(placement);
    const now = new Date();
    const candidates = await AdvertisementCreative.find({
      source: 'admin',
      status: 'approved',
      isActive: { $ne: false },
      $or: [
        { placements: normalizedPlacement },
        { placements: { $exists: false } },
        { placements: { $size: 0 } }
      ]
    })
      .sort({ priority: -1, updatedAt: -1, createdAt: -1 })
      .lean();

    const filtered = candidates
      .filter((item) => this.isAdminCreativeLive(item, now))
      .filter((item) => this.adminCreativeMatchesContext(item, {
        city,
        state,
        profession,
        placement: normalizedPlacement,
        globalOnly,
        localOnly
      }))
      .map((item) => ({
        ...item,
        _priority: this.getAdminCreativePriority(item, {
          city,
          state,
          profession,
          placement: normalizedPlacement,
          globalOnly,
          localOnly
        })
      }))
      .sort((left, right) => {
        if (right._priority !== left._priority) {
          return right._priority - left._priority;
        }
        return new Date(right.updatedAt || right.createdAt || 0).getTime() - new Date(left.updatedAt || left.createdAt || 0).getTime();
      })
      .slice(0, Math.max(1, Math.min(Number(limit || 8), 8)));

    return this.hydrateActiveAdminCreativeItems(filtered);
  }

  mergeActiveAdItems(adminItems = [], providerItems = [], limit = 5) {
    const seen = new Set();
    const rows = [...adminItems, ...providerItems].filter((item) => {
      const id = String(item?.id || '').trim();
      if (!id || seen.has(id)) {
        return false;
      }
      seen.add(id);
      return true;
    });
    return rows.slice(0, Math.max(1, Math.min(Number(limit || 5), 8)));
  }

  async listForAdmin({ status = '' } = {}) {
    const normalizedStatus = cleanString(status).toLowerCase();
    const match = { source: { $ne: 'admin' } };
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
      cities: normalizeLocationList(item.cities),
      states: normalizeLocationList(item.states),
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
    const creative = await AdvertisementCreative.findOne({ _id: creativeId, source: { $ne: 'admin' } })
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
      cities: normalizeLocationList(creative.cities),
      states: normalizeLocationList(creative.states),
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

    const creative = await AdvertisementCreative.findOne({ _id: creativeId, source: { $ne: 'admin' } });
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

    const creative = await AdvertisementCreative.findOne({ _id: creativeId, source: { $ne: 'admin' } });
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

    const creative = await AdvertisementCreative.findOne({ _id: creativeId, source: { $ne: 'admin' } });
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
    const creative = await AdvertisementCreative.findOne({ _id: creativeId, source: { $ne: 'admin' } });
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
    const normalizedPlacement = normalizePlacement(placement);
    const effectiveLimit = Math.max(1, Math.min(Number(limit || 5), 8));
    const shouldShowGlobalOnly = Boolean(globalOnly);
    const shouldShowLocalOnly = Boolean(localOnly) && !shouldShowGlobalOnly;
    const now = new Date();
    const shouldDebug = Boolean(debug);
    const cacheKey = shouldDebug ? '' : this.getActiveCreativesCacheKey({
      city: normalizedCity,
      state: normalizedState,
      profession: normalizedProfession,
      placement: normalizedPlacement,
      globalOnly: shouldShowGlobalOnly,
      localOnly: shouldShowLocalOnly,
      limit
    });
    const cached = cacheKey ? this.readActiveCreativesCache(cacheKey) : null;
    if (cached) {
      return cached;
    }

    const adminItems = await this.getActiveAdminCreatives({
      city: normalizedCity,
      state: normalizedState,
      profession: normalizedProfession,
      placement: normalizedPlacement,
      globalOnly: shouldShowGlobalOnly,
      localOnly: shouldShowLocalOnly,
      limit: effectiveLimit
    });

    const match = { status: 'approved', source: { $ne: 'admin' } };
    if (shouldShowGlobalOnly) {
      match.level = 'national';
      match.campaignType = { $ne: 'category' };
    } else {
      const locationClauses = shouldShowLocalOnly ? [] : [{ level: 'national', campaignType: { $ne: 'category' } }];
      if (normalizedCity) {
        const cityMatch = { $regex: `^${escapeRegex(normalizedCity)}$`, $options: 'i' };
        locationClauses.push({ level: 'city', campaignType: { $ne: 'category' }, $or: [{ city: cityMatch }, { cities: cityMatch }] });
      }
      if (normalizedState) {
        const stateMatch = { $regex: `^${escapeRegex(normalizedState)}$`, $options: 'i' };
        locationClauses.push({ level: 'state', campaignType: { $ne: 'category' }, $or: [{ state: stateMatch }, { states: stateMatch }] });
      }
      if (normalizedProfession && ['search', 'category'].includes(normalizedPlacement)) {
        const categoryMatch = { $regex: `^${escapeRegex(normalizedProfession)}$`, $options: 'i' };
        if (!shouldShowLocalOnly) {
          locationClauses.push({ level: 'national', campaignType: 'category', categories: categoryMatch });
        }
        if (normalizedCity) {
          const cityMatch = { $regex: `^${escapeRegex(normalizedCity)}$`, $options: 'i' };
          locationClauses.push({ level: 'city', campaignType: 'category', $or: [{ city: cityMatch }, { cities: cityMatch }], categories: categoryMatch });
        }
        if (normalizedState) {
          const stateMatch = { $regex: `^${escapeRegex(normalizedState)}$`, $options: 'i' };
          locationClauses.push({ level: 'state', campaignType: 'category', $or: [{ state: stateMatch }, { states: stateMatch }], categories: categoryMatch });
        }
      }
      if (locationClauses.length === 0) {
        match._allowUntargetedFallback = true;
      } else {
        match.$or = locationClauses;
      }
    }

    const allowUntargetedFallback = Boolean(match._allowUntargetedFallback);
    delete match._allowUntargetedFallback;

    let creatives = [];
    if (!allowUntargetedFallback) {
      creatives = await AdvertisementCreative.find(match)
        .sort({ updatedAt: -1, createdAt: -1 })
        .lean();
    }

    const usedUntargetedFallback = allowUntargetedFallback || creatives.length === 0;
    if (usedUntargetedFallback) {
      creatives = await AdvertisementCreative.find({ status: 'approved', source: { $ne: 'admin' } })
        .sort({ updatedAt: -1, createdAt: -1 })
        .lean();
    }

    if (creatives.length === 0) {
      const combinedItems = this.mergeActiveAdItems(adminItems, [], effectiveLimit);
      if (!shouldDebug && combinedItems.length > 0) {
        this.writeActiveCreativesCache(cacheKey, combinedItems);
        return combinedItems;
      }
      return shouldDebug ? {
        items: combinedItems,
        debug: {
          query: {
            city: normalizedCity,
            state: normalizedState,
            placement: normalizedPlacement,
            globalOnly: shouldShowGlobalOnly,
            localOnly: shouldShowLocalOnly,
            limit: effectiveLimit
          },
          matchedCreatives: 0,
          matchedAdminCreatives: adminItems.length,
          rows: []
        }
      } : combinedItems;
    }

    // Filter out creatives whose packs have completed or are no longer active.
    let advertisementIds = creatives.map((item) => String(item.advertisementId));
    let growthDocs = await this.getReconciledGrowthDocsForAdvertisementIds(advertisementIds, now);
    let { activePackIds, packById } = this.getActivePackMaps(growthDocs, now);

    let prioritized = creatives
      .map((item) => ({
        ...item,
        _pack: packById.get(String(item.advertisementId)) || null,
        _priority: this.getLevelPriority(item.level, {
          city: normalizedCity,
          state: normalizedState,
          placement: normalizedPlacement,
          globalOnly: shouldShowGlobalOnly,
          localOnly: shouldShowLocalOnly
        }) + this.getCategoryPriority(item, normalizedProfession)
      }));

    let filtered = prioritized
      .filter((item) => activePackIds.has(String(item.advertisementId)))
      .filter((item) => item._priority > 0)
      .sort((left, right) => {
        if (right._priority !== left._priority) {
          return right._priority - left._priority;
        }
        return new Date(right.updatedAt || right.createdAt || 0).getTime() - new Date(left.updatedAt || left.createdAt || 0).getTime();
      })
      .slice(0, effectiveLimit);

    let usedBroadRunningFallback = false;
    if (filtered.length === 0 && !usedUntargetedFallback) {
      creatives = await AdvertisementCreative.find({ status: 'approved', source: { $ne: 'admin' } })
        .sort({ updatedAt: -1, createdAt: -1 })
        .lean();
      advertisementIds = creatives.map((item) => String(item.advertisementId));
      growthDocs = await this.getReconciledGrowthDocsForAdvertisementIds(advertisementIds, now);
      ({ activePackIds, packById } = this.getActivePackMaps(growthDocs, now));
      prioritized = creatives.map((item) => ({
        ...item,
        _pack: packById.get(String(item.advertisementId)) || null,
        _priority: this.getLevelPriority(item.level, {
          city: normalizedCity,
          state: normalizedState,
          placement: normalizedPlacement,
          globalOnly: shouldShowGlobalOnly,
          localOnly: shouldShowLocalOnly
        }) + this.getCategoryPriority(item, normalizedProfession)
      }));
      usedBroadRunningFallback = true;
    }

    const usedRunningFallback = filtered.length === 0;
    if (usedRunningFallback) {
      filtered = prioritized
        .filter((item) => activePackIds.has(String(item.advertisementId)))
        .sort((left, right) => {
          const leftRemaining = Number(left._pack?.impressionsTotal || 0) - Number(left._pack?.impressionsUsed || 0);
          const rightRemaining = Number(right._pack?.impressionsTotal || 0) - Number(right._pack?.impressionsUsed || 0);
          if (rightRemaining !== leftRemaining) {
            return rightRemaining - leftRemaining;
          }
          return new Date(right.updatedAt || right.createdAt || 0).getTime() - new Date(left.updatedAt || left.createdAt || 0).getTime();
        })
        .slice(0, effectiveLimit);
    }

    if (filtered.length === 0) {
      const combinedItems = this.mergeActiveAdItems(adminItems, [], effectiveLimit);
      if (!shouldDebug && combinedItems.length > 0) {
        this.writeActiveCreativesCache(cacheKey, combinedItems);
        return combinedItems;
      }
      return shouldDebug ? {
        items: combinedItems,
        debug: {
          query: {
            city: normalizedCity,
            state: normalizedState,
            placement: normalizedPlacement,
            globalOnly: shouldShowGlobalOnly,
            localOnly: shouldShowLocalOnly,
            limit: effectiveLimit
          },
          matchedCreatives: creatives.length,
          matchedAdminCreatives: adminItems.length,
          usedUntargetedFallback,
          usedRunningFallback,
          usedBroadRunningFallback,
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

    const items = await this.hydrateActiveCreativeItems(filtered);
    const combinedItems = this.mergeActiveAdItems(adminItems, items, effectiveLimit);

    if (shouldDebug) {
      return {
        items: combinedItems,
        debug: {
          query: {
            city: normalizedCity,
            state: normalizedState,
            placement: normalizedPlacement,
            globalOnly: shouldShowGlobalOnly,
            localOnly: shouldShowLocalOnly,
            limit: effectiveLimit
          },
          matchedCreatives: creatives.length,
          matchedAdminCreatives: adminItems.length,
          usedUntargetedFallback,
          usedRunningFallback,
          usedBroadRunningFallback,
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

    this.writeActiveCreativesCache(cacheKey, combinedItems);
    return combinedItems;
  }

  async recordView({ creativeId } = {}) {
    const creative = await AdvertisementCreative.findById(creativeId);
    if (!creative || creative.status !== 'approved') {
      return null;
    }

    if (String(creative.source || 'provider') === 'admin') {
      if (!this.isAdminCreativeLive(creative)) {
        return null;
      }
      creative.views = Number(creative.views || 0) + 1;
      await creative.save();
      return { ok: true };
    }

    const growth = await ProviderGrowth.findOne({ user: creative.user });
    if (!growth) {
      return null;
    }

    const pack = (growth.advertisements || []).find((item) => String(item._id) === String(creative.advertisementId));
    if (!pack) {
      return null;
    }
    if (pack.status === 'scheduled' && pack.startsAt && new Date(pack.startsAt).getTime() <= Date.now()) {
      pack.status = 'active';
    }
    if (pack.status !== 'active') {
      return null;
    }
    if (pack.paused) {
      return null;
    }
    const packRunStart = getAdRunStart(pack);
    const durationDays = Number(pack.durationDays || 30);
    if (packRunStart && new Date(packRunStart).getTime() + (durationDays * 24 * 60 * 60 * 1000) <= Date.now()) {
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

    if (String(creative.source || 'provider') === 'admin' && !this.isAdminCreativeLive(creative)) {
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
        cities: normalizeLocationList(row.cities),
        states: normalizeLocationList(row.states),
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
