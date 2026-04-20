const ProfessionalProfile = require('../models/ProfessionalProfile');
const Review = require('../models/Review');
const Bookmark = require('../models/Bookmark');
const mongoose = require('mongoose');
const OpenAI = require('openai');
const logger = require('../utils/logger');
const { buildProfessionalSummary } = require('../utils/professionalPresenter');
const aiSearchService = require('./aiSearchService');
const { composeLocation, isProfessionalProfileListable } = require('../utils/accountPresenter');
const { deriveProfileTags, deriveRelatedProfessionTags, normalizeList, uniqueStrings } = require('../utils/profileTagUtils');
const professionCatalogService = require('./professionCatalogService');
const professionInferenceService = require('./professionInferenceService');
const professionSearchService = require('./professionSearchService');
const providerGrowthService = require('./providerGrowthService');
const textNormalizationService = require('./textNormalizationService');

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const escapeRegExp = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalizeOptionalNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const EXPLICIT_ROLE_TERMS = [
  'teacher',
  'professor',
  'lecturer',
  'tutor',
  'doctor',
  'lawyer',
  'advocate',
  'architect',
  'builder',
  'mason',
  'electrician',
  'plumber',
  'carpenter',
  'mechanic',
  'painter',
  'designer',
  'developer',
  'engineer',
  'photographer',
  'videographer',
  'beautician',
  'consultant',
  'writer',
  'marketer',
  'analyst',
  'manager',
  'security guard',
  'driver',
  'cleaner'
];
const EXPLICIT_ROLE_PATTERN = new RegExp(`\\b(?:${EXPLICIT_ROLE_TERMS.map(escapeRegExp).join('|')})\\b`, 'i');
const SPECIALIZED_GENERIC_ROLE_OVERRIDES = new Map([
  ['doctor', new Set(['veterinarian'])]
]);

class ProfessionalService {
  async createProfile(userId, profileData) {
    const profile = new ProfessionalProfile({ user: userId, ...profileData });
    await profile.save();
    logger.info(`Profile created for user: ${userId}`);
    return profile;
  }

  async upsertProfile(userId, profileData) {
    const existingProfile = await ProfessionalProfile.findOne({ user: userId });
    const existingProfileData = existingProfile?.toObject?.() || {};
    const update = {
      ...profileData
    };

    if ('specializations' in update && !('skills' in update)) {
      update.skills = update.specializations;
    }
    delete update.specializations;
    const professionAliases = normalizeList(update.professionAliases || update.aliases || []);
    const professionInferenceId = String(update.professionInferenceId || '').trim();
    const professionInputSource = String(update.professionInputSource || update.description || update.profession || '').trim();
    delete update.professionAliases;
    delete update.aliases;
    delete update.professionInferenceId;
    delete update.professionInputSource;

    if ('skills' in update) {
      update.skills = normalizeList(update.skills);
    }

    if ('tags' in update) {
      update.tags = normalizeList(update.tags);
    }

    if ('serviceAreas' in update) {
      update.serviceAreas = normalizeList(update.serviceAreas);
    }

    if ('experience' in update) {
      update.experience = normalizeOptionalNumber(update.experience, 0);
    }

    if ('allowContactDisplay' in update) {
      update.allowContactDisplay = ['true', '1', 'yes', 'on'].includes(String(update.allowContactDisplay).trim().toLowerCase())
        || update.allowContactDisplay === true;
    }

    if ('acceptsNightCalls' in update) {
      update.acceptsNightCalls = ['true', '1', 'yes', 'on'].includes(String(update.acceptsNightCalls).trim().toLowerCase())
        || update.acceptsNightCalls === true;
    }

    ['availability', 'availabilityStart', 'availabilityEnd'].forEach((field) => {
      if (field in update) {
        update[field] = String(update[field] || '').trim();
      }
    });

    if ('town' in update || 'area' in update || 'city' in update || 'state' in update || 'location' in update) {
      update.location = composeLocation({
        ...existingProfileData,
        ...update
      });
    }

    if (update.charges) {
      update.charges = {
        baseCharge: Number(update.charges.baseCharge || 0),
        visitingCharge: Number(update.charges.visitingCharge || 0),
        nightCharge: Number(update.charges.nightCharge || 0),
        emergencyCharge: Number(update.charges.emergencyCharge || 0)
      };
    }

    const mergedProfile = {
      ...existingProfileData,
      ...update
    };

    if ('profession' in mergedProfile) {
      mergedProfile.profession = await professionCatalogService.ensureProfession(mergedProfile.profession, {
        aliases: professionAliases,
        source: 'provider-profile',
        preserveInput: true
      });
      update.profession = mergedProfile.profession;
    }

    const professionCatalog = await professionCatalogService.getAllProfessions();
    if (!('tags' in update)) {
      update.tags = deriveProfileTags({
        profession: mergedProfile.profession,
        specializations: mergedProfile.skills,
        description: mergedProfile.description,
        serviceAreas: mergedProfile.serviceAreas,
        country: mergedProfile.country,
        state: mergedProfile.state,
        city: mergedProfile.city,
        town: mergedProfile.town,
        area: mergedProfile.area,
        professionCatalog
      });
    }

    const profile = await ProfessionalProfile.findOneAndUpdate(
      { user: userId },
      { $set: update },
      { new: true, upsert: true, runValidators: true }
    ).populate('user');

    if (update.profession) {
      await professionInferenceService.recordSelection(professionInferenceId, update.profession, {
        aliases: professionAliases,
        source: 'provider-profile',
        rawInput: professionInputSource
      });
    }

    logger.info(`Profile upserted for user: ${userId}`);
    return this.getProfileByUserId(userId);
  }

