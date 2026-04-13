const bcrypt = require('bcryptjs');
const User = require('../models/User');
const ProfessionalProfile = require('../models/ProfessionalProfile');
const Subscription = require('../models/Subscription');
const SiteVisit = require('../models/SiteVisit');
const professionCatalogService = require('./professionCatalogService');
const paymentService = require('./paymentService');
const logger = require('../utils/logger');
const { composeLocation, getProfileCompletionState, toVisibleEmail, toVisibleMobile } = require('../utils/accountPresenter');

const DEFAULT_ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || 'admin@karya.local').trim().toLowerCase();
const DEFAULT_ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || 'Admin@123');
const DEFAULT_ADMIN_FIRST_NAME = String(process.env.ADMIN_FIRST_NAME || 'Karya').trim() || 'Karya';
const DEFAULT_ADMIN_LAST_NAME = String(process.env.ADMIN_LAST_NAME || 'Admin').trim() || 'Admin';
const IST_OFFSET_MINUTES = 330;

const getFullName = (entity = {}) => [entity.firstName, entity.lastName].filter(Boolean).join(' ').trim();

const normalizeDateInput = (value) => String(value || '').trim();

const shiftDateByMinutes = (date, minutes) => new Date(date.getTime() + minutes * 60 * 1000);

const buildIstDayRangeFromDate = (date = new Date()) => {
  const shifted = shiftDateByMinutes(date, IST_OFFSET_MINUTES);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  const start = shiftDateByMinutes(new Date(Date.UTC(year, month, day, 0, 0, 0, 0)), -IST_OFFSET_MINUTES);
  const end = shiftDateByMinutes(new Date(Date.UTC(year, month, day, 23, 59, 59, 999)), -IST_OFFSET_MINUTES);

  return { start, end };
};

const buildCurrentIstMonthRange = (date = new Date()) => {
  const shifted = shiftDateByMinutes(date, IST_OFFSET_MINUTES);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const start = shiftDateByMinutes(new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)), -IST_OFFSET_MINUTES);
  const end = shiftDateByMinutes(new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999)), -IST_OFFSET_MINUTES);

  return { start, end };
};

const buildIstRangeFromDateStrings = (from, to) => {
  const fromValue = normalizeDateInput(from);
  const toValue = normalizeDateInput(to);
  const fromMatch = fromValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const toMatch = toValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!fromMatch || !toMatch) {
    return null;
  }

  const start = shiftDateByMinutes(
    new Date(Date.UTC(Number(fromMatch[1]), Number(fromMatch[2]) - 1, Number(fromMatch[3]), 0, 0, 0, 0)),
    -IST_OFFSET_MINUTES
  );
  const end = shiftDateByMinutes(
    new Date(Date.UTC(Number(toMatch[1]), Number(toMatch[2]) - 1, Number(toMatch[3]), 23, 59, 59, 999)),
    -IST_OFFSET_MINUTES
  );

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return null;
  }

  return { start, end };
};

class AdminService {
  async ensureDefaultAdminAccount() {
    const existingAdmin = await User.findOne({ email: DEFAULT_ADMIN_EMAIL });
    if (existingAdmin) {
      let changed = false;
      if (existingAdmin.role !== 'admin') {
        existingAdmin.role = 'admin';
        changed = true;
      }

      if (!existingAdmin.isVerified) {
        existingAdmin.isVerified = true;
        changed = true;
      }

      if (existingAdmin.isBanned) {
        existingAdmin.isBanned = false;
        changed = true;
      }

      if (existingAdmin.passwordSetupRequired) {
        existingAdmin.passwordSetupRequired = false;
        changed = true;
      }

      if (changed) {
        await existingAdmin.save();
        logger.info(`Existing user synchronized as admin: ${existingAdmin._id}`);
      }

      return {
        email: DEFAULT_ADMIN_EMAIL,
        password: DEFAULT_ADMIN_PASSWORD,
        created: false
      };
    }

    const password = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
    const admin = await User.create({
      firstName: DEFAULT_ADMIN_FIRST_NAME,
      lastName: DEFAULT_ADMIN_LAST_NAME,
      email: DEFAULT_ADMIN_EMAIL,
      password,
      role: 'admin',
      isVerified: true,
      passwordSetupRequired: false
    });

    logger.info(`Default admin account created: ${admin._id}`);
    return {
      email: DEFAULT_ADMIN_EMAIL,
      password: DEFAULT_ADMIN_PASSWORD,
      created: true
    };
  }

