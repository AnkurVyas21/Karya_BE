const DEFAULT_PROFESSIONS = require('../constants/professions');

const normalizeText = (value = '') => String(value || '')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const escapeRegex = (value = '') => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const PROFESSION_RULES = [
  {
    profession: 'Carpenter',
    keywords: ['carpenter', 'carpentry', 'wood work', 'wooden work', 'woodwork', 'wood worker', 'furniture', 'furniture repair', 'cabinet', 'wardrobe', 'cupboard', 'sofa repair', 'door fitting', 'table repair', 'modular furniture', 'wood polishing', 'लकड़ी', 'लकड़ी का काम', 'फर्नीचर', 'बढ़ई', 'फर्नीचर का काम'],
    specializations: ['Furniture work', 'Wooden work', 'Cabinet installation', 'Furniture repair']
  },
  {
    profession: 'Plumber',
    keywords: ['plumber', 'plumbing', 'pipe', 'pipeline', 'tap', 'leak', 'leakage', 'water leakage', 'drain', 'drainage', 'bathroom fitting', 'sanitary fitting', 'washbasin', 'flush', 'toilet fitting', 'sewer', 'nal', 'nali', 'geyser fitting', 'प्लंबर', 'प्लम्बिंग', 'नल', 'पाइप', 'लीकेज', 'पानी की पाइप', 'बाथरूम फिटिंग', 'सैनिटरी', 'ड्रेनेज'],
    specializations: ['Pipe repair', 'Leak fixing', 'Bathroom fitting', 'Sanitary work']
  },
  {
    profession: 'Architect',
    keywords: ['architect', 'architecture', 'architectural', 'house design', 'home design', 'building design', 'map design', 'floor plan', 'house plan', 'elevation', 'blueprint', 'house drawing', '3d design', 'ghar ka naksha', 'home map', 'naksha', 'आर्किटेक्ट', 'नक्शा', 'घर का नक्शा', 'डिजाइन मैप', 'फ्लोर प्लान'],
    specializations: ['House planning', 'Elevation design', 'Blueprint design', 'Building design']
  },
  {
    profession: 'Builder',
    keywords: ['builder', 'building contractor', 'contractor', 'construction', 'house construction', 'building work', 'civil work', 'site work', 'site supervision', 'ghar banana', 'makan banana', 'निर्माण', 'बिल्डर', 'कंस्ट्रक्शन', 'कॉन्ट्रैक्टर', 'घर बनाना', 'बिल्डिंग का काम'],
    specializations: ['Construction work', 'Building contractor', 'Site supervision', 'House construction']
  },
  {
    profession: 'Mason',
    keywords: ['mason', 'brick work', 'tile work', 'plaster', 'plastering', 'tiles fitting', 'stone work', 'ईंट का काम', 'राजमिस्त्री', 'टाइल्स का काम', 'प्लास्टर'],
    specializations: ['Brick work', 'Tile fitting', 'Plaster work', 'Stone work']
  },
  {
    profession: 'Electrician',
    keywords: ['electrician', 'electrical', 'wiring', 'switch', 'socket', 'mcb', 'short circuit', 'inverter', 'fan fitting', 'light fitting', 'bijli', 'wireman', 'इलेक्ट्रीशियन', 'बिजली', 'वायरिंग', 'स्विच बोर्ड'],
    specializations: ['Wiring', 'Electrical repair', 'Switchboard work', 'Appliance wiring']
  },
  {
    profession: 'Auto Mechanic',
    keywords: ['auto mechanic', 'mechanic', 'car repair', 'bike repair', 'vehicle repair', 'vehicle service', 'fix vehicle', 'fix vehicles', 'fix car', 'fix cars', 'repair car', 'repair cars', 'repair bike', 'repair bikes', 'garage', 'engine', 'engine noise', 'cylinder', 'clutch', 'gear', 'brake', 'silencer', 'gaadi', 'gaadi mechanic', 'bike mechanic', 'मैकेनिक', 'गाड़ी', 'इंजन', 'सिलेंडर', 'ब्रेक', 'क्लच'],
    specializations: ['Engine repair', 'Vehicle diagnostics', 'Bike repair', 'Car servicing']
  },
  {
    profession: 'Teacher',
    keywords: ['teacher', 'teaching', 'teach', 'teach students', 'teaches students', 'school teacher', 'subject teacher', 'faculty', 'professor', 'lecturer', 'chemistry teacher', 'physics teacher', 'math teacher', 'mathematics teacher', 'science teacher', 'biology teacher', 'english teacher', 'teach chemistry', 'teach physics', 'teach maths', 'teach math', 'teach biology', 'teach english', 'शिक्षक', 'अध्यापक', 'प्रोफेसर', 'लेक्चरर'],
    specializations: ['Teaching', 'Subject instruction', 'Student mentoring', 'Classroom teaching']
  },
  {
    profession: 'Home Tutor',
    keywords: ['home tutor', 'private tutor', 'tuition teacher', 'tuition', 'home tuition', 'personal tutor', 'coach students', 'ट्यूशन', 'ट्यूटर', 'घर पर पढ़ाना'],
    specializations: ['Home tuition', 'One-to-one teaching', 'Exam preparation', 'Student coaching']
  },
  {
    profession: 'Painter',
    keywords: ['painter', 'painting', 'wall paint', 'texture paint', 'putty', 'color work', 'paint work', 'पेंटर', 'पेंटिंग', 'पुट्टी'],
    specializations: ['Wall painting', 'Texture work', 'Putty work', 'Interior paint']
  },
  {
    profession: 'Interior Designer',
    keywords: ['interior designer', 'interior design', 'room design', 'modular kitchen', 'home interior', 'kitchen design', 'living room design', 'bedroom design', 'इंटीरियर', 'इंटीरियर डिजाइन', 'घर का इंटीरियर'],
    specializations: ['Home interior', 'Room design', 'Kitchen design', 'Space planning']
  },
  {
    profession: 'Web Developer',
    keywords: ['web developer', 'website', 'website development', 'site development', 'wordpress', 'shopify', 'frontend', 'landing page', 'portfolio site', 'वेबसाइट', 'वेब डेवलपर', 'साइट बनाना'],
    specializations: ['Website development', 'Frontend development', 'WordPress', 'Landing pages']
  },
  {
    profession: 'Software Engineer',
    keywords: ['software engineer', 'software developer', 'software development', 'app development', 'application development', 'backend', 'api development', 'mobile app', 'android app', 'ios app', 'coding', 'software', 'डेवलपर', 'सॉफ्टवेयर', 'ऐप डेवलपमेंट', 'एंड्रॉइड ऐप'],
    specializations: ['Software development', 'Backend development', 'App development', 'API development']
  },
  {
    profession: 'Graphic Designer',
    keywords: ['graphic designer', 'graphic design', 'logo design', 'poster design', 'brochure design', 'social media post', 'branding design', 'ग्राफिक डिजाइन', 'लोगो डिजाइन'],
    specializations: ['Logo design', 'Poster design', 'Branding', 'Social graphics']
  },
  {
    profession: 'Beautician',
    keywords: ['beautician', 'beauty parlour', 'parlour', 'makeup', 'bridal makeup', 'facial', 'threading', 'waxing', 'pedicure', 'manicure', 'ब्यूटी पार्लर', 'मेकअप', 'फेशियल'],
    specializations: ['Makeup', 'Facial', 'Salon services', 'Bridal work']
  },
  {
    profession: 'Barber',
    keywords: ['barber', 'hair cut', 'haircut', 'cut hair', 'trim beard', 'beard trim', 'shaving', 'mens salon', 'men salon', 'hair styling', 'नाई', 'बाल काटना', 'दाढ़ी बनाना'],
    specializations: ['Hair cutting', 'Beard trimming', 'Shaving', 'Men grooming']
  }
];