  async getProfileByUserId(userId, viewerId = null) {
    const profile = await ProfessionalProfile.findOne({ user: userId }).populate('user');
    if (!profile) {
      return null;
    }

    return this.formatProfile(profile, viewerId);
  }

  async detectProfession(description) {
    return professionInferenceService.inferProfession(description, {
      context: 'profession-detect'
    });
  }

  async getProfessionCatalog() {
    return professionCatalogService.getAllProfessions();
  }

  async searchProfessionals(filters, page, limit, viewerId = null) {
    const normalizedFilters = {
      query: String(filters?.query || '').trim(),
      profession: String(filters?.profession || '').trim(),
      location: String(filters?.location || '').trim(),
      country: String(filters?.country || '').trim(),
      state: String(filters?.state || '').trim(),
      city: String(filters?.city || '').trim(),
      town: String(filters?.town || '').trim(),
      skills: normalizeList(filters?.skills || [])
    };

    if (this.isBroadSearch(normalizedFilters)) {
      return this.searchBroadProfessionals(normalizedFilters, page, limit, viewerId);
    }

    const semanticFilters = await professionSearchService.resolveSearchFilters(normalizedFilters);
    const searchFilters = {
      ...normalizedFilters,
      profession: semanticFilters.profession || normalizedFilters.profession,
      professionCandidates: semanticFilters.professionCandidates || [],
      professionTerms: semanticFilters.professionTerms || []
    };

    const candidateQuery = this.buildSearchCandidateQuery(searchFilters);
    const candidates = await ProfessionalProfile.find(candidateQuery)
      .populate('user')
      .sort({ createdAt: -1 });
    const growthStateMap = await providerGrowthService.getGrowthStatesForUsers(
      candidates.map((profile) => profile.user?._id?.toString()).filter(Boolean)
    );

    const scoredProfiles = candidates
      .filter((profile) => isProfessionalProfileListable(profile))
      .map((profile) => ({
        profile,
        growthState: growthStateMap.get(profile.user?._id?.toString() || '') || {},
        ranking: this.scoreProfessionalProfile(
          profile,
          searchFilters,
          growthStateMap.get(profile.user?._id?.toString() || '') || {}
        )
      }))
      .filter(({ ranking }) => ranking.include);

    scoredProfiles.sort((left, right) => {
      if (right.ranking.matchedSignals !== left.ranking.matchedSignals) {
        return right.ranking.matchedSignals - left.ranking.matchedSignals;
      }

      if (right.ranking.score !== left.ranking.score) {
        return right.ranking.score - left.ranking.score;
      }

      return new Date(right.profile.createdAt || 0).getTime() - new Date(left.profile.createdAt || 0).getTime();
    });

    const pageNumber = Math.max(Number(page) || 1, 1);
    const pageSize = Math.max(Number(limit) || 10, 1);
    const totalDocs = scoredProfiles.length;
    const totalPages = totalDocs > 0 ? Math.ceil(totalDocs / pageSize) : 1;
    const startIndex = (pageNumber - 1) * pageSize;
    const pagedProfiles = scoredProfiles.slice(startIndex, startIndex + pageSize).map((item) => item.profile);

    logger.info(`Search performed with filters: ${JSON.stringify(searchFilters)}`);

    const profileIds = pagedProfiles.map((profile) => profile._id.toString());
    const reviewStats = await this.getReviewStatsMap(profileIds);
    const bookmarkedIds = await this.getBookmarkedProfileIds(viewerId, profileIds);
    const shownUserIds = pagedProfiles.map((profile) => profile.user?._id?.toString()).filter(Boolean);
    await providerGrowthService.recordAdImpressions(shownUserIds);

    return {
      docs: pagedProfiles.map((profile) => {
        const growthState = growthStateMap.get(profile.user?._id?.toString() || '') || {};
        return buildProfessionalSummary({
          profile,
          reviewStats: reviewStats[profile._id.toString()] || {},
          bookmarkedIds,
          growthState
        });
      }),
      totalDocs,
      limit: pageSize,
      page: pageNumber,
      totalPages,
      pagingCounter: startIndex + 1,
      hasPrevPage: pageNumber > 1,
      hasNextPage: pageNumber < totalPages,
      prevPage: pageNumber > 1 ? pageNumber - 1 : null,
      nextPage: pageNumber < totalPages ? pageNumber + 1 : null
    };
  }

  async searchBroadProfessionals(filters, page, limit, viewerId = null) {
    const pageNumber = Math.max(Number(page) || 1, 1);
    const pageSize = Math.max(Number(limit) || 10, 1);
    const candidateQuery = this.buildSearchCandidateQuery(filters);
    const totalDocs = await ProfessionalProfile.countDocuments(candidateQuery);
    const totalPages = totalDocs > 0 ? Math.ceil(totalDocs / pageSize) : 1;
    const startIndex = (pageNumber - 1) * pageSize;

    const pagedProfiles = await ProfessionalProfile.find(candidateQuery)
      .populate('user')
      .sort({ createdAt: -1 })
      .skip(startIndex)
      .limit(pageSize);

    const listableProfiles = pagedProfiles.filter((profile) => isProfessionalProfileListable(profile));
    const profileIds = listableProfiles.map((profile) => profile._id.toString());
    const reviewStats = await this.getReviewStatsMap(profileIds);
    const bookmarkedIds = await this.getBookmarkedProfileIds(viewerId, profileIds);
    const shownUserIds = listableProfiles.map((profile) => profile.user?._id?.toString()).filter(Boolean);
    const growthStateMap = await providerGrowthService.getGrowthStatesForUsers(shownUserIds);
    await providerGrowthService.recordAdImpressions(shownUserIds);

    logger.info(`Broad search performed with filters: ${JSON.stringify(filters)}`);

    return {
      docs: listableProfiles.map((profile) => buildProfessionalSummary({
        profile,
        reviewStats: reviewStats[profile._id.toString()] || {},
        bookmarkedIds,
        growthState: growthStateMap.get(profile.user?._id?.toString() || '') || {}
      })),
      totalDocs,
      limit: pageSize,
      page: pageNumber,
      totalPages,
      pagingCounter: startIndex + 1,
      hasPrevPage: pageNumber > 1,
      hasNextPage: pageNumber < totalPages,
      prevPage: pageNumber > 1 ? pageNumber - 1 : null,
      nextPage: pageNumber < totalPages ? pageNumber + 1 : null
    };
  }

