const QRCode = require('qrcode');
const ProviderGrowth = require('../models/ProviderGrowth');
const ProviderWebsite = require('../models/ProviderWebsite');
const ProviderServiceModel = require('../models/ProviderService');
const ProviderProduct = require('../models/ProviderProduct');
const ProviderArticle = require('../models/ProviderArticle');
const ProviderOffer = require('../models/ProviderOffer');
const ProviderLead = require('../models/ProviderLead');
const ProviderBooking = require('../models/ProviderBooking');
const ProviderThemeConfig = require('../models/ProviderThemeConfig');
const ProviderSEOConfig = require('../models/ProviderSEOConfig');
const ProfessionalProfile = require('../models/ProfessionalProfile');
const Review = require('../models/Review');
const User = require('../models/User');
const logger = require('../utils/logger');
const providerGrowthService = require('./providerGrowthService');

const DEFAULT_BUSINESS_HOURS = [
  { day: 'Monday', isOpen: true, openTime: '09:00', closeTime: '18:00' },
  { day: 'Tuesday', isOpen: true, openTime: '09:00', closeTime: '18:00' },
  { day: 'Wednesday', isOpen: true, openTime: '09:00', closeTime: '18:00' },
  { day: 'Thursday', isOpen: true, openTime: '09:00', closeTime: '18:00' },
  { day: 'Friday', isOpen: true, openTime: '09:00', closeTime: '18:00' },
  { day: 'Saturday', isOpen: true, openTime: '10:00', closeTime: '16:00' },
  { day: 'Sunday', isOpen: false, openTime: '', closeTime: '' }
];

const DEFAULT_BOOKING_SLOTS = [
  { label: 'Morning', startTime: '09:00', endTime: '12:00', isActive: true },
  { label: 'Afternoon', startTime: '12:00', endTime: '16:00', isActive: true },
  { label: 'Evening', startTime: '16:00', endTime: '19:00', isActive: true }
];

const cleanString = (value) => String(value || '').trim();
const cleanArray = (value) => Array.isArray(value)
  ? value.map((item) => cleanString(item)).filter(Boolean)
  : cleanString(value)
    ? cleanString(value).split(',').map((item) => cleanString(item)).filter(Boolean)
    : [];
const cleanBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  return ['true', '1', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};
const cleanNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const slugify = (value = '') => cleanString(value)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 60);
const isValidIndianPhone = (value = '') => /^[6-9]\d{9}$/.test(String(value || '').replace(/[^\d]/g, '').slice(-10));
const isValidUpi = (value = '') => !cleanString(value) || /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(cleanString(value));
const normalizeGallery = (value) => cleanArray(value).slice(0, 20);
const normalizeVideos = (value) => cleanArray(value).slice(0, 8);

class ProviderWebsiteService {
  async getManager(userId) {
    const website = await this.getOrCreateWebsite(userId);
    return this.buildManagerResponse(userId, website);
  }

