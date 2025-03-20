// src/i18n.js
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

const resources = {
  de: {
    translation: {
      projektnummerLabel: "Projektnummer:",
      schemanummerLabel: "Schemanummer:",
      "Kreis Seiten": "Kreis Seiten",
      "Kreis2 Seite": "Kreis2 Seite",
      "Kreis3 Seite": "Kreis3 Seite",
      "Dreieck Seite": "Dreieck Seite",
      "EZ": "WÄRMEERZEUGER",
      "EZ01": "Erzeuger 01",
      "EZ02": "Erzeuger 02",
      "EZ03": "Erzeuger 03",
      "EZ04": "Erzeuger 04",
      "EZ05": "Erzeuger 05",
      "EZ06": "Erzeuger 06",
      "BWW": "WARMWASSER",
      "HG": "HEIZGRUPPE",
      "PS": "SPEICHER"

    }
  },
  en: {
    translation: {
      projektnummerLabel: "Project number:",
      schemanummerLabel: "Schema number:",
      "Kreis Seiten": "Circle Pages",
      "Kreis2 Seite": "Circle Page 2",
      "Kreis3 Seite": "Circle Page 3",
      "Dreieck Seite": "Triangle Page",
      "EZ": "HEAT GENERATOR",
      "EZ01": "GENERATOR 01",
      "EZ02": "GENERATOR 02",
      "EZ03": "GENERATOR 03",
      "EZ04": "GENERATOR 04",
      "EZ05": "GENERATOR 05",
      "EZ06": "GENERATOR 06",
      "BWW": "HOT WATER",
      "HG": "HEATING GROUP",
      "PS": "SPEICHER"
    }
  },
  fr: {
    translation: {
      projektnummerLabel: "Numéro de projet:",
      schemanummerLabel: "Numéro de schéma:",
      "Kreis Seiten": "Pages de Cercle",
      "Kreis2 Seite": "Page Cercle 2",
      "Kreis3 Seite": "Page Cercle 3",
      "Dreieck Seite": "Page Triangle",
      "EZ": "GÉNÉRATEURS DE CHALEUR",
      "EZ01": "GÉNÉRATEUR 01",
      "EZ02": "GÉNÉRATEUR 02",
      "EZ03": "GÉNÉRATEUR 03",
      "EZ04": "GÉNÉRATEUR 04",
      "EZ05": "GÉNÉRATEUR 05",
      "EZ06": "GÉNÉRATEUR 06",
      "BWW": "EAU CHAUDE",
      "HG": "GROUPE DE CHAUFFAGE",
      "PS": "SPEICHER"

    }
  },
  it: {
    translation: {
      projektnummerLabel: "Numero del progetto:",
      schemanummerLabel: "Numero schema:",
      "Kreis Seiten": "Pagine del Cerchio",
      "Kreis2 Seite": "Pagina Cerchio 2",
      "Kreis3 Seite": "Pagina Cerchio 3",
      "Dreieck Seite": "Pagina Triangolo",
      "EZ": "GENERATORE DI CALORE",
      "EZ01": "GENERATORE 01",
      "EZ02": "GENERATORE 02",
      "EZ03": "GENERATORE 03",
      "EZ04": "GENERATORE 04",
      "EZ05": "GENERATORE 05",
      "EZ06": "GENERATORE 06",
      "BWW": "ACQUA CALDA",
      "HG": "GRUPPO RISCALDAMENTO",
      "PS": "MEMORIA"

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
      escapeValue: false, // React escaped bereits
    },
  });

export default i18n;
