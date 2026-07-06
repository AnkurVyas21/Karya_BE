const SUPPORTED_APP_LANGUAGES = ['en', 'hi', 'bn', 'te', 'ta', 'gu', 'pa'];
const SUPPORTED_APP_THEMES = ['light', 'dark'];

const normalizePreferredLanguage = (value = '') => {
  const language = String(value || '').trim().toLowerCase();
  return SUPPORTED_APP_LANGUAGES.includes(language) ? language : 'en';
};

const normalizePreferredTheme = (value = '') => {
  const theme = String(value || '').trim().toLowerCase();
  return theme === 'light' ? 'light' : 'dark';
};

module.exports = {
  SUPPORTED_APP_LANGUAGES,
  SUPPORTED_APP_THEMES,
  normalizePreferredLanguage,
  normalizePreferredTheme
};