  async saveManager(userId, rawPayload = {}, files = {}) {
    const payload = this.parsePayload(rawPayload);
    const [state, website] = await Promise.all([
      providerGrowthService.getOrCreateState(userId),
      this.getOrCreateWebsite(userId)
    ]);
    const requestedSlug = slugify(payload.slug || website.slug || website.businessName);
    const finalSlug = requestedSlug || (state.websiteSlug ? cleanString(state.websiteSlug) : '');

    if (payload.phone && !isValidIndianPhone(payload.phone)) {
      throw new Error('Enter a valid 10-digit business phone number');
    }
    if (payload.whatsappNumber && !isValidIndianPhone(payload.whatsappNumber)) {
      throw new Error('Enter a valid 10-digit WhatsApp number');
    }
    if (payload.upiId && !isValidUpi(payload.upiId)) {
      throw new Error('Enter a valid UPI ID');
    }

    const purchased = providerGrowthService.hasActiveWebsite(state);
    if (finalSlug) {
      await this.ensureSlugAvailable(finalSlug, userId, website._id);
      await this.syncWebsiteSlug(userId, website, state, finalSlug);
    }

    const heroImage = Array.isArray(files.heroImage) && files.heroImage[0]?.path ? files.heroImage[0].path : website.heroImage;
    const logo = Array.isArray(files.logoImage) && files.logoImage[0]?.path ? files.logoImage[0].path : website.logo;
    const uploadedGallery = Array.isArray(files.galleryImages) ? files.galleryImages.map((item) => item.path).filter(Boolean) : [];
    const uploadedVideos = Array.isArray(files.galleryVideos) ? files.galleryVideos.map((item) => item.path).filter(Boolean) : [];

    const businessHours = this.normalizeBusinessHours(payload.businessHours || website.businessHours);
    const bookingSlots = this.normalizeBookingSlots(payload.bookingSlots || website.bookingSlots);
    const faqs = this.normalizeFaqs(payload.faqs || website.faqs);
    const testimonials = this.normalizeTestimonials(payload.testimonials || website.testimonials);

    const requestedStatus = ['draft', 'published', 'unpublished'].includes(payload.status) ? payload.status : website.status;
    if (requestedStatus === 'published' && !purchased) {
      throw new Error('Purchase the website feature before publishing your business page');
    }

    website.isPurchased = purchased;
    website.status = requestedStatus;
    website.slug = finalSlug || website.slug;
    website.businessName = cleanString(payload.businessName) || website.businessName;
    website.tagline = cleanString(payload.tagline);
    website.category = cleanString(payload.category);
    website.subcategories = cleanArray(payload.subcategories);
    website.tags = cleanArray(payload.tags);
    website.about = cleanString(payload.about);
    website.yearsOfExperience = cleanNumber(payload.yearsOfExperience, website.yearsOfExperience);
    website.languages = cleanArray(payload.languages);
    website.phone = cleanString(payload.phone);
    website.whatsappNumber = cleanString(payload.whatsappNumber);
    website.email = cleanString(payload.email);
    website.address = cleanString(payload.address);
    website.city = cleanString(payload.city);
    website.state = cleanString(payload.state);
    website.pincode = cleanString(payload.pincode);
    website.serviceAreas = cleanArray(payload.serviceAreas);
    website.geo = {
      lat: payload.geo?.lat ?? website.geo?.lat ?? null,
      lng: payload.geo?.lng ?? website.geo?.lng ?? null
    };
    website.businessHours = businessHours;
    website.heroImage = heroImage || '';
    website.logo = logo || '';
    website.gallery = [...normalizeGallery(payload.gallery), ...uploadedGallery].slice(0, 20);
    website.videos = [...normalizeVideos(payload.videos), ...uploadedVideos].slice(0, 8);
    website.servicesEnabled = cleanBoolean(payload.servicesEnabled, true);
    website.productsEnabled = cleanBoolean(payload.productsEnabled, false);
    website.bookingEnabled = cleanBoolean(payload.bookingEnabled, false);
    website.paymentsEnabled = cleanBoolean(payload.paymentsEnabled, false);
    website.offersEnabled = cleanBoolean(payload.offersEnabled, false);
    website.articlesEnabled = cleanBoolean(payload.articlesEnabled, false);
    website.reviewsEnabled = cleanBoolean(payload.reviewsEnabled, true);
    website.inquiryFormEnabled = cleanBoolean(payload.inquiryFormEnabled, true);
    website.callbackEnabled = cleanBoolean(payload.callbackEnabled, true);
    website.callEnabled = cleanBoolean(payload.callEnabled, true);
    website.whatsappEnabled = cleanBoolean(payload.whatsappEnabled, true);
    website.showPricing = cleanBoolean(payload.showPricing, true);
    website.showMap = cleanBoolean(payload.showMap, false);
    website.showVerification = cleanBoolean(payload.showVerification, true);
    website.emergencyAvailability = cleanBoolean(payload.emergencyAvailability, false);
    website.requestCallbackMessage = cleanString(payload.requestCallbackMessage);
    website.bookingIntro = cleanString(payload.bookingIntro);
    website.bookingWorkingDays = cleanArray(payload.bookingWorkingDays);
    website.bookingSlots = bookingSlots;
    website.bookingBufferMinutes = cleanNumber(payload.bookingBufferMinutes, 0);
    website.bookingLeadNoticeHours = cleanNumber(payload.bookingLeadNoticeHours, 0);
    website.upiId = cleanString(payload.upiId);
    website.advanceBookingFeeEnabled = cleanBoolean(payload.advanceBookingFeeEnabled, false);
    website.bookingFeeAmount = cleanNumber(payload.bookingFeeAmount, 0);
    website.paymentInstructions = cleanString(payload.paymentInstructions);
    website.faqs = faqs;
    website.testimonials = testimonials;
    website.featuredServiceTitle = cleanString(payload.featuredServiceTitle);
    website.shareMessage = cleanString(payload.shareMessage);
    website.completionScore = 0;

    const services = this.normalizeServices(payload.services);
    const products = this.normalizeProducts(payload.products);
    const offers = this.normalizeOffers(payload.offers);
    const articles = this.normalizeArticles(payload.articles);

    const reviewSummary = await this.getReviewSummary(userId);
    const completion = this.computeCompletion({ website, services });
    website.completionScore = completion.score;
    if (website.status === 'published') {
      website.publishedAt = website.publishedAt || new Date();
    }

    await website.save();
    await this.upsertThemeConfig(userId, website._id, payload.themeConfig || {});
    await this.upsertSeoConfig(userId, website._id, payload.seoConfig || {}, website.slug);
    await this.replaceCollection(ProviderServiceModel, website, userId, services);
    await this.replaceCollection(ProviderProduct, website, userId, products);
    await this.replaceCollection(ProviderOffer, website, userId, offers);
    await this.replaceArticles(website, userId, articles);

    logger.info(`Business website manager saved for provider ${userId}`);
    return this.buildManagerResponse(userId, website, { completion, reviewSummary });
  }

