const DEFAULT_PROFESSIONS = require('../constants/professions');

const uniqueStrings = (values = []) => [...new Set(
  values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
)];

const normalizeList = (value) => {
  if (Array.isArray(value)) {
    return uniqueStrings(value);
  }

  if (typeof value === 'string') {
    return uniqueStrings(value.split(','));
  }

  return [];
};

const cleanText = (value = '') => String(value || '')
  .replace(/[^\p{L}\p{N}\s,&/-]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const tokenizeText = (value = '') => cleanText(value)
  .toLowerCase()
  .split(/[\s,/&-]+/)
  .map((item) => item.trim())
  .filter((item) => item.length >= 3);

const RELATED_PROFESSIONS = {
  plumber: ['Pipe Fitter', 'Bathroom Fitting Expert', 'Sanitary Technician', 'Drainage Technician'],
  electrician: ['Electrical Technician', 'Wiring Technician', 'Appliance Electrician'],
  carpenter: ['Furniture Maker', 'Woodwork Specialist', 'Cabinet Installer'],
  painter: ['Wall Painter', 'Texture Painter', 'Interior Painter'],
  mason: ['Construction Worker', 'Tile Mason', 'Brick Mason'],
  architect: ['Civil Engineer', 'Interior Designer', 'House Planner', 'Building Designer'],
  'civil engineer': ['Architect', 'Structural Engineer', 'Building Contractor'],
  'interior designer': ['Architect', 'Space Planner', 'Modular Kitchen Designer'],
  'ac repair technician': ['HVAC Technician', 'Cooling Technician', 'Air Conditioner Mechanic'],
  'mobile repair technician': ['Phone Repair Expert', 'Device Technician', 'Electronics Repair Technician'],
  'auto mechanic': ['Car Mechanic', 'Bike Mechanic', 'Garage Technician'],
  cleaner: ['House Cleaner', 'Deep Cleaning Service', 'Sanitization Expert'],
  'house cleaner': ['Cleaner', 'Home Cleaning Service', 'Deep Cleaning Service'],
  beautician: ['Makeup Artist', 'Salon Expert', 'Skin Care Specialist'],
  photographer: ['Event Photographer', 'Wedding Photographer', 'Photo Studio'],
  videographer: ['Video Creator', 'Wedding Videographer', 'Reel Creator'],
  caterer: ['Food Caterer', 'Event Catering Service', 'Meal Service Provider'],
  'event planner': ['Wedding Planner', 'Decoration Planner', 'Event Organizer'],
  teacher: ['Tutor', 'Home Tutor', 'Academic Coach'],
  'home tutor': ['Teacher', 'Private Tutor', 'Academic Mentor'],
  lawyer: ['Legal Advisor', 'Advocate', 'Legal Consultant'],
  doctor: ['Medical Consultant', 'Physician', 'Health Specialist'],
  consultant: ['Advisor', 'Expert Consultant', 'Specialist'],
  developer: ['Software Engineer', 'Web Developer', 'App Developer'],
  'software engineer': ['Developer', 'Backend Developer', 'Application Engineer'],
  'web developer': ['Frontend Developer', 'Website Developer', 'Developer'],
  'web designer': ['UI Designer', 'Website Designer', 'Graphic Designer'],
  designer: ['Graphic Designer', 'UI/UX Designer', 'Creative Designer'],
  'graphic designer': ['Designer', 'Brand Designer', 'Visual Designer'],
  'ui/ux designer': ['Product Designer', 'Web Designer', 'Designer'],
  'digital marketer': ['Marketing Expert', 'Ads Specialist', 'Growth Marketer'],
  'seo specialist': ['Search Marketing Expert', 'Organic Growth Specialist', 'Digital Marketer'],
  'content writer': ['Copywriter', 'Blog Writer', 'Content Creator'],
  'devops engineer': ['Cloud Engineer', 'Deployment Engineer', 'Infrastructure Engineer']
};

const professionAliasMap = DEFAULT_PROFESSIONS.reduce((acc, profession) => {
  acc[profession.toLowerCase()] = [profession];
  return acc;
}, {});

Object.entries(RELATED_PROFESSIONS).forEach(([key, values]) => {
  professionAliasMap[key] = uniqueStrings([...(professionAliasMap[key] || []), ...values]);
});

const extractDescriptionPhrases = (description = '') => {
  const segments = String(description || '')
    .split(/[.!?\n]/)
    .map((item) => cleanText(item))
    .filter((item) => item.length >= 4);

  const phrases = segments.flatMap((segment) => {
    const parts = segment
      .split(/,| and | or | with | for | plus | also /i)
      .map((item) => cleanText(item))
      .filter((item) => item.length >= 4);

    return parts.slice(0, 8);
  });

  return uniqueStrings(phrases).slice(0, 20);
};

const deriveRelatedProfessionTags = (profession = '', professionCatalog = DEFAULT_PROFESSIONS) => {
  const cleaned = String(profession || '').trim();
  if (!cleaned) {
    return [];
  }

  const exactMatch = professionAliasMap[cleaned.toLowerCase()] || [];
  const catalog = uniqueStrings([...(professionCatalog || []), ...DEFAULT_PROFESSIONS]);
  const nearbyMatches = catalog.filter((item) => {
    const normalizedItem = item.toLowerCase();
    const normalizedProfession = cleaned.toLowerCase();
    return normalizedItem !== normalizedProfession
      && (
        normalizedItem.includes(normalizedProfession)
        || normalizedProfession.includes(normalizedItem)
        || normalizedItem.split(/\s+/).some((token) => normalizedProfession.includes(token))
      );
  }).slice(0, 4);

  return uniqueStrings([cleaned, ...exactMatch, ...nearbyMatches]);
};

const deriveProfileTags = ({
  profession = '',
  specializations = [],
  description = '',
  serviceAreas = [],
  tags = [],
  country = '',
  state = '',
  city = '',
  town = '',
  area = '',
  professionCatalog = DEFAULT_PROFESSIONS
} = {}) => {
  const normalizedSpecializations = normalizeList(specializations);
  const descriptionPhrases = extractDescriptionPhrases(description);
  const descriptionTokens = tokenizeText(description).slice(0, 24);
  const relatedProfessionTags = deriveRelatedProfessionTags(profession, professionCatalog);
  const locationTags = uniqueStrings([country, state, city, town, area, ...normalizeList(serviceAreas)]);

  return uniqueStrings([
    profession,
    ...relatedProfessionTags,
    ...normalizedSpecializations,
    ...normalizeList(tags),
    ...descriptionPhrases,
    ...descriptionTokens,
    ...locationTags
  ]);
};

module.exports = {
  deriveProfileTags,
  deriveRelatedProfessionTags,
  normalizeList,
  uniqueStrings
};
