const ProfessionalProfile = require('../models/ProfessionalProfile');
const Review = require('../models/Review');
const Bookmark = require('../models/Bookmark');
const mongoose = require('mongoose');
const OpenAI = require('openai');
const logger = require('../utils/logger');
const { buildProfessionalSummary } = require('../utils/professionalPresenter');

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const escapeRegExp = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const uniqueStrings = (values = []) => [...new Set(values.filter(Boolean).map((value) => value.trim()).filter(Boolean))];
const buildStructuredLocation = ({ town = '', area = '', city = '', state = '', location = '' }) => {
  const computed = [town || area, city, state]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(', ');

  return computed || String(location || '').trim();
};
const normalizeList = (value) => {
  if (Array.isArray(value)) {
    return uniqueStrings(value);
  }

  if (typeof value === 'string') {
    return uniqueStrings(value.split(','));
  }

  return [];
};
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
    const update = {
      ...profileData
    };

    if ('skills' in update) {
      update.skills = normalizeList(update.skills);
    }

    if ('serviceAreas' in update) {
      update.serviceAreas = normalizeList(update.serviceAreas);
    }

    if ('experience' in update) {
      update.experience = normalizeOptionalNumber(update.experience, 0);
    }

    if ('town' in update || 'area' in update || 'city' in update || 'state' in update || 'location' in update) {
      update.location = buildStructuredLocation(update);
    }

    if (update.charges) {
      update.charges = {
        baseCharge: Number(update.charges.baseCharge || 0),
        visitingCharge: Number(update.charges.visitingCharge || 0),
        nightCharge: Number(update.charges.nightCharge || 0),
        emergencyCharge: Number(update.charges.emergencyCharge || 0)
      };
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

    if (!openai) {
      return this.keywordBasedProfessionDetection(description);
    }

    const prompt = `Based on the description: "${description}", suggest a profession and categorized skills. Return in JSON format: { "profession": "string", "skills": ["skill1", "skill2"] }`;
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200
    });
    const result = JSON.parse(response.choices[0].message.content);
    logger.info(`Profession detected: ${result.profession}`);
    return result;
  }

  async searchProfessionals(filters, page, limit, viewerId = null) {
    const query = {};
    if (filters.profession) query.profession = filters.profession;
    if (filters.skills && filters.skills.length > 0) query.skills = { $in: filters.skills };
    if (filters.location) query.location = filters.location;
    if (filters.state) query.state = filters.state;
    if (filters.city) query.city = filters.city;
    if (filters.town) query.town = filters.town;
    if (filters.country) {
      if (filters.country === 'India') {
        query.$and = query.$and || [];
        query.$and.push({
          $or: [
            { country: 'India' },
            { country: '' },
            { country: { $exists: false } }
          ]
        });
      } else {
        query.country = filters.country;
      }
    }
    if (filters.query) {
      const regex = new RegExp(escapeRegExp(filters.query), 'i');
      query.$or = [
        { profession: regex },
        { skills: regex },
        { description: regex },
        { location: regex },
        { city: regex },
        { town: regex },
        { area: regex },
        { state: regex },
        { serviceAreas: regex }
      ];
    }
    const options = {
      page: Number(page) || 1,
      limit: Number(limit) || 10,
      populate: 'user',
      lean: false,
      sort: { createdAt: -1 }
    };
    const result = await ProfessionalProfile.paginate(query, options);
    logger.info(`Search performed with filters: ${JSON.stringify(filters)}`);

    const profileIds = result.docs.map((profile) => profile._id.toString());
    const reviewStats = await this.getReviewStatsMap(profileIds);
    const bookmarkedIds = await this.getBookmarkedProfileIds(viewerId, profileIds);

    return {
      ...result,
      docs: result.docs.map((profile) => buildProfessionalSummary({
        profile,
        reviewStats: reviewStats[profile._id.toString()] || {},
        bookmarkedIds
      }))
    };
  }

  async aiSearch(problem) {
    if (!problem || !problem.trim()) {
      throw new Error('Problem description is required');
    }

    if (!openai) {
      return this.keywordBasedSearch(problem);
    }

    const prompt = `User problem: "${problem}". Suggest relevant professions and skills. Return in JSON: { "professions": ["prof1"], "skills": ["skill1"] }`;
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200
    });
    const result = JSON.parse(response.choices[0].message.content);
    logger.info(`AI search for problem: ${problem}`);
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

  keywordBasedProfessionDetection(description) {
    const lowered = description.toLowerCase();
    if (lowered.includes('deploy') || lowered.includes('devops') || lowered.includes('server') || lowered.includes('cloud')) {
      return { profession: 'DevOps Engineer', skills: ['AWS', 'CI/CD', 'Docker', 'Kubernetes'] };
    }
    if (lowered.includes('website') || lowered.includes('app') || lowered.includes('software') || lowered.includes('coding')) {
      return { profession: 'Software Engineer', skills: ['JavaScript', 'Angular', 'Node.js', 'System Design'] };
    }
    if (lowered.includes('frontend') || lowered.includes('ui') || lowered.includes('landing page')) {
      return { profession: 'Web Developer', skills: ['HTML', 'CSS', 'Angular', 'Responsive Design'] };
    }
    if (lowered.includes('logo') || lowered.includes('design')) {
      return { profession: 'UI/UX Designer', skills: ['Branding', 'UI/UX', 'Graphic Design'] };
    }
    if (lowered.includes('pipe') || lowered.includes('leak')) {
      return { profession: 'Plumber', skills: ['Pipe repair', 'Home service', 'Maintenance'] };
    }
    if (lowered.includes('wiring') || lowered.includes('electrical')) {
      return { profession: 'Electrician', skills: ['Wiring', 'Installation', 'Repair'] };
    }

    return { profession: 'Consultant', skills: ['Consulting', 'Problem solving', 'Client communication'] };
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
      skills: detection.skills
    };
  }
}

module.exports = new ProfessionalService();
