// Translation system for One Workout a Day. Each language file (lang-xx.js) registers its text here.
// English (lang-en.js) is the master: any key a language is missing falls back to English.
const I18n = (() => {
  const DEFAULT_CODE = "en";
  const languages = {};
  let code = DEFAULT_CODE;

  // definition: { name (in its own language), dir ("ltr" or "rtl"), locale (for dates and numbers), strings }
  function register(languageCode, definition) {
    languages[languageCode] = definition;
  }

  function available() {
    return Object.entries(languages).map(([languageCode, definition]) => ({ code: languageCode, name: definition.name }));
  }

  function isSupported(languageCode) {
    return Object.prototype.hasOwnProperty.call(languages, languageCode);
  }

  function setLanguage(languageCode) {
    if (isSupported(languageCode)) code = languageCode;
  }

  // The first browser-preferred language we have text for, else English.
  function detect(preferredTags) {
    for (const tag of preferredTags || []) {
      const base = tag.toLowerCase().split("-")[0];
      if (isSupported(base)) return base;
    }
    return DEFAULT_CODE;
  }

  const current = () => code;
  const direction = () => languages[code].dir || "ltr";
  const locale = () => languages[code].locale;

  function lookup(key) {
    const own = languages[code].strings[key];
    return own !== undefined ? own : languages[DEFAULT_CODE].strings[key];
  }

  function fill(template, params) {
    return template.replace(/\{(\w+)\}/g, (match, name) => (params[name] !== undefined ? params[name] : match));
  }

  function has(key) {
    return lookup(key) !== undefined;
  }

  function t(key, params = {}) {
    const template = lookup(key);
    return template === undefined ? key : fill(template, params);
  }

  // Chooses the right word form for a count, using the language's own plural rules.
  // Looks for "key.one", "key.few", ... and falls back to "key.other".
  function plural(key, count, params = {}) {
    const category = new Intl.PluralRules(locale()).select(count);
    const template = lookup(`${key}.${category}`);
    return fill(template !== undefined ? template : lookup(`${key}.other`), { count, ...params });
  }

  // Dates are stored as "YYYY-MM-DD"; build them in local time so the day never shifts.
  function parseDate(dateString) {
    const [year, month, day] = dateString.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function formatDate(dateString) {
    return new Intl.DateTimeFormat(locale(), { dateStyle: "medium" }).format(parseDate(dateString));
  }

  function formatShortDate(dateString) {
    return new Intl.DateTimeFormat(locale(), { month: "short", day: "numeric" }).format(parseDate(dateString));
  }

  // "60 days" in the current language.
  function daysText(count) {
    return new Intl.NumberFormat(locale(), { style: "unit", unit: "day", unitDisplay: "long" }).format(count);
  }

  // "3 weeks" in the current language.
  function weeksText(count) {
    return new Intl.NumberFormat(locale(), { style: "unit", unit: "week", unitDisplay: "long" }).format(count);
  }

  // "today", "yesterday", "3 days ago" in the current language.
  function daysAgoText(count) {
    return new Intl.RelativeTimeFormat(locale(), { numeric: "auto" }).format(-count, "day");
  }

  return {
    register,
    available,
    isSupported,
    setLanguage,
    detect,
    current,
    direction,
    locale,
    has,
    t,
    plural,
    formatDate,
    formatShortDate,
    daysText,
    weeksText,
    daysAgoText,
  };
})();
