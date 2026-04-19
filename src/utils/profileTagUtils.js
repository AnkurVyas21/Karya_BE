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

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'because', 'been', 'being', 'based', 'by',
  'can', 'could', 'do', 'does', 'doing', 'for', 'from', 'good', 'have', 'has', 'had',
  'he', 'her', 'his', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'kind', 'like', 'many',
  'me', 'my', 'of', 'on', 'or', 'our', 'ours', 'she', 'so', 'some', 'than', 'that', 'the',
  'their', 'them', 'there', 'these', 'they', 'this', 'those', 'to', 'too', 'various', 'we',
  'what', 'when', 'where', 'which', 'who', 'why', 'with', 'you', 'your', 'especially'
]);

const GENERIC_NON_TAG_TOKENS = new Set([
  'ability', 'abilities', 'actual', 'actually', 'based', 'best', 'business', 'client', 'clients',
  'customer', 'customers', 'develop', 'develops', 'developing', 'experience', 'experienced', 'general',
  'good', 'great', 'help', 'helps', 'job', 'jobs', 'kind', 'kinds', 'many', 'professional', 'professionals',
  'service', 'services', 'skill', 'skills', 'technology', 'technologies', 'term', 'terms', 'various',
  'work', 'works'
]);

const SHORT_ALLOWED_TAGS = new Set(['ac', 'ai', 'api', 'aws', 'css', 'hr', 'ios', 'it', 'qa', 'seo', 'ui', 'ux']);

const TOKEN_DISPLAY_MAP = {
  android: 'Android',
  angular: 'Angular',
  api: 'API',
  aws: 'AWS',
  css: 'CSS',
  devops: 'DevOps',
  figma: 'Figma',
  ios: 'iOS',
  java: 'Java',
  javascript: 'JavaScript',
  kubernetes: 'Kubernetes',
  mongodb: 'MongoDB',
  nextjs: 'Next.js',
  nodejs: 'Node.js',
  php: 'PHP',
  python: 'Python',
  react: 'React',
  seo: 'SEO',
  typescript: 'TypeScript',
  ui: 'UI',
  ux: 'UX',
  wordpress: 'WordPress'
};

const DESCRIPTION_PATTERN_TAGS = [
  /\b(?:android|ios|wordpress|shopify|angular|react|node\.?js|javascript|typescript|python|java|php|kubernetes|docker|seo|figma|api|aws|mongodb)\b/ig,
  /\b(?:vehicle|car|bike|engine|cylinder|brake|clutch|gear|garage|mechanic|plumbing|plumber|pipe|leakage|wiring|electrical|cleaning|painting|photography|videography|architect|interior|tutor|teacher|lawyer|doctor)\b/ig,
  /\b(?:software|web|website|app|mobile|graphic|civil|interior|backend|frontend|full stack|full-stack)\s+(?:developer|design|designer|development|engineer|mechanic|repair|repairing|repairer|service|cleaning|cleaner|technician|consultant|writer|marketer|planner)\b/ig,
  /\b[a-z0-9/+.-]+\s+(?:repair|repairs|repairing|development|design|installation|maintenance|cleaning|fitting|service|servicing|marketing|teaching|consulting|photography|videography|writing|editing|painting)\b/ig
];

const splitWords = (value = '') => cleanText(value)
  .toLowerCase()
  .split(/[\s,/&-]+/)
  .map((item) => item.trim())
  .filter(Boolean);

const toSingular = (value = '') => {
  const token = String(value || '').trim().toLowerCase();
  if (token.endsWith('ies') && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith('s') && !token.endsWith('ss') && token.length > 4) {
    return token.slice(0, -1);
  }
  return token;
};

const formatToken = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9+/.-]+/g, '');
  return TOKEN_DISPLAY_MAP[normalized] || value;
};

const sanitizeTag = (value = '') => {
  const words = splitWords(value).map((item) => toSingular(item));
  const filteredWords = words.filter((item) => {
    if (!item) {
      return false;
    }

    if (STOPWORDS.has(item) || GENERIC_NON_TAG_TOKENS.has(item)) {
      return false;
    }

    if (item.length < 3 && !SHORT_ALLOWED_TAGS.has(item)) {
      return false;
    }

    return true;
  });

  if (filteredWords.length === 0 || filteredWords.length > 5) {
    return '';
  }

  return filteredWords
    .map((item) => formatToken(item))
    .join(' ')
    .trim();
};

const tokenizeText = (value = '') => splitWords(value)
  .map((item) => sanitizeTag(item))
  .filter(Boolean);

const tokenOverlapScore = (left = '', right = '') => {
  const leftTokens = new Set(splitWords(left).map((item) => toSingular(item)));
  const rightTokens = new Set(splitWords(right).map((item) => toSingular(item)));
  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap / Math.max(leftTokens.size, rightTokens.size);
};

const RELATED_PROFESSIONS = {
  plumber: ['Pipe Fitter', 'Bathroom Fitting Expert', 'Sanitary Technician', 'Drainage Technician'],
  electrician: ['Electrical Technician', 'Wiring Technician', 'Appliance Electrician'],
  carpenter: ['Furniture Maker', 'Woodwork Specialist', 'Cabinet Installer'],
  painter: ['Wall Painter', 'Texture Painter', 'Interior Painter'],
  mason: ['Construction Worker', 'Tile Mason', 'Brick Mason'],
  architect: ['Civil Engineer', 'Interior Designer', 'House Planner', 'Building Designer'],
  'civil engineer': ['Architect', 'Structural Engineer', 'Building Contractor'],
  builder: ['Building Contractor', 'Civil Engineer', 'Mason', 'Architect'],
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
  veterinarian: ['Veterinary Surgeon', 'Animal Doctor', 'Livestock Specialist'],
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
      .map((item) => sanitizeTag(item))
      .filter(Boolean);

    return parts.slice(0, 8);
  });

  const matchedPatterns = DESCRIPTION_PATTERN_TAGS.flatMap((pattern) => {
    const matches = String(description || '').match(pattern) || [];
    return matches
      .map((item) => sanitizeTag(item))
      .filter(Boolean);
  });

  return uniqueStrings([...phrases, ...matchedPatterns]).slice(0, 20);
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
  const providedTags = normalizeList(tags)
    .map((item) => sanitizeTag(item))
    .filter(Boolean);
  const specializationTags = normalizedSpecializations
    .map((item) => sanitizeTag(item) || cleanText(item))
    .filter(Boolean);
  const professionAnchors = uniqueStrings([
    sanitizeTag(profession) || profession,
    ...relatedProfessionTags,
    ...specializationTags,
    ...providedTags
  ]).filter(Boolean);
  const relevantDescriptionTags = uniqueStrings([
    ...descriptionPhrases,
    ...descriptionTokens
  ]).filter((tag) => {
    if (!professionAnchors.length) {
      return true;
    }

    return professionAnchors.some((anchor) => tokenOverlapScore(anchor, tag) >= 0.34);
  });

  return uniqueStrings([
    sanitizeTag(profession) || profession,
    ...relatedProfessionTags,
    ...specializationTags,
    ...providedTags,
    ...relevantDescriptionTags,
    ...locationTags
  ]);
};

module.exports = {
  deriveProfileTags,
  deriveRelatedProfessionTags,
  normalizeList,
  uniqueStrings
};
