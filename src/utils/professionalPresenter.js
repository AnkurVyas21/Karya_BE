const toCurrency = (value) => (typeof value === 'number' ? value : 0);
const { getProfileCompletionState, toVisibleEmail, toVisibleMobile } = require('./accountPresenter');

const buildProfessionalSummary = ({ profile, reviewStats, bookmarkedIds = new Set() }) => {
  const user = profile.user || {};
  const charges = profile.charges || {};
  const rating = reviewStats.averageRating || 0;
  const reviewCount = reviewStats.reviewCount || 0;
  const completion = getProfileCompletionState(user, profile);

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
    profilePicture: profile.profilePicture || '',
    certificates: profile.certificates || [],
    charges: {
      baseCharge: toCurrency(charges.baseCharge),
      visitingCharge: toCurrency(charges.visitingCharge),
      nightCharge: toCurrency(charges.nightCharge),
      emergencyCharge: toCurrency(charges.emergencyCharge)
    },
    allowContactDisplay: Boolean(profile.allowContactDisplay),
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
