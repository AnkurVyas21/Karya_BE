const toCurrency = (value) => (typeof value === 'number' ? value : 0);
const { getProfileCompletionState, toVisibleEmail, toVisibleMobile } = require('./accountPresenter');

const INDIA_TIME_ZONE = 'Asia/Kolkata';
const NIGHT_START_MINUTES = 20 * 60;
const NIGHT_END_MINUTES = 6 * 60;

const parseTimeToMinutes = (value = '') => {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return (hours * 60) + minutes;
};

const formatTimeLabel = (value = '') => {
  const totalMinutes = parseTimeToMinutes(value);
  if (totalMinutes === null) {
    return '';
  }

  const hours24 = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const suffix = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${String(minutes).padStart(2, '0')} ${suffix}`;
};

const getIndiaMinutesNow = () => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: INDIA_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date());

  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
  return (hour * 60) + minute;
};

const isWithinTimeRange = (currentMinutes, startMinutes, endMinutes) => {
  if (startMinutes === null || endMinutes === null) {
    return true;
  }

  if (startMinutes === endMinutes) {
    return true;
  }

  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }

  return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
};

const isNightTime = (currentMinutes) => currentMinutes >= NIGHT_START_MINUTES || currentMinutes <= NIGHT_END_MINUTES;

const buildAvailabilityLabel = (profile = {}) => {
  const availabilityNote = String(profile.availability || '').trim();
  const startLabel = formatTimeLabel(profile.availabilityStart);
  const endLabel = formatTimeLabel(profile.availabilityEnd);

  if (availabilityNote && startLabel && endLabel) {
    return `${availabilityNote} • ${startLabel} - ${endLabel}`;
  }

  if (availabilityNote) {
    return availabilityNote;
  }

  if (startLabel && endLabel) {
    return `${startLabel} - ${endLabel}`;
  }

  return '';
};

const buildCallStatus = ({ profile = {}, mobile = '' }) => {
  const publicMobile = toVisibleMobile(mobile);
  const availabilityLabel = buildAvailabilityLabel(profile);
  const currentMinutes = getIndiaMinutesNow();
  const startMinutes = parseTimeToMinutes(profile.availabilityStart);
  const endMinutes = parseTimeToMinutes(profile.availabilityEnd);
  const inWorkingHours = isWithinTimeRange(currentMinutes, startMinutes, endMinutes);
  const acceptsNightCalls = Boolean(profile.acceptsNightCalls);

  if (!profile.allowContactDisplay || !publicMobile) {
    return {
      enabled: false,
      reason: 'This provider has chosen not to show their number publicly.',
      availabilityLabel,
      isWithinWorkingHours: inWorkingHours,
      acceptsNightCalls
    };
  }

  if (inWorkingHours || (acceptsNightCalls && isNightTime(currentMinutes))) {
    return {
      enabled: true,
      reason: '',
      availabilityLabel,
      isWithinWorkingHours: inWorkingHours,
      acceptsNightCalls
    };
  }

  const availabilityReason = availabilityLabel
    ? `This provider is unavailable for calls right now. Available during ${availabilityLabel}.`
    : 'This provider is unavailable for calls right now.';
  const nightReason = acceptsNightCalls
    ? ' Night calls are available during late hours.'
    : '';

  return {
    enabled: false,
    reason: `${availabilityReason}${nightReason}`.trim(),
    availabilityLabel,
    isWithinWorkingHours: inWorkingHours,
    acceptsNightCalls
  };
};

const buildProfessionalSummary = ({ profile, reviewStats, bookmarkedIds = new Set() }) => {
  const user = profile.user || {};
  const charges = profile.charges || {};
  const rating = reviewStats.averageRating || 0;
  const reviewCount = reviewStats.reviewCount || 0;
  const completion = getProfileCompletionState(user, profile);
  const callStatus = buildCallStatus({ profile, mobile: user.mobile });

  return {
    id: profile._id.toString(),
    userId: user._id ? user._id.toString() : null,
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    fullName: [user.firstName, user.lastName].filter(Boolean).join(' ').trim(),
    email: profile.allowContactDisplay ? toVisibleEmail(user.email) || null : null,
    mobile: profile.allowContactDisplay ? toVisibleMobile(user.mobile) || null : null,
    profession: profile.profession || '',
    skills: profile.skills || [],
    specializations: profile.skills || [],
    tags: profile.tags || [],
    serviceAreas: profile.serviceAreas || [],
    experience: profile.experience || 0,
    description: profile.description || '',
    location: profile.location || '',
    country: profile.country || 'India',
    state: profile.state || '',
    addressLine: profile.addressLine || '',
    city: profile.city || '',
    town: profile.town || '',
    area: profile.area || '',
    pincode: profile.pincode || '',
    availability: profile.availability || '',
    availabilityStart: profile.availabilityStart || '',
    availabilityEnd: profile.availabilityEnd || '',
    acceptsNightCalls: Boolean(profile.acceptsNightCalls),
    availabilityLabel: buildAvailabilityLabel(profile),
    profilePicture: profile.profilePicture || '',
    certificates: profile.certificates || [],
    charges: {
      baseCharge: toCurrency(charges.baseCharge),
      visitingCharge: toCurrency(charges.visitingCharge),
      nightCharge: toCurrency(charges.nightCharge),
      emergencyCharge: toCurrency(charges.emergencyCharge)
    },
    allowContactDisplay: Boolean(profile.allowContactDisplay),
    callStatus,
    missingRequiredFields: completion.missingRequiredFields,
    isProfileComplete: completion.isProfileComplete,
    isListed: completion.isListed,
    viewCount: profile.viewCount || 0,
    averageRating: Number(rating.toFixed(1)),
    reviewCount,
    isBookmarked: bookmarkedIds.has(profile._id.toString()),
    createdAt: profile.createdAt
  };
};

module.exports = {
  buildProfessionalSummary
};