  async recordSiteVisit(payload = {}) {
    const visitorId = String(payload.visitorId || '').trim().slice(0, 100);
    const path = this.normalizeTrackedPath(payload.path);

    if (!visitorId || !path || path.startsWith('/admin')) {
      return null;
    }

    const pageType = this.normalizePageType(payload.pageType, path);

    return SiteVisit.create({
      visitorId,
      path,
      pageType,
      referrer: String(payload.referrer || '').trim().slice(0, 500),
      userAgent: String(payload.userAgent || '').trim().slice(0, 300),
      ipAddress: String(payload.ipAddress || '').trim().slice(0, 100)
    });
  }

  normalizeTrackedPath(value = '') {
    const clean = String(value || '')
      .trim()
      .split('#')[0]
      .split('?')[0]
      .replace(/\/{2,}/g, '/');

    if (!clean) {
      return '';
    }

    const normalized = clean.startsWith('/') ? clean : `/${clean}`;
    return normalized.slice(0, 220);
  }

  normalizePageType(value = '', path = '') {
    const explicit = String(value || '').trim().toLowerCase();
    if (explicit) {
      return explicit.slice(0, 80);
    }

    if (path === '/') {
      return 'home';
    }

    if (path.startsWith('/search')) {
      return 'search';
    }

    if (path.startsWith('/provider/transactions')) {
      return 'provider-transactions';
    }

    if (path.startsWith('/provider/dashboard')) {
      return 'provider-dashboard';
    }

    if (path.startsWith('/provider/') && path.split('/').filter(Boolean).length === 2) {
      return 'provider-profile';
    }

    if (path.startsWith('/messages')) {
      return 'messages';
    }

    if (['/about', '/contact', '/terms', '/privacy'].includes(path)) {
      return 'static';
    }

    if (path.startsWith('/auth') || path.startsWith('/profile')) {
      return 'account';
    }

    return 'other';
  }