  async updatePublishStatus(userId, payload = {}) {
    const [state, website] = await Promise.all([
      providerGrowthService.getOrCreateState(userId),
      this.getOrCreateWebsite(userId)
    ]);
    const nextStatus = cleanBoolean(payload.published, false) ? 'published' : 'unpublished';

    if (nextStatus === 'published' && !providerGrowthService.hasActiveWebsite(state)) {
      throw new Error('Purchase the website feature before publishing your business page');
    }

    if (nextStatus === 'published' && !website.slug) {
      const fallbackSlug = slugify(website.businessName) || `business-${String(userId).slice(-6)}`;
      await this.ensureSlugAvailable(fallbackSlug, userId, website._id);
      await this.syncWebsiteSlug(userId, website, state, fallbackSlug);
      website.slug = fallbackSlug;
    }

    website.isPurchased = providerGrowthService.hasActiveWebsite(state);
    website.status = nextStatus;
    website.publishedAt = nextStatus === 'published' ? new Date() : website.publishedAt;
    await website.save();
    return this.buildManagerResponse(userId, website);
  }

  async getPublicWebsiteBySlug(slug, viewerId = null) {
    const cleanSlug = slugify(slug);
    if (!cleanSlug) {
      return null;
    }

    const [website, state] = await Promise.all([
      ProviderWebsite.findOne({ slug: cleanSlug }).lean(),
      ProviderGrowth.findOne({ websiteSlug: cleanSlug })
    ]);

    if (!website || !state) {
      return null;
    }

    const normalizedState = await providerGrowthService.normalizeState(state);
    if (website.status !== 'published' || !providerGrowthService.hasActiveWebsite(normalizedState)) {
      return null;
    }

    const data = await this.buildPublicResponse(website.providerId.toString(), website);
    if (!data) {
      return null;
    }

    await ProfessionalProfile.findOneAndUpdate({ user: website.providerId }, { $inc: { viewCount: 1 } });
    return data;
  }

  async createInquiry(slug, payload = {}) {
    const publicWebsite = await this.getPublicWebsiteBySlug(slug);
    if (!publicWebsite) {
      throw new Error('Business page not found');
    }

    const source = ['website', 'callback', 'inquiry', 'whatsapp-click', 'call-click', 'share'].includes(cleanString(payload.source))
      ? cleanString(payload.source)
      : 'website';

    if (!['whatsapp-click', 'call-click', 'share'].includes(source)) {
      if (!cleanString(payload.name)) {
        throw new Error('Name is required');
      }
      if (!isValidIndianPhone(payload.phone)) {
        throw new Error('Enter a valid 10-digit mobile number');
      }
    }

    const website = await ProviderWebsite.findOne({ slug: slugify(slug) });
    const lead = await ProviderLead.create({
      providerId: website.providerId,
      websiteId: website._id,
      source,
      name: cleanString(payload.name),
      phone: cleanString(payload.phone),
      email: cleanString(payload.email),
      message: cleanString(payload.message),
      interestedService: cleanString(payload.interestedService),
      status: 'new',
      notes: ''
    });

    return {
      id: lead._id.toString(),
      source: lead.source,
      status: lead.status,
      createdAt: lead.createdAt
    };
  }

