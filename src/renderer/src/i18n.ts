import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import hi from './locales/hi.json'

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    hi: { translation: hi }
  },
  // Remember the accountant's language across launches instead of resetting to English.
  lng: localStorage.getItem('pc-lang') ?? 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
})

i18n.on('languageChanged', (lang) => localStorage.setItem('pc-lang', lang))

export default i18n