const scoreKeyword = (text, keyword) => {
  const normalizedText = normalizeText(text);
  const normalizedKeyword = normalizeText(keyword);
  if (!normalizedText || !normalizedKeyword) {
    return 0;
  }

  const hasHindi = /[\u0900-\u097F]/.test(normalizedKeyword);
  if (hasHindi) {
    return normalizedText.includes(normalizedKeyword) ? Math.max(4, normalizedKeyword.length) : 0;
  }

  const words = normalizedKeyword.split(' ').filter(Boolean);
  const pattern = words.length === 1
    ? new RegExp(`(^|\\s)${escapeRegex(words[0])}(?=\\s|$)`, 'i')
    : new RegExp(`(^|\\s)${words.map((word) => escapeRegex(word)).join('\\s+')}(?=\\s|$)`, 'i');

  if (!pattern.test(normalizedText)) {
    return 0;
  }

  return words.length >= 2 ? words.length * 5 : (words[0].length >= 5 ? 4 : 3);
};

const inferProfessionFromText = (text = '', allowedProfessions = DEFAULT_PROFESSIONS) => {
  const normalizedAllowed = new Set((allowedProfessions || []).map((item) => String(item || '').trim()).filter(Boolean));
  const rankedRules = PROFESSION_RULES
    .filter((rule) => normalizedAllowed.size === 0 || normalizedAllowed.has(rule.profession))
    .map((rule) => {
      const score = rule.keywords.reduce((total, keyword) => total + scoreKeyword(text, keyword), 0);
      return {
        ...rule,
        score
      };
    })
    .filter((rule) => rule.score > 0)
    .sort((left, right) => right.score - left.score);

  if (rankedRules.length === 0) {
    return {
      profession: '',
      specializations: [],
      score: 0,
      similarProfessions: []
    };
  }

  const bestRule = rankedRules[0];
  return {
    profession: bestRule.profession,
    specializations: bestRule.specializations || [],
    score: bestRule.score,
    similarProfessions: rankedRules
      .slice(1, 4)
      .map((rule) => rule.profession)
  };
};

module.exports = {
  PROFESSION_RULES,
  inferProfessionFromText,
  normalizeProfessionInferenceText: normalizeText,
  scoreProfessionKeyword: scoreKeyword
};