  async createBooking(slug, payload = {}) {
    const publicWebsite = await this.getPublicWebsiteBySlug(slug);
    if (!publicWebsite) {
      throw new Error('Business page not found');
    }
    if (!publicWebsite.website?.bookingEnabled) {
      throw new Error('Booking is disabled for this business page');
    }
    if (!cleanString(payload.customerName)) {
      throw new Error('Customer name is required');
    }
    if (!isValidIndianPhone(payload.customerPhone)) {
      throw new Error('Enter a valid 10-digit mobile number');
    }

    const website = await ProviderWebsite.findOne({ slug: slugify(slug) });
    const booking = await ProviderBooking.create({
      providerId: website.providerId,
      websiteId: website._id,
      customerName: cleanString(payload.customerName),
      customerPhone: cleanString(payload.customerPhone),
      serviceId: payload.serviceId || null,
      bookingDate: cleanString(payload.bookingDate),
      bookingTime: cleanString(payload.bookingTime),
      message: cleanString(payload.message),
      advanceFeeRequired: Boolean(publicWebsite.website.advanceFeeRequired),
      advanceFeeAmount: Number(publicWebsite.website.advanceFeeAmount || 0),
      paymentStatus: 'pending',
      status: 'new'
    });

    return {
      id: booking._id.toString(),
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      createdAt: booking.createdAt
    };
  }

  async getOrCreateWebsite(userId) {
    const [user, profile, state] = await Promise.all([
      User.findById(userId).lean(),
      ProfessionalProfile.findOne({ user: userId }).lean(),
      providerGrowthService.getOrCreateState(userId)
    ]);

    let website = await ProviderWebsite.findOne({ providerId: userId });
    if (!website) {
      const defaultName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || profile?.profession || 'My Business';
      website = await ProviderWebsite.create({
        providerId: userId,
        isPurchased: providerGrowthService.hasActiveWebsite(state),
        status: 'draft',
        slug: cleanString(state.websiteSlug),
        businessName: defaultName,
        tagline: profile?.profession || '',
        category: profile?.profession || '',
        tags: Array.isArray(profile?.tags) ? profile.tags : [],
        about: cleanString(profile?.description),
        yearsOfExperience: cleanNumber(profile?.experience, 0),
        phone: cleanString(user?.mobile),
        email: cleanString(user?.email),
        address: cleanString(profile?.addressLine),
        city: cleanString(profile?.city),
        state: cleanString(profile?.state),
        pincode: cleanString(profile?.pincode),
        serviceAreas: Array.isArray(profile?.serviceAreas) ? profile.serviceAreas : [],
        businessHours: DEFAULT_BUSINESS_HOURS,
        gallery: [],
        videos: [],
        servicesEnabled: true,
        productsEnabled: false,
        bookingEnabled: false,
        paymentsEnabled: false,
        offersEnabled: false,
        articlesEnabled: false,
        reviewsEnabled: true,
        inquiryFormEnabled: true,
        callbackEnabled: true,
        callEnabled: true,
        whatsappEnabled: true,
        showPricing: true,
        showMap: false,
        showVerification: true,
        bookingWorkingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        bookingSlots: DEFAULT_BOOKING_SLOTS
      });
    }

    website.isPurchased = providerGrowthService.hasActiveWebsite(state);
    if (!website.slug && state.websiteSlug) {
      website.slug = cleanString(state.websiteSlug);
      await website.save();
    }

    await ProviderThemeConfig.findOneAndUpdate(
      { providerId: userId },
      { $setOnInsert: { providerId: userId, websiteId: website._id } },
      { upsert: true, new: true }
    );
    await ProviderSEOConfig.findOneAndUpdate(
      { providerId: userId },
      { $setOnInsert: { providerId: userId, websiteId: website._id } },
      { upsert: true, new: true }
    );

    return website;
  }

  parsePayload(rawPayload = {}) {
    if (typeof rawPayload?.payload === 'string') {
      try {
        return JSON.parse(rawPayload.payload);
      } catch (error) {
        throw new Error('Invalid website manager payload');
      }
    }
    return rawPayload || {};
  }

  normalizeBusinessHours(hours = []) {
    const source = Array.isArray(hours) && hours.length > 0 ? hours : DEFAULT_BUSINESS_HOURS;
    return source.map((item, index) => ({
      day: cleanString(item.day) || DEFAULT_BUSINESS_HOURS[index]?.day || '',
      isOpen: cleanBoolean(item.isOpen, true),
      openTime: cleanString(item.openTime),
      closeTime: cleanString(item.closeTime)
    })).slice(0, 7);
  }

  normalizeBookingSlots(slots = []) {
    const source = Array.isArray(slots) && slots.length > 0 ? slots : DEFAULT_BOOKING_SLOTS;
    return source
      .map((item) => ({
        label: cleanString(item.label),
        startTime: cleanString(item.startTime),
        endTime: cleanString(item.endTime),
        isActive: cleanBoolean(item.isActive, true)
      }))
      .filter((item) => item.label || item.startTime || item.endTime)
      .slice(0, 12);
  }

