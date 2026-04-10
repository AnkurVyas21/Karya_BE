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

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const escapeRegExp = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalizeOptionalNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

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
        source: 'provider-profile'
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
    if (!description || !description.trim()) {
      throw new Error('Description is required');
    }

    const professionCatalog = await professionCatalogService.getAllProfessions();

    if (!openai) {
      return this.finalizeProfessionSuggestion(
        this.keywordBasedProfessionDetection(description, professionCatalog),
        description,
        professionCatalog
      );
    }

    const prompt = [
      'You analyze a local-service provider profile description.',
      'Find the best profession title for what this provider actually does.',
      `Prefer one from this existing catalog when it fits: ${professionCatalog.join(', ')}`,
      'If none fits well, create a concise new profession title in 2 to 4 words.',
      'Return JSON only with this shape:',
      '{"profession":"","specializations":[""],"tags":[""],"similarProfessions":[""]}',
      `Description: ${JSON.stringify(description)}`
    ].join('\n');
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 250
    });
    const rawContent = String(response.choices?.[0]?.message?.content || '{}').trim();
    const jsonText = rawContent.startsWith('{')
      ? rawContent
      : rawContent.match(/\{[\s\S]*\}/)?.[0] || '{}';
    const result = JSON.parse(jsonText);
    return this.finalizeProfessionSuggestion(result, description, professionCatalog);
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

    const candidateQuery = this.buildSearchCandidateQuery(normalizedFilters);
    const candidates = await ProfessionalProfile.find(candidateQuery)
      .populate('user')
      .sort({ createdAt: -1 });

    const scoredProfiles = candidates
      .filter((profile) => isProfessionalProfileListable(profile))
      .map((profile) => ({
        profile,
        ranking: this.scoreProfessionalProfile(profile, normalizedFilters)
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

    logger.info(`Search performed with filters: ${JSON.stringify(normalizedFilters)}`);

    const profileIds = pagedProfiles.map((profile) => profile._id.toString());
    const reviewStats = await this.getReviewStatsMap(profileIds);
    const bookmarkedIds = await this.getBookmarkedProfileIds(viewerId, profileIds);

    return {
      docs: pagedProfiles.map((profile) => buildProfessionalSummary({
        profile,
        reviewStats: reviewStats[profile._id.toString()] || {},
        bookmarkedIds
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

    const result = await aiSearchService.inferSearch(options);
    logger.info(`AI search for problem: ${options.problem} using ${result.providerUsed}`);
    return result;
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
          bookmarkedIds
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

    return buildProfessionalSummary({
      profile,
      reviewStats: reviewStats[profileId] || {},
      bookmarkedIds
    });
  }

  buildSearchCandidateQuery(filters = {}) {
    const query = {};
    const orConditions = [];
    const pushRegexConditions = (fields, value) => {
      const term = String(value || '').trim();
      if (!term) {
        return;
      }

      const regex = new RegExp(escapeRegExp(term), 'i');
      fields.forEach((field) => {
        orConditions.push({ [field]: regex });
      });
    };

    if (filters.country) {
      if (filters.country.toLowerCase() === 'india') {
        query.$and = query.$and || [];
        query.$and.push({
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

    pushRegexConditions(['profession', 'skills', 'tags'], filters.profession);
    pushRegexConditions(['location', 'city', 'town', 'area', 'state', 'serviceAreas'], filters.location);
    pushRegexConditions(['state', 'location', 'serviceAreas'], filters.state);
    pushRegexConditions(['city', 'location', 'serviceAreas'], filters.city);
    pushRegexConditions(['town', 'area', 'location', 'serviceAreas'], filters.town);
    (filters.skills || []).forEach((skill) => pushRegexConditions(['skills', 'tags', 'profession', 'description'], skill));
    pushRegexConditions(['profession', 'skills', 'tags', 'description', 'location', 'city', 'town', 'area', 'state', 'serviceAreas'], filters.query);

    if (orConditions.length > 0) {
      query.$or = orConditions;
    }

    return query;
  }

  scoreProfessionalProfile(profile, filters = {}) {
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

    markSignal('profession', this.matchWeightedText(profileData.profession, filters.profession) > 0, this.matchWeightedText(profileData.profession, filters.profession));
    markSignal('location', this.matchWeightedText(combinedLocation, filters.location) > 0, this.matchWeightedText(combinedLocation, filters.location));
    markSignal('state', this.matchWeightedText(`${profileData.state} ${combinedLocation}`, filters.state) > 0, this.matchWeightedText(`${profileData.state} ${combinedLocation}`, filters.state));
    markSignal('city', this.matchWeightedText(`${profileData.city} ${combinedLocation}`, filters.city) > 0, this.matchWeightedText(`${profileData.city} ${combinedLocation}`, filters.city));
    markSignal('town', this.matchWeightedText(`${profileData.town} ${profileData.area} ${combinedLocation}`, filters.town) > 0, this.matchWeightedText(`${profileData.town} ${profileData.area} ${combinedLocation}`, filters.town));

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

  async finalizeProfessionSuggestion(rawResult, description, professionCatalog = []) {
    const suggestedProfession = rawResult?.profession || this.extractCustomProfessionFromDescription(description) || 'Consultant';
    const ensuredProfession = await professionCatalogService.ensureProfession(suggestedProfession, {
      aliases: rawResult?.similarProfessions || [],
      source: 'ai-detect'
    });
    const updatedCatalog = await professionCatalogService.getAllProfessions();
    const specializations = normalizeList(rawResult?.specializations || rawResult?.skills || []);
    const similarProfessions = uniqueStrings([
      ...(rawResult?.similarProfessions || []),
      ...deriveRelatedProfessionTags(ensuredProfession, updatedCatalog)
    ])
      .filter((item) => this.normalizeSearchText(item) !== this.normalizeSearchText(ensuredProfession))
      .slice(0, 5);
    const tags = deriveProfileTags({
      profession: ensuredProfession,
      specializations,
      description,
      tags: [...(rawResult?.tags || []), ...similarProfessions],
      professionCatalog: updatedCatalog
    });

    logger.info(`Profession detected: ${ensuredProfession}`);
    return {
      profession: ensuredProfession,
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
      /\b(?:we are|we work as)\s+(?:an?\s+)?([a-z/&+\s-]{3,40})/i,
      /\b(?:looking for|need)\s+(?:an?\s+)?([a-z/&+\s-]{3,40})/i
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
    const lowered = description.toLowerCase();
    if (lowered.includes('deploy') || lowered.includes('devops') || lowered.includes('server') || lowered.includes('cloud')) {
      return { profession: 'DevOps Engineer', specializations: ['AWS', 'CI/CD', 'Docker', 'Kubernetes'] };
    }
    if (lowered.includes('website') || lowered.includes('app') || lowered.includes('software') || lowered.includes('coding')) {
      return { profession: 'Software Engineer', specializations: ['JavaScript', 'Angular', 'Node.js', 'System Design'] };
    }
    if (lowered.includes('frontend') || lowered.includes('ui') || lowered.includes('landing page')) {
      return { profession: 'Web Developer', specializations: ['HTML', 'CSS', 'Angular', 'Responsive Design'] };
    }
    if (lowered.includes('logo') || lowered.includes('design')) {
      return { profession: 'UI/UX Designer', specializations: ['Branding', 'UI/UX', 'Graphic Design'] };
    }
    if (lowered.includes('pipe') || lowered.includes('leak')) {
      return { profession: 'Plumber', specializations: ['Pipe repair', 'Home service', 'Maintenance'] };
    }
    if (lowered.includes('wiring') || lowered.includes('electrical')) {
      return { profession: 'Electrician', specializations: ['Wiring', 'Installation', 'Repair'] };
    }

    return {
      profession: this.extractCustomProfessionFromDescription(description) || 'Consultant',
      specializations: ['Customer service', 'Problem solving', 'Professional support']
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