  async getOverview({ from = '', to = '' } = {}) {
    const todayRange = buildIstDayRangeFromDate(new Date());
    const monthRange = buildCurrentIstMonthRange(new Date());
    const customRange = buildIstRangeFromDateStrings(from, to);
    const customRegistrationCounts = customRange
      ? await this.getRegistrationCounts(customRange)
      : { total: 0, users: 0, providers: 0 };

    const [
      totalAccounts,
      totalUsers,
      totalProviders,
      totalAdmins,
      verifiedAccounts,
      bannedAccounts,
      totalTransactions,
      activeTransactions,
      totalPageViews,
      totalVisitors,
      visitorsToday,
      visitorsThisMonth,
      pageViewsToday,
      totalProfileViews,
      todayRegistrations,
      monthRegistrations,
      listedProviders,
      topPages,
      topProfessions,
      topProviders,
      recentRegistrations,
      recentTransactions,
      professionsSummary
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ role: 'user' }),
      User.countDocuments({ role: 'professional' }),
      User.countDocuments({ role: 'admin' }),
      User.countDocuments({ isVerified: true }),
      User.countDocuments({ isBanned: true }),
      Subscription.countDocuments({}),
      Subscription.countDocuments({ status: 'active' }),
      SiteVisit.countDocuments({}),
      this.countUniqueVisitors({}),
      this.countUniqueVisitors({ createdAt: { $gte: todayRange.start, $lte: todayRange.end } }),
      this.countUniqueVisitors({ createdAt: { $gte: monthRange.start, $lte: monthRange.end } }),
      SiteVisit.countDocuments({ createdAt: { $gte: todayRange.start, $lte: todayRange.end } }),
      this.getTotalProfileViews(),
      this.getRegistrationCounts(todayRange),
      this.getRegistrationCounts(monthRange),
      this.getListedProvidersCount(),
      this.getTopPages(),
      this.getTopProfessions(),
      this.getTopProviders(),
      this.getRecentRegistrations(),
      this.getRecentTransactions(),
      this.getProfessionsSummary()
    ]);

    return {
      adminCredentials: {
        email: DEFAULT_ADMIN_EMAIL,
        password: DEFAULT_ADMIN_PASSWORD
      },
      totals: {
        totalAccounts,
        totalUsers,
        totalProviders,
        totalAdmins,
        verifiedAccounts,
        unverifiedAccounts: Math.max(totalAccounts - verifiedAccounts, 0),
        bannedAccounts,
        listedProviders,
        unlistedProviders: Math.max(totalProviders - listedProviders, 0),
        totalProfessions: professionsSummary.total,
        systemProfessions: professionsSummary.system,
        customProfessions: professionsSummary.custom,
        totalTransactions,
        activeTransactions,
        expiredTransactions: Math.max(totalTransactions - activeTransactions, 0),
        totalPageViews,
        totalVisitors,
        visitorsToday,
        visitorsThisMonth,
        pageViewsToday,
        totalProfileViews
      },
      registrations: {
        today: todayRegistrations,
        thisMonth: monthRegistrations,
        custom: {
          from: normalizeDateInput(from),
          to: normalizeDateInput(to),
          applied: Boolean(customRange),
          ...customRegistrationCounts
        }
      },
      insights: {
        topPages,
        topProfessions,
        topProviders,
        recentRegistrations,
        recentTransactions
      }
    };
  }

  async getUsers() {
    const todayRange = buildIstDayRangeFromDate(new Date());
    const monthRange = buildCurrentIstMonthRange(new Date());
    const [items, total, verified, banned, today, thisMonth] = await Promise.all([
      User.find({ role: 'user' }).sort({ createdAt: -1 }).lean(),
      User.countDocuments({ role: 'user' }),
      User.countDocuments({ role: 'user', isVerified: true }),
      User.countDocuments({ role: 'user', isBanned: true }),
      User.countDocuments({ role: 'user', createdAt: { $gte: todayRange.start, $lte: todayRange.end } }),
      User.countDocuments({ role: 'user', createdAt: { $gte: monthRange.start, $lte: monthRange.end } })
    ]);

    return {
      summary: {
        total,
        verified,
        unverified: Math.max(total - verified, 0),
        banned,
        today,
        thisMonth
      },
      items: items.map((user) => ({
        id: user._id.toString(),
        fullName: getFullName(user) || 'Unnamed User',
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        email: toVisibleEmail(user.email),
        mobile: toVisibleMobile(user.mobile),
        role: user.role,
        location: composeLocation(user),
        isVerified: Boolean(user.isVerified),
        isBanned: Boolean(user.isBanned),
        createdAt: user.createdAt
      }))
    };
  }

  async getProviders() {
    const profiles = await ProfessionalProfile.find({})
      .populate('user')
      .sort({ createdAt: -1 });

    const items = profiles
      .filter((profile) => profile.user)
      .map((profile) => {
        const user = profile.user;
        const completionState = getProfileCompletionState(user, profile);

        return {
          id: profile._id.toString(),
          userId: user._id.toString(),
          fullName: getFullName(user) || 'Unnamed Provider',
          firstName: user.firstName || '',
          lastName: user.lastName || '',
          email: toVisibleEmail(user.email),
          mobile: toVisibleMobile(user.mobile),
          profession: profile.profession || 'Profession pending',
          location: composeLocation(profile),
          serviceAreas: Array.isArray(profile.serviceAreas) ? profile.serviceAreas : [],
          experience: Number(profile.experience || 0),
          viewCount: Number(profile.viewCount || 0),
          baseCharge: Number(profile.charges?.baseCharge || 0),
          visitingCharge: Number(profile.charges?.visitingCharge || 0),
          isVerified: Boolean(user.isVerified),
          isBanned: Boolean(user.isBanned),
          isListed: completionState.isListed,
          createdAt: profile.createdAt || user.createdAt
        };
      });

    const total = items.length;
    const listed = items.filter((item) => item.isListed).length;

    return {
      summary: {
        total,
        listed,
        unlisted: Math.max(total - listed, 0),
        verified: items.filter((item) => item.isVerified).length,
        banned: items.filter((item) => item.isBanned).length,
        totalProfileViews: items.reduce((sum, item) => sum + item.viewCount, 0)
      },
      items
    };
  }

  async getTransactions() {
    const subscriptions = await Subscription.find({})
      .populate('user')
      .sort({ createdAt: -1 });

    const items = subscriptions
      .filter((subscription) => subscription.user)
      .map((subscription) => ({
        id: subscription._id.toString(),
        paymentId: subscription.paymentId,
        status: subscription.status,
        startDate: subscription.startDate,
        expiryDate: subscription.expiryDate,
        createdAt: subscription.createdAt,
        updatedAt: subscription.updatedAt,
        userId: subscription.user._id.toString(),
        fullName: getFullName(subscription.user) || 'Unnamed Provider',
        email: toVisibleEmail(subscription.user.email),
        mobile: toVisibleMobile(subscription.user.mobile),
        plan: paymentService.inferPlan(subscription)
      }));

    return {
      summary: {
        total: items.length,
        active: items.filter((item) => item.status === 'active').length,
        expired: items.filter((item) => item.status === 'expired').length,
        revenueEstimate: items.reduce((sum, item) => sum + Number(item.plan?.price || 0), 0)
      },
      items
    };
  }

  async getProfessions() {
    const [entries, usage] = await Promise.all([
      professionCatalogService.getAllProfessionEntries(),
      ProfessionalProfile.aggregate([
        {
          $match: {
            profession: { $nin: ['', null] }
          }
        },
        {
          $group: {
            _id: '$profession',
            providerCount: { $sum: 1 },
            totalViews: { $sum: { $ifNull: ['$viewCount', 0] } }
          }
        }
      ])
    ]);

    const usageMap = new Map(
      usage.map((item) => [String(item._id || ''), {
        providerCount: Number(item.providerCount || 0),
        totalViews: Number(item.totalViews || 0)
      }])
    );

    const items = entries.map((entry) => {
      const metrics = usageMap.get(entry.name) || { providerCount: 0, totalViews: 0 };
      return {
        name: entry.name,
        source: entry.source || 'system',
        aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
        tags: Array.isArray(entry.tags) ? entry.tags : [],
        providerCount: metrics.providerCount,
        totalViews: metrics.totalViews
      };
    }).sort((left, right) => {
      if (right.providerCount !== left.providerCount) {
        return right.providerCount - left.providerCount;
      }
      return left.name.localeCompare(right.name);
    });

    return {
      summary: await this.getProfessionsSummary(),
      items
    };
  }

  async countUniqueVisitors(match = {}) {
    const visitorIds = await SiteVisit.distinct('visitorId', match);
    return visitorIds.length;
  }

  async getRegistrationCounts(range) {
    const match = { createdAt: { $gte: range.start, $lte: range.end }, role: { $ne: 'admin' } };
    const [total, users, providers] = await Promise.all([
      User.countDocuments(match),
      User.countDocuments({ ...match, role: 'user' }),
      User.countDocuments({ ...match, role: 'professional' })
    ]);

    return { total, users, providers };
  }

  async getTotalProfileViews() {
    const [result] = await ProfessionalProfile.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: { $ifNull: ['$viewCount', 0] } }
        }
      }
    ]);

    return Number(result?.total || 0);
  }

  async getListedProvidersCount() {
    const profiles = await ProfessionalProfile.find({}).populate('user');
    return profiles.filter((profile) => profile.user && getProfileCompletionState(profile.user, profile).isListed).length;
  }

  async getTopPages(limit = 6) {
    const rows = await SiteVisit.aggregate([
      {
        $group: {
          _id: {
            path: '$path',
            pageType: '$pageType'
          },
          visits: { $sum: 1 },
          uniqueVisitors: { $addToSet: '$visitorId' }
        }
      },
      {
        $project: {
          _id: 0,
          path: '$_id.path',
          pageType: '$_id.pageType',
          visits: 1,
          uniqueVisitors: { $size: '$uniqueVisitors' }
        }
      },
      { $sort: { visits: -1, uniqueVisitors: -1, path: 1 } },
      { $limit: limit }
    ]);

    return rows.map((row) => ({
      path: row.path,
      pageType: row.pageType,
      visits: Number(row.visits || 0),
      uniqueVisitors: Number(row.uniqueVisitors || 0)
    }));
  }

  async getTopProfessions(limit = 6) {
    const rows = await ProfessionalProfile.aggregate([
      {
        $match: {
          profession: { $nin: ['', null] }
        }
      },
      {
        $group: {
          _id: '$profession',
          providerCount: { $sum: 1 },
          totalViews: { $sum: { $ifNull: ['$viewCount', 0] } }
        }
      },
      { $sort: { providerCount: -1, totalViews: -1, _id: 1 } },
      { $limit: limit }
    ]);

    return rows.map((row) => ({
      name: row._id,
      providerCount: Number(row.providerCount || 0),
      totalViews: Number(row.totalViews || 0)
    }));
  }

  async getTopProviders(limit = 6) {
    const profiles = await ProfessionalProfile.find({})
      .populate('user')
      .sort({ viewCount: -1, createdAt: -1 })
      .limit(limit);

    return profiles
      .filter((profile) => profile.user)
      .map((profile) => ({
        id: profile._id.toString(),
        fullName: getFullName(profile.user) || 'Unnamed Provider',
        profession: profile.profession || 'Profession pending',
        location: composeLocation(profile),
        viewCount: Number(profile.viewCount || 0),
        createdAt: profile.createdAt
      }));
  }

  async getRecentRegistrations(limit = 8) {
    const users = await User.find({ role: { $ne: 'admin' } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return users.map((user) => ({
      id: user._id.toString(),
      fullName: getFullName(user) || 'Unnamed Account',
      role: user.role,
      email: toVisibleEmail(user.email),
      mobile: toVisibleMobile(user.mobile),
      location: composeLocation(user),
      isVerified: Boolean(user.isVerified),
      createdAt: user.createdAt
    }));
  }

  async getRecentTransactions(limit = 8) {
    const subscriptions = await Subscription.find({})
      .populate('user')
      .sort({ createdAt: -1 })
      .limit(limit);

    return subscriptions
      .filter((subscription) => subscription.user)
      .map((subscription) => ({
        id: subscription._id.toString(),
        paymentId: subscription.paymentId,
        status: subscription.status,
        createdAt: subscription.createdAt,
        startDate: subscription.startDate,
        expiryDate: subscription.expiryDate,
        fullName: getFullName(subscription.user) || 'Unnamed Provider',
        plan: paymentService.inferPlan(subscription)
      }));
  }

  async getProfessionsSummary() {
    const entries = await professionCatalogService.getAllProfessionEntries();
    const items = entries.map((entry) => entry.source || 'system');

    return {
      total: entries.length,
      system: items.filter((item) => item === 'system').length,
      custom: items.filter((item) => item !== 'system').length
    };
  }
}

module.exports = new AdminService();