  normalizeFaqs(faqs = []) {
    return (Array.isArray(faqs) ? faqs : [])
      .map((item, index) => ({
        question: cleanString(item.question),
        answer: cleanString(item.answer),
        sortOrder: cleanNumber(item.sortOrder, index)
      }))
      .filter((item) => item.question && item.answer)
      .slice(0, 20);
  }

  normalizeTestimonials(items = []) {
    return (Array.isArray(items) ? items : [])
      .map((item) => ({
        authorName: cleanString(item.authorName),
        authorRole: cleanString(item.authorRole),
        rating: Math.min(Math.max(cleanNumber(item.rating, 5), 1), 5),
        quote: cleanString(item.quote),
        isPinned: cleanBoolean(item.isPinned, false)
      }))
      .filter((item) => item.authorName && item.quote)
      .slice(0, 12);
  }

  normalizeServices(items = []) {
    return (Array.isArray(items) ? items : [])
      .map((item, index) => ({
        title: cleanString(item.title),
        shortDescription: cleanString(item.shortDescription),
        fullDescription: cleanString(item.fullDescription),
        category: cleanString(item.category),
        priceType: ['fixed', 'starting', 'custom', 'on-request'].includes(cleanString(item.priceType)) ? cleanString(item.priceType) : 'on-request',
        price: cleanNumber(item.price, 0),
        unit: cleanString(item.unit),
        image: cleanString(item.image),
        isFeatured: cleanBoolean(item.isFeatured, false),
        isActive: cleanBoolean(item.isActive, true),
        sortOrder: cleanNumber(item.sortOrder, index)
      }))
      .filter((item) => item.title);
  }

  normalizeProducts(items = []) {
    return (Array.isArray(items) ? items : [])
      .map((item) => ({
        title: cleanString(item.title),
        description: cleanString(item.description),
        price: cleanNumber(item.price, 0),
        discountedPrice: cleanNumber(item.discountedPrice, 0),
        image: cleanString(item.image),
        gallery: normalizeGallery(item.gallery),
        stockStatus: ['in-stock', 'low-stock', 'out-of-stock', 'made-to-order'].includes(cleanString(item.stockStatus)) ? cleanString(item.stockStatus) : 'in-stock',
        isActive: cleanBoolean(item.isActive, true),
        category: cleanString(item.category)
      }))
      .filter((item) => item.title);
  }

  normalizeOffers(items = []) {
    return (Array.isArray(items) ? items : [])
      .map((item) => ({
        title: cleanString(item.title),
        description: cleanString(item.description),
        bannerImage: cleanString(item.bannerImage),
        badgeText: cleanString(item.badgeText),
        discountText: cleanString(item.discountText),
        startDate: item.startDate || null,
        endDate: item.endDate || null,
        isActive: cleanBoolean(item.isActive, true),
        placement: ['hero', 'offers', 'both'].includes(cleanString(item.placement)) ? cleanString(item.placement) : 'hero',
        preset: cleanString(item.preset)
      }))
      .filter((item) => item.title);
  }

  normalizeArticles(items = []) {
    const seen = new Set();
    return (Array.isArray(items) ? items : [])
      .map((item) => {
        const baseSlug = slugify(item.slug || item.title);
        let candidate = baseSlug || `article-${seen.size + 1}`;
        let suffix = 2;
        while (seen.has(candidate)) {
          candidate = `${baseSlug}-${suffix}`;
          suffix += 1;
        }
        seen.add(candidate);
        return {
          title: cleanString(item.title),
          slug: candidate,
          summary: cleanString(item.summary),
          content: cleanString(item.content),
          coverImage: cleanString(item.coverImage),
          status: cleanString(item.status) === 'published' ? 'published' : 'draft',
          publishedAt: cleanString(item.status) === 'published' ? new Date() : null
        };
      })
      .filter((item) => item.title);
  }

