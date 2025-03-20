// src/i18n.js
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

const resources = {
  de: {
    translation: {
      projektnummerLabel: "Projektnummer:",
      schemanummerLabel: "Schemanummer:"
    }
  },
  en: {
    translation: {
      projektnummerLabel: "Project number:",
      schemanummerLabel: "Schema number:"
    }
  },
  fr: {
    translation: {
      projektnummerLabel: "Numéro de projet:",
      schemanummerLabel: "Numéro de schéma:"
    }
  },
  it: {
    translation: {
      projektnummerLabel: "Numero del progetto:",
      schemanummerLabel: "Numero schema:"
    }
  }
};

i18n
  .use(LanguageDetector) // erkennt automatisch die Sprache des Browsers
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false, // React bereits escaped
    },
  });

export default i18n;
