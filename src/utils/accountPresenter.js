const toCleanString = (value) => String(value || '').trim();
const isPlaceholderEmail = (value) => /@social\.karya\.local$/i.test(toCleanString(value));
const isPlaceholderMobile = (value) => /^social-/i.test(toCleanString(value));
const toVisibleEmail = (value) => (isPlaceholderEmail(value) ? '' : toCleanString(value));
const toVisibleMobile = (value) => (isPlaceholderMobile(value) ? '' : toCleanString(value));

const composeLocation = ({ town = '', area = '', city = '', state = '', location = '' } = {}) => {
  const computed = [town || area, city, state]
    .map((value) => toCleanString(value))
    .filter(Boolean)
    .join(', ');

  return computed || toCleanString(location);
};

const sanitizeUser = (user) => {
  const plain = typeof user?.toObject === 'function' ? user.toObject() : { ...(user || {}) };
  delete plain.password;

  return {
    ...plain,
    email: toVisibleEmail(plain.email),
    mobile: toVisibleMobile(plain.mobile)
  };
};

const getProfileCompletionState = (user, professionalProfile = null) => {
  const role = toCleanString(user?.role) || 'user';
  const location = composeLocation({
    town: professionalProfile?.town || user?.town,
    area: professionalProfile?.area || user?.area,
    city: professionalProfile?.city || user?.city,
    state: professionalProfile?.state || user?.state,
    location: professionalProfile?.location
  });
  const profession = toCleanString(professionalProfile?.profession);
  const missingRequiredFields = [];

  if (!toVisibleMobile(user?.mobile)) {
    missingRequiredFields.push('mobile');
  }

  if (!location) {
    missingRequiredFields.push('location');
  }

  if (Boolean(user?.passwordSetupRequired)) {
    missingRequiredFields.push('password');
  }

  if (role === 'professional' && !profession) {
    missingRequiredFields.push('profession');
  }

  return {
    profession,
    location,
    missingRequiredFields,
    isProfileComplete: missingRequiredFields.length === 0,
    needsProfileCompletion: missingRequiredFields.length > 0,
    isListed: role === 'professional' && missingRequiredFields.length === 0
  };
};

const buildAuthenticatedUser = (user, professionalProfile = null) => {
  const safeUser = sanitizeUser(user);
  const completion = getProfileCompletionState(user, professionalProfile);

  return {
    ...safeUser,
    profession: completion.profession,
    location: completion.location,
    description: professionalProfile?.description || '',
    serviceAreas: professionalProfile?.serviceAreas || [],
    skills: professionalProfile?.skills || [],
    tags: professionalProfile?.tags || [],
    allowContactDisplay: Boolean(professionalProfile?.allowContactDisplay),
    profileId: professionalProfile?._id?.toString?.() || null,
    passwordSetupRequired: Boolean(user?.passwordSetupRequired),
    missingRequiredFields: completion.missingRequiredFields,
    isProfileComplete: completion.isProfileComplete,
    needsProfileCompletion: completion.needsProfileCompletion,
    isListed: completion.isListed
  };
};

const isProfessionalProfileListable = (profile) => {
  if (!profile?.user) {
    return false;
  }

  return getProfileCompletionState(profile.user, profile).isListed;
};

module.exports = {
  buildAuthenticatedUser,
  composeLocation,
  getProfileCompletionState,
  isProfessionalProfileListable,
  isPlaceholderEmail,
  isPlaceholderMobile,
  sanitizeUser,
  toVisibleEmail,
  toVisibleMobile,
  toCleanString
};