  computeCompletion({ website, services = [] }) {
    let score = 0;
    const checklist = [];

    const hasBusinessInfo = Boolean(website.businessName && website.about && website.category);
    checklist.push({ id: 'business-info', label: 'Business info added', completed: hasBusinessInfo });
    if (hasBusinessInfo) score += 25;

    const hasContactInfo = Boolean(isValidIndianPhone(website.phone) && (website.whatsappNumber || website.email));
    checklist.push({ id: 'contact-info', label: 'Contact details completed', completed: hasContactInfo });
    if (hasContactInfo) score += 20;

    const hasEnoughServices = services.filter((item) => item.isActive !== false).length >= 2;
    checklist.push({ id: 'services', label: 'Added at least 2 services', completed: hasEnoughServices });
    if (hasEnoughServices) score += 20;

    const hasGallery = (website.gallery || []).length >= 3;
    checklist.push({ id: 'gallery', label: 'Uploaded at least 3 gallery photos', completed: hasGallery });
    if (hasGallery) score += 15;

    const hasHours = (website.businessHours || []).some((item) => item.isOpen && item.openTime && item.closeTime);
    checklist.push({ id: 'hours', label: 'Business hours configured', completed: hasHours });
    if (hasHours) score += 10;

    const hasCtas = website.callEnabled || website.whatsappEnabled || website.inquiryFormEnabled;
    checklist.push({ id: 'cta', label: 'Lead CTA enabled', completed: hasCtas });
    if (hasCtas) score += 10;

    return {
      score,
      checklist,
      suggestions: checklist.filter((item) => !item.completed).map((item) => this.toSuggestion(item.id))
    };
  }

  toSuggestion(id) {
    const suggestions = {
      'business-info': 'Add your about section and category to help customers trust your page.',
      'contact-info': 'Complete your business phone, WhatsApp, or email so customers can reach you.',
      services: 'Add at least 2 services so customers know what you offer.',
      gallery: 'Upload 3 photos to improve trust and conversion.',
      hours: 'Set your business hours to reduce missed leads.',
      cta: 'Enable call, WhatsApp, or inquiry form to capture leads.'
    };
    return suggestions[id] || 'Complete more setup details to improve your business page.';
  }

  async replaceCollection(Model, website, userId, items) {
    await Model.deleteMany({ websiteId: website._id });
    if (!items.length) {
      return;
    }
    await Model.insertMany(items.map((item) => ({
      ...item,
      providerId: userId,
      websiteId: website._id
    })));
  }

  async replaceArticles(website, userId, items) {
    await ProviderArticle.deleteMany({ websiteId: website._id });
    if (!items.length) {
      return;
    }
    await ProviderArticle.insertMany(items.map((item) => ({
      ...item,
      providerId: userId,
      websiteId: website._id
    })));
  }