  async aiSearch(input) {
    const options = typeof input === 'string'
      ? { problem: input }
      : { ...(input || {}) };

    if (!options.problem || !String(options.problem).trim()) {
      throw new Error('Problem description is required');
    }

    const result = await aiSearchService.inferSearch({
      ...options,
      allowedProfessions: uniqueStrings(options.allowedProfessions || [])
    });
    logger.info(`AI search for problem: ${options.problem} using ${result.providerUsed}`);
    return result;
  }

  async classifyProfessionWithAi(description, professionCatalogEntries = [], options = {}) {
    const prompt = this.buildProfessionClassifierPrompt(description, professionCatalogEntries, options);
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 300
    });
    const rawContent = String(response.choices?.[0]?.message?.content || '{}').trim();
    const jsonText = rawContent.startsWith('{')
      ? rawContent
      : rawContent.match(/\{[\s\S]*\}/)?.[0] || '{}';

    return JSON.parse(jsonText);
  }

  async getProfile(id, viewerId = null) {
    const profile = await ProfessionalProfile.findById(id).populate('user');
    if (profile) {
      await ProfessionalProfile.findByIdAndUpdate(id, { $inc: { viewCount: 1 } });
    }
    return profile ? this.formatProfile(profile, viewerId) : null;
  }

  async getRatings(profileId) {
    const reviews = await Review.find({ professional: profileId }).populate('user').sort({ createdAt: -1 });
    return reviews.map((review) => ({
      id: review._id.toString(),
      rating: review.rating,
      comment: review.comment,
      createdAt: review.createdAt,
      userName: [review.user?.firstName, review.user?.lastName].filter(Boolean).join(' ').trim() || 'Anonymous'
    }));
  }

  async getDashboardSummary(userId) {
    const profile = await ProfessionalProfile.findOne({ user: userId });
    if (!profile) {
      return {
        hasProfile: false,
        stats: {
          totalViews: 0,
          totalRatings: 0,
          averageRating: 0,
          bookmarks: 0
        }
      };
    }

    const reviewStatsMap = await this.getReviewStatsMap([profile._id.toString()]);
    const stats = reviewStatsMap[profile._id.toString()] || {};
    const bookmarks = await Bookmark.countDocuments({ professional: profile._id });

    return {
      hasProfile: true,
      profileId: profile._id.toString(),
      stats: {
        totalViews: profile.viewCount || 0,
        totalRatings: stats.reviewCount || 0,
        averageRating: Number((stats.averageRating || 0).toFixed(1)),
        bookmarks
      }
    };
  }

  async getBookmarks(userId) {
    const bookmarks = await Bookmark.find({ user: userId }).populate({
      path: 'professional',
      populate: {
        path: 'user'
      }
    }).sort({ createdAt: -1 });

    const profileIds = bookmarks
      .map((bookmark) => bookmark.professional?._id?.toString())
      .filter(Boolean);
    const growthStateMap = await providerGrowthService.getGrowthStatesForUsers(
      bookmarks.map((bookmark) => bookmark.professional?.user?._id?.toString()).filter(Boolean)
    );
    const reviewStats = await this.getReviewStatsMap(profileIds);
    const bookmarkedIds = new Set(profileIds);

    return bookmarks
      .filter((bookmark) => bookmark.professional)
      .map((bookmark) => ({
        id: bookmark._id.toString(),
        createdAt: bookmark.createdAt,
        professional: buildProfessionalSummary({
          profile: bookmark.professional,
          reviewStats: reviewStats[bookmark.professional._id.toString()] || {},
          bookmarkedIds,
          growthState: growthStateMap.get(bookmark.professional?.user?._id?.toString() || '') || {}
        })
      }));
  }

  async getBookmarkedProfileIds(userId, profileIds = []) {
    if (!userId || profileIds.length === 0) {
      return new Set();
    }

    const bookmarks = await Bookmark.find({
      user: userId,
      professional: { $in: profileIds }
    }).select('professional');

    return new Set(bookmarks.map((bookmark) => bookmark.professional.toString()));
  }

  async getReviewStatsMap(profileIds = []) {
    if (profileIds.length === 0) {
      return {};
    }

    const stats = await Review.aggregate([
      {
        $match: {
          professional: {
            $in: profileIds.map((id) => new mongoose.Types.ObjectId(id))
          }
        }
      },
      {
        $group: {
          _id: '$professional',
          averageRating: { $avg: '$rating' },
          reviewCount: { $sum: 1 }
        }
      }
    ]);

    return stats.reduce((acc, item) => {
      acc[item._id.toString()] = {
        averageRating: item.averageRating || 0,
        reviewCount: item.reviewCount || 0
      };
      return acc;
    }, {});
  }

  async formatProfile(profile, viewerId = null) {
    const profileId = profile._id.toString();
    const reviewStats = await this.getReviewStatsMap([profileId]);
    const bookmarkedIds = await this.getBookmarkedProfileIds(viewerId, [profileId]);
    const growthStateMap = await providerGrowthService.getGrowthStatesForUsers(
      [profile.user?._id?.toString?.() || profile.user?.toString?.() || ''].filter(Boolean)
    );
    const userId = profile.user?._id?.toString?.() || profile.user?.toString?.() || '';

    return buildProfessionalSummary({
      profile,
      reviewStats: reviewStats[profileId] || {},
      bookmarkedIds,
      growthState: growthStateMap.get(userId) || {}
    });
  }

  buildSearchCandidateQuery(filters = {}) {
    const query = {};
    const andConditions = [];
    const professionConditions = [];
    const locationConditions = [];
    const pushRegexConditions = (bucket, fields, value) => {
      const term = String(value || '').trim();
      if (!term) {
        return;
      }

      const regex = new RegExp(escapeRegExp(term), 'i');
      fields.forEach((field) => {
        bucket.push({ [field]: regex });
      });
    };

    if (filters.country) {
      if (filters.country.toLowerCase() === 'india') {
        andConditions.push({
          $or: [
            { country: /india/i },
            { country: '' },
            { country: { $exists: false } }
          ]
        });
      } else {
        query.country = new RegExp(`^${escapeRegExp(filters.country)}$`, 'i');
      }
    }

    pushRegexConditions(professionConditions, ['profession', 'skills', 'tags'], filters.profession);
    (filters.professionTerms || []).forEach((term) => pushRegexConditions(professionConditions, ['profession', 'skills', 'tags', 'description'], term));
    (filters.skills || []).forEach((skill) => pushRegexConditions(professionConditions, ['skills', 'tags', 'profession', 'description'], skill));

    pushRegexConditions(locationConditions, ['city', 'location', 'serviceAreas'], filters.city);
    pushRegexConditions(locationConditions, ['town', 'area', 'location', 'serviceAreas'], filters.town);
    pushRegexConditions(locationConditions, ['state', 'location', 'serviceAreas'], filters.state);
    pushRegexConditions(locationConditions, ['location', 'city', 'town', 'area', 'state', 'serviceAreas'], filters.location);

    if (professionConditions.length > 0) {
      andConditions.push({ $or: professionConditions });
    }

    if (locationConditions.length > 0) {
      andConditions.push({ $or: locationConditions });
    }

    if (!filters.city && !filters.state && filters.query) {
      const queryRegex = new RegExp(escapeRegExp(filters.query), 'i');
      andConditions.push({
        $or: [
          { profession: queryRegex },
          { skills: queryRegex },
          { tags: queryRegex },
          { description: queryRegex }
        ]
      });
    }

    if (andConditions.length > 0) {
      query.$and = andConditions;
    }

    return query;
  }

  isBroadSearch(filters = {}) {
    return !String(filters.query || '').trim()
      && !String(filters.profession || '').trim()
      && !String(filters.location || '').trim()
      && !String(filters.state || '').trim()
      && !String(filters.city || '').trim()
      && !String(filters.town || '').trim()
      && (!Array.isArray(filters.skills) || filters.skills.length === 0);
  }

  scoreProfessionalProfile(profile, filters = {}, growthState = {}) {
    const signals = {};
    let score = 0;

    const profileData = {
      profession: this.normalizeSearchText(profile.profession),
      location: this.normalizeSearchText(profile.location),
      country: this.normalizeSearchText(profile.country),
      state: this.normalizeSearchText(profile.state),
      city: this.normalizeSearchText(profile.city),
      town: this.normalizeSearchText(profile.town),
      area: this.normalizeSearchText(profile.area),
      description: this.normalizeSearchText(profile.description),
      skills: normalizeList(profile.skills || []).map((item) => this.normalizeSearchText(item)),
      tags: normalizeList(profile.tags || []).map((item) => this.normalizeSearchText(item)),
      serviceAreas: normalizeList(profile.serviceAreas || []).map((item) => this.normalizeSearchText(item))
    };

    const combinedLocation = [
      profileData.location,
      profileData.area,
      profileData.town,
      profileData.city,
      profileData.state,
      profileData.country,
      ...profileData.serviceAreas
    ].filter(Boolean).join(' ');

    const combinedSearchable = [
      profileData.profession,
      profileData.description,
      combinedLocation,
      ...profileData.skills,
      ...profileData.tags,
      ...profileData.serviceAreas
    ].filter(Boolean).join(' ');

    const markSignal = (name, matched, weight) => {
      signals[name] = matched;
      if (matched) {
        score += weight;
      }
    };

    const normalizedProfessionKey = textNormalizationService.normalizeProfessionKey(profile.profession || '');
    const professionTargets = uniqueStrings([
      filters.profession,
      ...(filters.professionCandidates || []),
      ...(filters.professionTerms || [])
    ]).map((item) => textNormalizationService.normalizeProfessionKey(item));
    const exactCategoryMatch = professionTargets.some((target) => target && target === normalizedProfessionKey);
    const aliasMatch = professionTargets.some((target) => target && profileData.tags.some((tag) => textNormalizationService.normalizeProfessionKey(tag) === target));
    const professionScore = exactCategoryMatch
      ? 100
      : aliasMatch
        ? 70
        : Math.max(
            this.matchWeightedText(profileData.profession, filters.profession),
            ...(filters.professionCandidates || []).map((candidate) => this.matchWeightedText(profileData.profession, candidate)),
            ...(filters.professionTerms || []).map((term) => this.matchWeightedText(combinedSearchable, term))
          );
    markSignal('profession', professionScore > 0, professionScore);
    const genericLocationScore = this.matchWeightedText(combinedLocation, filters.location);
    const stateScore = this.matchWeightedText(`${profileData.state} ${combinedLocation}`, filters.state);
    const cityScore = this.matchWeightedText(`${profileData.city} ${combinedLocation}`, filters.city);
    const townScore = this.matchWeightedText(`${profileData.town} ${profileData.area} ${combinedLocation}`, filters.town);
    markSignal('location', genericLocationScore > 0, genericLocationScore);
    markSignal('state', stateScore > 0, stateScore > 0 ? Math.max(stateScore, 25) : 0);
    markSignal('city', cityScore > 0, cityScore > 0 ? Math.max(cityScore, 60) : 0);
    markSignal('town', townScore > 0, townScore > 0 ? Math.max(townScore, 40) : 0);

    const countryScore = this.matchCountry(profileData.country, filters.country);
    markSignal('country', countryScore > 0, countryScore);

    const skillsScore = (filters.skills || []).reduce((total, skill) => {
      const normalizedSkill = this.normalizeSearchText(skill);
      const exactSkill = profileData.skills.some((item) => item === normalizedSkill) || profileData.tags.some((item) => item === normalizedSkill);
      const partialSkill = profileData.skills.some((item) => item.includes(normalizedSkill) || normalizedSkill.includes(item))
        || profileData.tags.some((item) => item.includes(normalizedSkill) || normalizedSkill.includes(item));
      const skillMatch = exactSkill
        ? 6
        : partialSkill
          ? 4
          : combinedSearchable.includes(normalizedSkill)
            ? 2
            : 0;
      return total + skillMatch;
    }, 0);
    markSignal('skills', skillsScore > 0, skillsScore);

    const queryScore = this.scoreQueryTokens(combinedSearchable, filters.query);
    markSignal('query', queryScore > 0, queryScore);

    const activeFilters = Object.entries({
      query: filters.query,
      profession: filters.profession,
      location: filters.location,
      country: filters.country,
      state: filters.state,
      city: filters.city,
      town: filters.town,
      skills: (filters.skills || []).join(' ')
    }).filter(([, value]) => String(value || '').trim()).length;

    const matchedSignals = Object.values(signals).filter(Boolean).length;
    if (profile.isProfileComplete) {
      score += 10;
    }
    score += providerGrowthService.getRankingBoost(growthState);

    return {
      include: activeFilters === 0 || matchedSignals > 0,
      matchedSignals,
      score
    };
  }

  normalizeSearchText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  matchWeightedText(haystack, needle) {
    const target = this.normalizeSearchText(needle);
    const source = this.normalizeSearchText(haystack);
    if (!target || !source) {
      return 0;
    }

    if (source === target) {
      return 12;
    }

    if (source.startsWith(target)) {
      return 9;
    }

    if (source.includes(target)) {
      return 7;
    }

    const sourceTokens = source.split(' ').filter(Boolean);
    const targetTokens = target.split(' ').filter(Boolean);
    const overlap = targetTokens.filter((token) => sourceTokens.some((item) => item.includes(token) || token.includes(item)));
    if (overlap.length > 0) {
      return Math.min(6, overlap.length * 2);
    }

    return 0;
  }

  matchCountry(countryValue, countryFilter) {
    const filter = this.normalizeSearchText(countryFilter);
    if (!filter) {
      return 0;
    }

    const value = this.normalizeSearchText(countryValue);
    if (value === filter) {
      return 8;
    }

    if (filter === 'india' && !value) {
      return 3;
    }

    return value.includes(filter) ? 5 : 0;
  }

  scoreQueryTokens(searchableText, rawQuery) {
    const query = this.normalizeSearchText(rawQuery);
    if (!query) {
      return 0;
    }

    const text = this.normalizeSearchText(searchableText);
    if (!text) {
      return 0;
    }

    if (text.includes(query)) {
      return 10;
    }

    return query
      .split(' ')
      .filter(Boolean)
      .reduce((total, token) => total + (text.includes(token) ? 3 : 0), 0);
  }

  buildProfessionClassifierPrompt(description, professionCatalogEntries = [], options = {}) {
    const catalogSummary = professionCatalogEntries
      .slice(0, 120)
      .map((entry) => {
        const aliases = uniqueStrings(entry.aliases || []).slice(0, 4).join(', ');
        const tags = uniqueStrings(entry.tags || []).slice(0, 4).join(', ');
        return `${entry.name}${aliases ? ` | aliases: ${aliases}` : ''}${tags ? ` | tags: ${tags}` : ''}`;
      })
      .join('\n');
    const retryContext = options.retry
      ? [
          'Your previous answer was considered weak or incorrect.',
          `Previous answer: ${JSON.stringify(options.previousResult || {})}`,
          `Explicit role phrases seen in the description: ${(options.explicitCandidates || []).join(', ') || 'none'}`
        ].join('\n')
      : '';

    return [
      'You are a profession classifier.',
      'Your job is to classify the user\'s own profession from their self-description.',
      'Do not act like a creative assistant.',
      'Rules:',
      '1. Extract only the primary profession mentioned or clearly implied by the user\'s work.',
      '2. Convert user actions into a standard profession name when the action is clear.',
      '3. Prefer explicit role words such as teacher, professor, doctor, lawyer, engineer, developer, plumber, electrician, etc. over weaker inferences.',
      '4. Recognize common work descriptions, not just exact job titles.',
      '5. Do not guess from weak, indirect, or loosely related hints.',
      '6. Return "unknown" only when the profession is truly unclear or confidence is low.',
      '7. If the text says "I am a chemistry professor", keep the result close to that explicit role, such as "Chemistry Professor".',
      '8. Do not replace an explicit academic role with a service trade.',
      'Examples:',
      '- "I repair cars" -> "Auto Mechanic"',
      '- "I fix vehicles" -> "Auto Mechanic"',
      '- "I teach students chemistry" -> "Chemistry Teacher"',
      '- "I cut hair" -> "Barber"',
      '- "I am a doctor for cows, buffaloes, and other animals" -> "Veterinarian"',
      '- "I am an animal doctor" -> "Veterinarian"',
      'Use the catalog when it fits. If no catalog item fits, produce a short standard English profession title.',
      'Return JSON only in this exact shape:',
      '{"profession":"", "aliases":[""], "specializations":[""], "tags":[""], "similarProfessions":[""], "matchedText":"", "confidence":0, "reason":"", "status":"confirmed|unknown"}',
      retryContext,
      'Profession catalog:',
      catalogSummary,
      `Description: ${JSON.stringify(description)}`
    ].filter(Boolean).join('\n');
  }

  extractExplicitProfessionCandidates(description = '', professionCatalogEntries = []) {
    const text = String(description || '').trim();
    if (!text) {
      return [];
    }

    const patterns = [
      /\b(?:i am|i'm|i am working as|i work as|working as|my profession is|my role is|currently working as)\s+(?:an?\s+)?([a-z][a-z/&+\s-]{2,80})/ig,
      new RegExp(`\\b([a-z][a-z/&+\\s-]{0,48}\\s(?:${EXPLICIT_ROLE_TERMS.map(escapeRegExp).join('|')}))\\b`, 'ig')
    ];

    const cleanedCandidates = patterns.flatMap((pattern) => {
      const matches = [];
      let match = pattern.exec(text);

      while (match) {
        const cleaned = String(match[1] || '')
          .replace(/^(?:i am|i'm|i am working as|i work as|working as|my profession is|my role is|currently working as)\s+(?:an?\s+)?/i, '')
          .replace(/\b(?:who|that|where|because|and|but)\b.*$/i, '')
          .replace(/\b(?:for|with|at|in)\b.*$/i, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (cleaned) {
          matches.push(cleaned);
        }
        match = pattern.exec(text);
      }

      return matches;
    });

    return uniqueStrings(
      cleanedCandidates
        .filter((candidate) => EXPLICIT_ROLE_PATTERN.test(candidate))
        .map((candidate) => this.resolveExplicitProfessionCandidate(candidate, professionCatalogEntries))
    );
  }

  resolveExplicitProfessionCandidate(candidate = '', professionCatalogEntries = []) {
    const formattedCandidate = professionCatalogService.formatProfessionName(candidate);
    const matchedEntry = professionCatalogService.findBestProfessionMatchSync(candidate, professionCatalogEntries);
    const hasQualifier = formattedCandidate.split(/\s+/).filter(Boolean).length > 1 && EXPLICIT_ROLE_PATTERN.test(formattedCandidate);

    if (hasQualifier) {
      return formattedCandidate;
    }

    return matchedEntry?.name || formattedCandidate;
  }

  descriptionMentionsProfession(description = '', profession = '', professionCatalogEntries = []) {
    const normalizedDescription = this.normalizeSearchText(description);
    const matchedEntry = professionCatalogService.findBestProfessionMatchSync(profession, professionCatalogEntries);
    const terms = matchedEntry
      ? professionCatalogService.getSearchTerms(matchedEntry)
      : [profession];

    return terms.some((term) => {
      const normalizedTerm = this.normalizeSearchText(term);
      if (!normalizedTerm) {
        return false;
      }

      if (normalizedDescription.includes(normalizedTerm)) {
        return true;
      }

      const tokens = normalizedTerm.split(' ').filter(Boolean);
      return tokens.length > 1 && tokens.every((token) => normalizedDescription.includes(token));
    });
  }

  descriptionSupportsProfessionIntent(description = '', profession = '', professionCatalog = [], professionCatalogEntries = []) {
    if (this.descriptionMentionsProfession(description, profession, professionCatalogEntries)) {
      return true;
    }

    const availableProfessions = professionCatalog.length > 0
      ? professionCatalog
      : professionCatalogEntries.map((entry) => entry.name);
    const heuristicSuggestion = inferProfessionFromText(description, availableProfessions);
    if (!heuristicSuggestion.profession || heuristicSuggestion.score < 6) {
      return false;
    }

    const resolvedHeuristicProfession = this.resolveExplicitProfessionCandidate(heuristicSuggestion.profession, professionCatalogEntries);
    const resolvedProfession = this.resolveExplicitProfessionCandidate(profession, professionCatalogEntries);

    return this.shareSameRoleFamily(resolvedHeuristicProfession, resolvedProfession);
  }

  shouldPreferHeuristicProfession(explicitProfession = '', heuristicSuggestion = {}, description = '', professionCatalogEntries = []) {
    const normalizedExplicitProfession = this.normalizeSearchText(explicitProfession);
    const normalizedHeuristicProfession = this.normalizeSearchText(heuristicSuggestion?.profession || '');
    const allowedOverrides = SPECIALIZED_GENERIC_ROLE_OVERRIDES.get(normalizedExplicitProfession);

    if (!allowedOverrides || !allowedOverrides.has(normalizedHeuristicProfession)) {
      return false;
    }

    return Number(heuristicSuggestion?.score || 0) >= 6
      && this.descriptionMentionsProfession(description, heuristicSuggestion.profession, professionCatalogEntries);
  }

  getBestGuessProfessions(description = '', professionCatalog = [], professionCatalogEntries = [], heuristicSuggestion = null) {
    const heuristic = heuristicSuggestion || inferProfessionFromText(description, professionCatalog);
    const catalogMatches = professionCatalogService.findProfessionMatchesInTextSync(description, professionCatalogEntries, 5)
      .map((entry) => entry.name);
    const broaderHeuristic = inferProfessionFromText(description);

    return uniqueStrings([
      heuristic?.profession || '',
      ...((heuristic?.similarProfessions) || []),
      broaderHeuristic?.profession || '',
      ...((broaderHeuristic?.similarProfessions) || []),
      ...catalogMatches
    ]).filter((item) => item && item.toLowerCase() !== 'unknown').slice(0, 5);
  }

  shareSameRoleFamily(left = '', right = '') {
    const leftNormalized = this.normalizeSearchText(left);
    const rightNormalized = this.normalizeSearchText(right);
    if (!leftNormalized || !rightNormalized) {
      return false;
    }

    if (leftNormalized === rightNormalized || leftNormalized.includes(rightNormalized) || rightNormalized.includes(leftNormalized)) {
      return true;
    }

    const leftRole = EXPLICIT_ROLE_TERMS.find((role) => leftNormalized.includes(role));
    const rightRole = EXPLICIT_ROLE_TERMS.find((role) => rightNormalized.includes(role));
    return Boolean(leftRole && rightRole && leftRole === rightRole);
  }

  collectProfessionMatchesFromText(text = '', professionCatalogEntries = [], limit = 5) {
    const normalizedText = String(text || '').trim();
    if (!normalizedText) {
      return [];
    }

    const catalogNames = professionCatalogEntries.map((entry) => entry.name);
    const inferred = inferProfessionFromText(normalizedText, catalogNames);
    const broaderInferred = inferProfessionFromText(normalizedText);
    const matchedNames = uniqueStrings([
      ...(professionCatalogService.findProfessionMatchesInTextSync(normalizedText, professionCatalogEntries, limit) || []).map((entry) => entry.name),
      inferred?.profession || '',
      ...(inferred?.similarProfessions || []),
      broaderInferred?.profession || '',
      ...(broaderInferred?.similarProfessions || [])
    ]);

    return matchedNames
      .map((candidate) => professionCatalogService.findBestProfessionMatchSync(candidate, professionCatalogEntries))
      .filter(Boolean)
      .slice(0, limit);
  }

  validateProfessionSuggestion(rawResult = {}, description = '', professionCatalogEntries = [], explicitCandidates = []) {
    const rawProfession = String(rawResult?.profession_name || rawResult?.suggestedProfession || rawResult?.profession || '').trim();
    const suggestedProfession = rawProfession && !/^unknown$/i.test(rawProfession)
      ? this.resolveExplicitProfessionCandidate(rawProfession, professionCatalogEntries)
      : '';
    const matchedText = String(rawResult?.matchedText || '').trim();
    const specializations = normalizeList(rawResult?.specializations || rawResult?.skills || []);
    const tags = normalizeList(rawResult?.tags || []);
    const aliases = normalizeList(rawResult?.aliases || rawResult?.localNames || []);
    const similarProfessions = normalizeList(rawResult?.similarProfessions || []);
    const baseConfidence = Number.isFinite(Number(rawResult?.confidence)) ? Number(rawResult.confidence) : 0;
    const explicitMatch = explicitCandidates.find((candidate) => this.shareSameRoleFamily(candidate, suggestedProfession));
    const strongContextMatch = suggestedProfession
      ? this.descriptionSupportsProfessionIntent(description, suggestedProfession, professionCatalogEntries.map((entry) => entry.name), professionCatalogEntries)
      : false;

    if (explicitCandidates.length > 0 && !explicitMatch) {
      return {
        profession: 'unknown',
        suggestedProfession: explicitCandidates[0],
        status: 'needs_confirmation',
        requiresConfirmation: true,
        confidence: Math.min(baseConfidence || 0.35, 0.45),
        matchedText: explicitCandidates[0],
        reason: 'The description explicitly names a different role than the detected profession.',
        specializations,
        tags,
        aliases,
        similarProfessions: uniqueStrings([explicitCandidates[0], ...similarProfessions])
      };
    }

    if (explicitMatch && explicitMatch !== suggestedProfession) {
      return {
        profession: explicitMatch,
        suggestedProfession: explicitMatch,
        status: 'confirmed',
        requiresConfirmation: false,
        confidence: Math.max(baseConfidence, 0.94),
        matchedText: matchedText || explicitMatch,
        reason: rawResult?.reason || 'Used the explicit role stated in the description.',
        specializations,
        tags,
        aliases,
        similarProfessions
      };
    }

    const isCatalogBacked = Boolean(
      suggestedProfession
      && professionCatalogService.findBestProfessionMatchSync(suggestedProfession, professionCatalogEntries, { minimumScore: 0.84 })
    );

    if (!suggestedProfession || ((!strongContextMatch && isCatalogBacked) || baseConfidence < 0.45)) {
      return {
        profession: 'unknown',
        suggestedProfession: suggestedProfession || explicitCandidates[0] || '',
        status: suggestedProfession || explicitCandidates[0] ? 'needs_confirmation' : 'unknown',
        requiresConfirmation: Boolean(suggestedProfession || explicitCandidates[0]),
        confidence: Math.min(baseConfidence || 0.32, 0.54),
        matchedText,
        reason: rawResult?.reason || 'The profession could not be matched strongly enough to the description.',
        specializations,
        tags,
        aliases,
        similarProfessions: uniqueStrings([suggestedProfession, ...similarProfessions])
      };
    }

    return {
      profession: suggestedProfession,
      suggestedProfession,
      status: 'confirmed',
      requiresConfirmation: false,
      confidence: Math.max(baseConfidence, explicitMatch ? 0.9 : 0.72),
      matchedText: matchedText || suggestedProfession,
      reason: rawResult?.reason || 'Matched the profession strongly to the description.',
      specializations,
      tags,
      aliases,
      similarProfessions
    };
  }

  async finalizeProfessionSuggestion(rawResult, description, professionCatalog = [], professionCatalogEntries = []) {
    const updatedCatalog = await professionCatalogService.getAllProfessions();
    const specializations = normalizeList(rawResult?.specializations || rawResult?.skills || []);
    const status = rawResult?.status || 'unknown';
    const requiresConfirmation = Boolean(rawResult?.requiresConfirmation);
    const suggestedProfession = String(rawResult?.profession_name || rawResult?.suggestedProfession || rawResult?.profession || '').trim();
    const catalogMatch = suggestedProfession
      ? professionCatalogService.findBestProfessionMatchSync(suggestedProfession, professionCatalogEntries)
      : null;

    if (status !== 'confirmed' || !suggestedProfession || /^unknown$/i.test(suggestedProfession)) {
      const fallbackSuggestions = uniqueStrings([
        suggestedProfession,
        ...(rawResult?.similarProfessions || [])
      ]).filter((item) => String(item || '').trim() && !/^unknown$/i.test(String(item || '').trim())).slice(0, 5);

      logger.info(`Profession detection requires confirmation or is unknown for description: ${description}`);
      return {
        profession: 'unknown',
        suggestedProfession: suggestedProfession || '',
        status: requiresConfirmation ? 'needs_confirmation' : 'unknown',
        requiresConfirmation,
        confidence: Number(rawResult?.confidence || 0),
        matchedText: rawResult?.matchedText || '',
        reason: rawResult?.reason || 'The profession could not be confirmed from the description.',
        aliases: normalizeList(rawResult?.aliases || []),
        specializations,
        tags: normalizeList(rawResult?.tags || []),
        similarProfessions: fallbackSuggestions,
        professions: updatedCatalog
      };
    }

    const ensuredProfession = catalogMatch
      ? await professionCatalogService.ensureProfession(suggestedProfession, {
          aliases: rawResult?.aliases || rawResult?.localNames || [],
          tags: [
            ...(rawResult?.tags || []),
            ...(rawResult?.specializations || rawResult?.skills || [])
          ],
          source: 'ai-detect'
        })
      : professionCatalogService.formatProfessionName(suggestedProfession);
    const catalogEntries = professionCatalogEntries.length > 0
      ? await professionCatalogService.getAllProfessionEntries()
      : await professionCatalogService.getAllProfessionEntries();
    const ensuredEntry = professionCatalogService.findBestProfessionMatchSync(ensuredProfession, catalogEntries) || {
      name: ensuredProfession,
      aliases: [],
      tags: []
    };
    const localAliasSuggestions = professionCatalogService.getLocalAliasSuggestions(ensuredEntry, 3);
    const similarProfessions = uniqueStrings([
      ...(rawResult?.similarProfessions || []),
      ...localAliasSuggestions,
      ...deriveRelatedProfessionTags(ensuredProfession, updatedCatalog)
    ])
      .filter((item) => this.normalizeSearchText(item) !== this.normalizeSearchText(ensuredProfession))
      .slice(0, 5);
    const tags = deriveProfileTags({
      profession: ensuredProfession,
      specializations,
      description,
      tags: [...(rawResult?.tags || []), ...(ensuredEntry.aliases || []), ...similarProfessions],
      professionCatalog: updatedCatalog
    });

    logger.info(`Profession detected: ${ensuredProfession}`);
    return {
      profession: ensuredProfession,
      suggestedProfession: ensuredProfession,
      status: 'confirmed',
      requiresConfirmation: false,
      confidence: Number(rawResult?.confidence || 0.8),
      matchedText: rawResult?.matchedText || ensuredProfession,
      reason: rawResult?.reason || 'Profession confirmed from the description.',
      aliases: uniqueStrings([
        ...(rawResult?.aliases || []),
        ...(ensuredEntry.aliases || [])
      ]),
      specializations,
      tags,
      similarProfessions,
      professions: updatedCatalog
    };
  }

  extractCustomProfessionFromDescription(description = '') {
    const text = String(description || '').trim();
    const patterns = [
      /\b(?:i am|i'm|i work as|my profession is|my job is)\s+(?:an?\s+)?([a-z/&+\s-]{3,40})/i,
      /\b(?:we are|we work as)\s+(?:an?\s+)?([a-z/&+\s-]{3,40})/i
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      const candidate = String(match?.[1] || '')
        .replace(/\b(in|at|for|with|who|and)\b.*$/i, '')
        .trim();

      if (candidate.length >= 3) {
        return professionCatalogService.formatProfessionName(candidate);
      }
    }

    return '';
  }

  keywordBasedProfessionDetection(description) {
    const explicitCandidates = this.extractExplicitProfessionCandidates(description);
    if (explicitCandidates.length > 0) {
      return {
        profession: explicitCandidates[0],
        aliases: [],
        confidence: 0.92,
        matchedText: explicitCandidates[0],
        reason: 'Matched the explicit role written in the description.',
        status: 'confirmed',
        specializations: [],
        tags: [],
        similarProfessions: []
      };
    }

    const inferred = inferProfessionFromText(description);
    if (inferred.profession && inferred.score >= 6) {
      return {
        profession: inferred.profession,
        aliases: [],
        confidence: Math.min(0.84, 0.52 + (inferred.score / 40)),
        matchedText: inferred.profession,
        reason: 'Mapped the described work to the closest standard profession.',
        status: 'confirmed',
        specializations: inferred.specializations || [],
        tags: inferred.specializations || [],
        similarProfessions: inferred.similarProfessions || []
      };
    }

    return {
      profession: 'unknown',
      aliases: [],
      confidence: 0.2,
      matchedText: '',
      reason: 'No explicit profession could be confirmed from the description.',
      status: 'unknown',
      specializations: [],
      tags: []
    };
  }

  keywordBasedSearch(problem) {
    const lowered = problem.toLowerCase();
    if (lowered.includes('deploy') || lowered.includes('website')) {
      return {
        professions: ['DevOps Engineer', 'Web Developer', 'Software Engineer'],
        skills: ['AWS', 'Deployment', 'Node.js', 'Angular']
      };
    }

    const detection = this.keywordBasedProfessionDetection(problem);
    return {
      professions: [detection.profession],
      skills: detection.specializations || detection.skills || []
    };
  }
}

module.exports = new ProfessionalService();
