const DEFAULT_PROFESSIONS = require('../constants/professions');

const normalizeText = (value = '') => String(value || '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/\bshaadi\b/g, 'shadi')
  .replace(/\bmehendi\b/g, 'mehndi')
  .replace(/\bbaraat\b/g, 'barat');

const escapeRegex = (value = '') => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const PROFESSION_RULES = [
  {
    profession: 'Carpenter',
    keywords: ['carpenter', 'carpentry', 'wood work', 'furniture', 'cabinet', 'wardrobe', 'बढ़ई', 'लकड़ी का काम', 'फर्नीचर'],
    specializations: ['Furniture work', 'Wooden work', 'Cabinet installation', 'Furniture repair']
  },
  {
    profession: 'Plumber',
    keywords: ['plumber', 'plumbing', 'pipe', 'tap', 'leak', 'leakage', 'bathroom fitting', 'nal', 'nali', 'प्लंबर', 'नल', 'पाइप', 'लीकेज', 'बाथरूम फिटिंग'],
    specializations: ['Pipe repair', 'Leak fixing', 'Bathroom fitting', 'Sanitary work']
  },
  {
    profession: 'Architect',
    keywords: ['architect', 'house design', 'building design', 'map design', 'floor plan', 'naksha', 'आर्किटेक्ट', 'नक्शा', 'घर का नक्शा'],
    specializations: ['House planning', 'Elevation design', 'Blueprint design', 'Building design']
  },
  {
    profession: 'Builder',
    keywords: ['builder', 'contractor', 'construction', 'house construction', 'ghar banana', 'निर्माण', 'बिल्डर', 'कॉन्ट्रैक्टर', 'घर बनाना'],
    specializations: ['Construction work', 'Building contractor', 'Site supervision', 'House construction']
  },
  {
    profession: 'Mason',
    keywords: ['mason', 'brick work', 'tile work', 'plaster', 'rajmistri', 'राजमिस्त्री', 'टाइल्स का काम', 'प्लास्टर'],
    specializations: ['Brick work', 'Tile fitting', 'Plaster work', 'Stone work']
  },
  {
    profession: 'Electrician',
    keywords: ['electrician', 'electrical', 'wiring', 'switch', 'socket', 'mcb', 'bijli', 'इलेक्ट्रीशियन', 'बिजली', 'वायरिंग', 'स्विच बोर्ड'],
    specializations: ['Wiring', 'Electrical repair', 'Switchboard work', 'Appliance wiring']
  },
  {
    profession: 'Auto Mechanic',
    keywords: ['auto mechanic', 'mechanic', 'car repair', 'bike repair', 'garage', 'engine', 'brake', 'clutch', 'गाड़ी मैकेनिक', 'मैकेनिक', 'गाड़ी'],
    specializations: ['Engine repair', 'Vehicle diagnostics', 'Bike repair', 'Car servicing']
  },
  {
    profession: 'Teacher',
    keywords: ['teacher', 'teaching', 'school teacher', 'professor', 'lecturer', 'शिक्षक', 'अध्यापक'],
    specializations: ['Teaching', 'Subject instruction', 'Student mentoring', 'Classroom teaching']
  },
  {
    profession: 'Veterinarian',
    keywords: ['veterinarian', 'vet doctor', 'animal doctor', 'pashu doctor', 'पशु चिकित्सक', 'पशु डॉक्टर', 'जानवरों का डॉक्टर'],
    specializations: ['Animal treatment', 'Veterinary consultation', 'Livestock care', 'Farm animal care']
  },
  {
    profession: 'Home Tutor',
    keywords: ['home tutor', 'private tutor', 'tuition teacher', 'tuition', 'ट्यूशन', 'घर पर पढ़ाना'],
    specializations: ['Home tuition', 'One-to-one teaching', 'Exam preparation', 'Student coaching']
  },
  {
    profession: 'Painter',
    keywords: ['painter', 'painting', 'wall paint', 'texture paint', 'putty', 'पेंटर', 'पेंटिंग', 'पुट्टी'],
    specializations: ['Wall painting', 'Texture work', 'Putty work', 'Interior paint']
  },
  {
    profession: 'Interior Designer',
    keywords: ['interior designer', 'interior design', 'room design', 'modular kitchen', 'इंटीरियर', 'घर का इंटीरियर'],
    specializations: ['Home interior', 'Room design', 'Kitchen design', 'Space planning']
  },
  {
    profession: 'Web Developer',
    keywords: ['web developer', 'website development', 'wordpress', 'shopify', 'website', 'वेबसाइट', 'वेब डेवलपर'],
    specializations: ['Website development', 'Frontend development', 'WordPress', 'Landing pages']
  },
  {
    profession: 'Software Engineer',
    keywords: ['software engineer', 'software developer', 'app development', 'backend', 'api development', 'सॉफ्टवेयर', 'ऐप डेवलपमेंट'],
    specializations: ['Software development', 'Backend development', 'App development', 'API development']
  },
  {
    profession: 'Graphic Designer',
    keywords: ['graphic designer', 'logo design', 'poster design', 'ग्राफिक डिजाइन', 'लोगो डिजाइन'],
    specializations: ['Logo design', 'Poster design', 'Branding', 'Social graphics']
  },
  {
    profession: 'Mehendi Artist',
    keywords: ['mehendi artist', 'mehndi artist', 'henna artist', 'mehendi', 'mehndi', 'मेहंदी', 'मेहँदी लगाने वाली', 'mehndi wali'],
    specializations: ['Bridal mehendi', 'Henna design', 'Wedding mehendi', 'Arabic mehendi']
  },
  {
    profession: 'Wedding Decorator',
    keywords: ['wedding decorator', 'event decorator', 'stage decorator', 'stage decoration', 'wedding decor', 'mandap decoration', 'shaadi decoration', 'शादी डेकोरेटर', 'स्टेज सजावट'],
    specializations: ['Stage decoration', 'Mandap decor', 'Flower setup', 'Wedding event styling']
  },
  {
    profession: 'Dhol Player',
    keywords: ['dhol player', 'dhol wala', 'dholi', 'barat dhol', 'ढोल वाला'],
    specializations: ['Wedding dhol', 'Baraat performance', 'Live percussion', 'Event music']
  },
  {
    profession: 'Ghodi Service',
    keywords: ['ghodi service', 'ghodi wala', 'wedding horse', 'horse for wedding', 'घोड़ी वाला', 'दूल्हा घोड़ी'],
    specializations: ['Baraat horse', 'Wedding procession', 'Groom entry', 'Event horse rental']
  },
  {
    profession: 'Beautician',
    keywords: ['beautician', 'beauty parlour', 'parlour', 'makeup', 'bridal makeup', 'ब्यूटी पार्लर', 'मेकअप'],
    specializations: ['Makeup', 'Facial', 'Salon services', 'Bridal work']
  },
  {
    profession: 'Barber',
    keywords: ['barber', 'hair cut', 'haircut', 'trim beard', 'नाई', 'बाल काटना', 'दाढ़ी बनाना'],
    specializations: ['Hair cutting', 'Beard trimming', 'Shaving', 'Men grooming']
  },
  {
    profession: 'Wedding Caterer',
    keywords: ['wedding caterer', 'marriage caterer', 'shaadi caterer', 'shadi caterer', 'barat food', 'baraat food', 'halwai', 'शादी कैटरर', 'बारात में खाना', 'खाना बनाने वाला'],
    specializations: ['Wedding catering', 'Baraat food', 'Traditional cooking', 'Bulk event meals']
  },
  {
    profession: 'Pandit',
    keywords: ['pandit', 'pandit ji', 'puja pandit', 'पंडित', 'पंडित जी', 'पूजा कराने वाला'],
    specializations: ['Wedding rituals', 'Puja', 'Havan', 'Religious ceremonies']
  },
  {
    profession: 'Tent House',
    keywords: ['tent house', 'tent wala', 'shamiana', 'टेंट हाउस', 'टेंट वाला'],
    specializations: ['Tent setup', 'Event rental', 'Chairs and tables', 'Canopy setup']
  },
  {
    profession: 'Florist',
    keywords: ['florist', 'flower decorator', 'phool wala', 'फूल वाला', 'फ्लोरिस्ट'],
    specializations: ['Flower decoration', 'Garlands', 'Bouquets', 'Event flowers']
  },
  {
    profession: 'Wedding Band',
    keywords: ['wedding band', 'band baja', 'baraat band', 'बैंड बाजा', 'बारात बैंड'],
    specializations: ['Wedding procession music', 'Brass band', 'Ceremony music']
  },
  {
    profession: 'Safa Tying Service',
    keywords: ['safa tying', 'safa bandhne wala', 'pagdi bandhne wala', 'साफा बांधने वाला', 'पगड़ी बांधने वाला'],
    specializations: ['Turban tying', 'Wedding dress support', 'Baraat styling']
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