  async upsertThemeConfig(userId, websiteId, payload = {}) {
    await ProviderThemeConfig.findOneAndUpdate(
      { providerId: userId },
      {
        $set: {
          providerId: userId,
          websiteId,
          themeName: cleanString(payload.themeName) || 'trust-blue',
          primaryColor: cleanString(payload.primaryColor) || '#1d4ed8',
          accentColor: cleanString(payload.accentColor) || '#f59e0b',
          layoutStyle: ['classic', 'spotlight', 'compact'].includes(cleanString(payload.layoutStyle)) ? cleanString(payload.layoutStyle) : 'classic',
          showStickyMobileCTA: cleanBoolean(payload.showStickyMobileCTA, true),
          cardStyle: ['rounded', 'soft', 'minimal'].includes(cleanString(payload.cardStyle)) ? cleanString(payload.cardStyle) : 'rounded',
          bannerStyle: ['solid', 'gradient', 'split'].includes(cleanString(payload.bannerStyle)) ? cleanString(payload.bannerStyle) : 'gradient'
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  async upsertSeoConfig(userId, websiteId, payload = {}, slug = '') {
    await ProviderSEOConfig.findOneAndUpdate(
      { providerId: userId },
      {
        $set: {
          providerId: userId,
          websiteId,
          metaTitle: cleanString(payload.metaTitle),
          metaDescription: cleanString(payload.metaDescription),
          keywords: cleanArray(payload.keywords),
          canonicalUrl: cleanString(payload.canonicalUrl) || (slug ? `/business/${slug}` : ''),
          schemaType: cleanString(payload.schemaType) || 'LocalBusiness'
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  async ensureSlugAvailable(slug, userId, websiteId) {
    const [growthConflict, websiteConflict] = await Promise.all([
      ProviderGrowth.exists({ websiteSlug: slug, user: { $ne: userId } }),
      ProviderWebsite.exists({ slug, _id: { $ne: websiteId } })
    ]);

    if (growthConflict || websiteConflict) {
      throw new Error('That public business URL is already taken');
    }
  }

  async syncWebsiteSlug(userId, website, state, slug) {
    website.slug = slug;
    state.websiteSlug = slug;
    await Promise.all([website.save(), state.save()]);
  }

  async getReviewSummary(userId) {
    const profile = await ProfessionalProfile.findOne({ user: userId }).select('_id');
    if (!profile) {
      return { averageRating: 0, totalReviews: 0, reviews: [] };
    }

    const reviews = await Review.find({ professional: profile._id }).populate('user').sort({ createdAt: -1 }).limit(10);
    const stats = await Review.aggregate([
      { $match: { professional: profile._id } },
      { $group: { _id: '$professional', averageRating: { $avg: '$rating' }, totalReviews: { $sum: 1 } } }
    ]);
    const summary = stats[0] || { averageRating: 0, totalReviews: 0 };
    return {
      averageRating: Number(Number(summary.averageRating || 0).toFixed(1)),
      totalReviews: Number(summary.totalReviews || 0),
      reviews: reviews.map((item) => ({
        id: item._id.toString(),
        rating: item.rating,
        comment: item.comment,
        customerName: [item.user?.firstName, item.user?.lastName].filter(Boolean).join(' ').trim() || 'Customer',
        createdAt: item.createdAt
      }))
    };
  }

  async buildManagerResponse(userId, websiteDoc, options = {}) {
    const website = websiteDoc.toObject ? websiteDoc.toObject() : websiteDoc;
    const [themeConfig, seoConfig, services, products, offers, articles, leads, bookings, profile, user, reviewSummary, leadCount, bookingCount] = await Promise.all([
      ProviderThemeConfig.findOne({ providerId: userId }).lean(),
      ProviderSEOConfig.findOne({ providerId: userId }).lean(),
      ProviderServiceModel.find({ providerId: userId }).sort({ sortOrder: 1, createdAt: 1 }).lean(),
      ProviderProduct.find({ providerId: userId }).sort({ createdAt: -1 }).lean(),
      ProviderOffer.find({ providerId: userId }).sort({ createdAt: -1 }).lean(),
      ProviderArticle.find({ providerId: userId }).sort({ createdAt: -1 }).lean(),
      ProviderLead.find({ providerId: userId }).sort({ createdAt: -1 }).limit(30).lean(),
      ProviderBooking.find({ providerId: userId }).sort({ createdAt: -1 }).limit(30).lean(),
      ProfessionalProfile.findOne({ user: userId }).lean(),
      User.findById(userId).lean(),
      options.reviewSummary ? Promise.resolve(options.reviewSummary) : this.getReviewSummary(userId),
      ProviderLead.countDocuments({ providerId: userId }),
      ProviderBooking.countDocuments({ providerId: userId })
    ]);

    const completion = options.completion || this.computeCompletion({ website, services });
    const publicPath = website.slug ? `/business/${website.slug}` : '';
    const qrCodeDataUrl = publicPath
      ? await QRCode.toDataURL(`https://karya.local${publicPath}`, { margin: 1, width: 180 })
      : '';

    return {
      providerId: userId,
      managerName: 'Business Website Manager',
      isPurchased: Boolean(website.isPurchased),
      canPublish: Boolean(website.isPurchased),
      status: website.status || 'draft',
      publicPath,
      legacyPublicPath: website.slug ? `/provider/site/${website.slug}` : '',
      publicUrl: publicPath ? `https://karya.local${publicPath}` : '',
      qrCodeDataUrl,
      completionScore: completion.score,
      checklist: completion.checklist,
      suggestions: completion.suggestions,
      stats: {
        inquiriesCount: leadCount,
        bookingsCount: bookingCount,
        viewsCount: Number(profile?.viewCount || 0),
        serviceCount: services.length,
        productCount: products.length,
        articleCount: articles.length
      },
      verification: {
        status: cleanString((await ProviderGrowth.findOne({ user: userId }).lean())?.verification?.status || 'not_started'),
        badgeActive: providerGrowthService.hasVerificationBadge(await providerGrowthService.getOrCreateState(userId))
      },
      website: {
        ...website,
        phone: website.phone || cleanString(user?.mobile),
        email: website.email || cleanString(user?.email),
        category: website.category || cleanString(profile?.profession)
      },
      services: services.map((item) => ({ ...item, id: item._id.toString() })),
      products: products.map((item) => ({ ...item, id: item._id.toString() })),
      offers: offers.map((item) => ({ ...item, id: item._id.toString() })),
      articles: articles.map((item) => ({ ...item, id: item._id.toString() })),
      leads: leads.map((item) => ({ ...item, id: item._id.toString() })),
      bookings: bookings.map((item) => ({ ...item, id: item._id.toString() })),
      themeConfig: themeConfig || {},
      seoConfig: seoConfig || {},
      reviewSummary,
      voiceReady: {
        descriptionPromptSeed: [website.businessName, website.category, website.city].filter(Boolean).join(' | '),
        aiHooks: ['descriptionDraft', 'serviceTagSuggestion', 'voiceProfileImport']
      }
    };
  }

  async buildPublicResponse(userId, websiteSeed = null) {
    const website = websiteSeed || await ProviderWebsite.findOne({ providerId: userId }).lean();
    if (!website) {
      return null;
    }

    const [themeConfig, seoConfig, services, products, offers, articles, profile, user, reviewSummary, state] = await Promise.all([
      ProviderThemeConfig.findOne({ providerId: userId }).lean(),
      ProviderSEOConfig.findOne({ providerId: userId }).lean(),
      ProviderServiceModel.find({ providerId: userId, isActive: true }).sort({ isFeatured: -1, sortOrder: 1, createdAt: 1 }).lean(),
      ProviderProduct.find({ providerId: userId, isActive: true }).sort({ createdAt: -1 }).lean(),
      ProviderOffer.find({ providerId: userId, isActive: true }).sort({ createdAt: -1 }).lean(),
      ProviderArticle.find({ providerId: userId, status: 'published' }).sort({ publishedAt: -1, createdAt: -1 }).lean(),
      ProfessionalProfile.findOne({ user: userId }).lean(),
      User.findById(userId).lean(),
      this.getReviewSummary(userId),
      providerGrowthService.getOrCreateState(userId)
    ]);

    const activeOffers = offers.filter((item) => {
      const now = new Date();
      return (!item.startDate || new Date(item.startDate) <= now) && (!item.endDate || new Date(item.endDate) >= now);
    });

    const responseTime = reviewSummary.totalReviews > 4 ? 'Usually replies within 30 minutes' : 'Usually replies within a few hours';
    const bookingSuccess = `${Math.min(90 + Math.floor((reviewSummary.totalReviews || 0) / 2), 99)}% booking response`;

    return {
      id: website._id.toString(),
      providerId: userId,
      fullName: [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim(),
      mobile: cleanString(user?.mobile),
      email: cleanString(user?.email),
      profilePicture: cleanString(profile?.profilePicture),
      profession: cleanString(profile?.profession),
      description: cleanString(profile?.description),
      averageRating: reviewSummary.averageRating,
      reviewCount: reviewSummary.totalReviews,
      viewCount: Number(profile?.viewCount || 0),
      isVerifiedProvider: providerGrowthService.hasVerificationBadge(state),
      websiteActive: true,
      websiteSlug: website.slug,
      tags: website.tags || [],
      serviceAreas: website.serviceAreas || [],
      location: [website.city, website.state].filter(Boolean).join(', '),
      city: website.city || cleanString(profile?.city),
      state: website.state || cleanString(profile?.state),
      country: cleanString(profile?.country || 'India'),
      area: cleanString(profile?.area),
      addressLine: website.address || cleanString(profile?.addressLine),
      pincode: website.pincode || cleanString(profile?.pincode),
      website: {
        ...website,
        publicPath: website.slug ? `/business/${website.slug}` : '',
        legacyPublicPath: website.slug ? `/provider/site/${website.slug}` : '',
        inquiryEndpoint: `/api/professional/website/${website.slug}/inquiries`,
        bookingEndpoint: `/api/professional/website/${website.slug}/bookings`,
        services,
        products,
        offers: activeOffers,
        articles,
        reviews: reviewSummary.reviews,
        reviewSummary: {
          averageRating: reviewSummary.averageRating,
          totalReviews: reviewSummary.totalReviews
        },
        themeConfig: themeConfig || {},
        seoConfig: seoConfig || {},
        trustIndicators: [
          { label: 'Experience', value: `${website.yearsOfExperience || profile?.experience || 0}+ years` },
          { label: 'Response time', value: responseTime },
          { label: 'Booking success', value: bookingSuccess }
        ],
        advanceFeeRequired: Boolean(website.advanceBookingFeeEnabled),
        advanceFeeAmount: Number(website.bookingFeeAmount || 0),
        paymentInstructions: website.paymentInstructions || '',
        qrCodeDataUrl: website.slug
          ? await QRCode.toDataURL(`https://karya.local/business/${website.slug}`, { margin: 1, width: 180 })
          : ''
      }
    };
  }
}

module.exports = new ProviderWebsiteService();
