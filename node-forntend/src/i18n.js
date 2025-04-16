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
      "PS": "SPEICHER",
      // Neue Übersetzungen für Verbindungsfehler
      connectionLostTitle: "Verbindungsproblem",
      connectionLost: "Verbindung zum Server unterbrochen",
      connectionError: "Verbindungsfehler: {{message}}",
      reconnectError: "Wiederverbindungsfehler: {{message}}",
      initialConnectionError: "Keine Verbindung zum Server beim Start",
      reconnecting: "Versuche, die Verbindung wiederherzustellen...",
      Realtime:"Live",
      Range:"Bereich",
      from:"von",
      to:"bis",
      ALARM_RESET_ACTION:"RESET",
      alarmNotificationsSuppressed: "Alarmmeldungen unterdrückt!", // <<< NEU
      mqttNotificationsEnabled: "MQTT Alarm-Benachrichtigungen aktiviert.", // <<< NEU (für message.info)
      mqttNotificationsDisabled: "MQTT Alarm-Benachrichtigungen deaktiviert.", // <<< NEU (für message.info)
      disableMqttNotificationsTooltip: "MQTT-Benachrichtigungen für neue Alarme deaktivieren", // <<< NEU
      enableMqttNotificationsTooltip: "MQTT-Benachrichtigungen für neue Alarme aktivieren", // <<< NEU
      alarmsTitle: "Alarme & Meldungen", // <<< NEU
      close: "Schließen", // <<< NEU
      reset: "Reset", // <<< NEU
      currentAlarms: "Aktuelle Alarme", // <<< NEU
      alarmHistory: "Historie", // <<< NEU
      status_active: "Aktiv", // <<< NEU
      status_inactive: "Inaktiv", // <<< NEU
      status_reset: "Reset", // <<< NEU
      noActiveAlarms: "Keine aktiven Alarme", // <<< NEU
      noAlarmHistory: "Keine Alarmhistorie verfügbar", // <<< NEU
      paginationText: "{{start}}-{{end}} von {{total}} Einträgen", // <<< NEU
      errorLoadingHistory: "Fehler beim Laden der Historie.", // <<< NEU
      errorLoadingActiveAlarms: "Fehler beim Laden der aktiven Alarme.", // <<< NEU
      resetConfirmed: "Reset vom System bestätigt.", // <<< NEU
      // Prioritäten (Beispiel)
      priority_prio1: "Prio 1",
      priority_prio2: "Prio 2",
      priority_prio3: "Prio 3",
      priority_warning: "Warnung",
      priority_info: "Info",
      priority_default: "Unbekannt",
      userSettings: "Benutzer", // <<< NEU: Für den Button
      userSettingsTitle: "Benutzereinstellungen", // <<< NEU: Für den Popup-Titel
      currentUser: "Aktueller Benutzer", // <<< NEU
      userSettingsPlaceholder: "Weitere Einstellungen folgen...", // <<< NEU
      notLoggedIn: "Nicht angemeldet.", // <<< NEU
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
      "PS": "STORAGE",
      Heizgruppen: "Heating groups",
      // Neue Übersetzungen für Verbindungsfehler
      connectionLostTitle: "Connection Issue",
      connectionLost: "Connection to server lost",
      connectionError: "Connection error: {{message}}",
      reconnectError: "Reconnection error: {{message}}",
      initialConnectionError: "No connection to server on startup",
      reconnecting: "Attempting to reconnect...",
      Realtime:"Live",
      Range:"Range",
      from:"from",
      to:"to",
      ALARM_RESET_ACTION:"RESET",
      alarmNotificationsSuppressed: "Alarm notifications suppressed!", // <<< NEU
      mqttNotificationsEnabled: "MQTT alarm notifications enabled.", // <<< NEU
      mqttNotificationsDisabled: "MQTT alarm notifications disabled.", // <<< NEU
      disableMqttNotificationsTooltip: "Disable MQTT notifications for new alarms", // <<< NEU
      enableMqttNotificationsTooltip: "Enable MQTT notifications for new alarms", // <<< NEU
      alarmsTitle: "Alarms & Messages", // <<< NEU
      close: "Close", // <<< NEU
      reset: "Reset", // <<< NEU
      currentAlarms: "Current Alarms", // <<< NEU
      alarmHistory: "History", // <<< NEU
      status_active: "Active", // <<< NEU
      status_inactive: "Inactive", // <<< NEU
      status_reset: "Reset", // <<< NEU
      noActiveAlarms: "No active alarms", // <<< NEU
      noAlarmHistory: "No alarm history available", // <<< NEU
      paginationText: "{{start}}-{{end}} of {{total}} entries", // <<< NEU
      errorLoadingHistory: "Error loading history.", // <<< NEU
      errorLoadingActiveAlarms: "Error loading active alarms.", // <<< NEU
      resetConfirmed: "Reset confirmed by system.", // <<< NEU
      // Priorities (Example)
      priority_prio1: "Prio 1",
      priority_prio2: "Prio 2",
      priority_prio3: "Prio 3",
      priority_warning: "Warning",
      priority_info: "Info",
      priority_default: "Unknown",
      userSettings: "User", // <<< NEU
      userSettingsTitle: "User Settings", // <<< NEU
      currentUser: "Current User", // <<< NEU
      userSettingsPlaceholder: "More settings will follow...", // <<< NEU
      notLoggedIn: "Not logged in.", // <<< NEU
      
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
      "PS": "STOCKAGE",
      // Neue Übersetzungen für Verbindungsfehler
      connectionLostTitle: "Problème de connexion",
      connectionLost: "Connexion au serveur perdue",
      connectionError: "Erreur de connexion: {{message}}",
      reconnectError: "Erreur de reconnexion: {{message}}",
      initialConnectionError: "Aucune connexion au serveur au démarrage",
      reconnecting: "Tentative de reconnexion...",
      Realtime:"Live",
      Range:"Secteur",
      from:"de",
      to:"à",
      ALARM_RESET_ACTION:"RESET",
      alarmNotificationsSuppressed: "Notifications d'alarme supprimées!", // <<< NEU
      mqttNotificationsEnabled: "Notifications d'alarme MQTT activées.", // <<< NEU
      mqttNotificationsDisabled: "Notifications d'alarme MQTT désactivées.", // <<< NEU
      disableMqttNotificationsTooltip: "Désactiver les notifications MQTT pour les nouvelles alarmes", // <<< NEU
      enableMqttNotificationsTooltip: "Activer les notifications MQTT pour les nouvelles alarmes", // <<< NEU
      alarmsTitle: "Alarmes & Messages", // <<< NEU
      close: "Fermer", // <<< NEU
      reset: "Réinitialiser", // <<< NEU
      currentAlarms: "Alarmes Actuelles", // <<< NEU
      alarmHistory: "Historique", // <<< NEU
      status_active: "Actif", // <<< NEU
      status_inactive: "Inactif", // <<< NEU
      status_reset: "Réinitialisé", // <<< NEU
      noActiveAlarms: "Aucune alarme active", // <<< NEU
      noAlarmHistory: "Aucun historique d'alarme disponible", // <<< NEU
      paginationText: "{{start}}-{{end}} sur {{total}} entrées", // <<< NEU
      errorLoadingHistory: "Erreur lors du chargement de l'historique.", // <<< NEU
      errorLoadingActiveAlarms: "Erreur lors du chargement des alarmes actives.", // <<< NEU
      resetConfirmed: "Réinitialisation confirmée par le système.", // <<< NEU
      // Priorités (Exemple)
      priority_prio1: "Prio 1",
      priority_prio2: "Prio 2",
      priority_prio3: "Prio 3",
      priority_warning: "Avertissement",
      priority_info: "Info",
      priority_default: "Inconnue",
      userSettings: "Utilisateur", // <<< NEU
      userSettingsTitle: "Paramètres utilisateur", // <<< NEU
      currentUser: "Utilisateur actuel", // <<< NEU
      userSettingsPlaceholder: "D'autres paramètres suivront...", // <<< NEU
      notLoggedIn: "Non connecté.", // <<< NEU
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
      "PS": "MEMORIA",
      // Neue Übersetzungen für Verbindungsfehler
      connectionLostTitle: "Problema di connessione",
      connectionLost: "Connessione al server persa",
      connectionError: "Errore di connessione: {{message}}",
      reconnectError: "Errore di riconnessione: {{message}}",
      initialConnectionError: "Nessuna connessione al server all'avvio",
      reconnecting: "Tentativo di riconnessione...",
      Realtime:"Live",
      Range:"Settore",
      from:"da",
      to:"a",
      ALARM_RESET_ACTION:"RESET",
      alarmNotificationsSuppressed: "Notifiche di allarme soppresse!", // <<< NEU
      mqttNotificationsEnabled: "Notifiche di allarme MQTT abilitate.", // <<< NEU
      mqttNotificationsDisabled: "Notifiche di allarme MQTT disabilitate.", // <<< NEU
      disableMqttNotificationsTooltip: "Disabilita notifiche MQTT per nuovi allarmi", // <<< NEU
      enableMqttNotificationsTooltip: "Abilita notifiche MQTT per nuovi allarmi", // <<< NEU
      alarmsTitle: "Allarmi & Messaggi", // <<< NEU
      close: "Chiudi", // <<< NEU
      reset: "Reset", // <<< NEU
      currentAlarms: "Allarmi Attuali", // <<< NEU
      alarmHistory: "Storico", // <<< NEU
      status_active: "Attivo", // <<< NEU
      status_inactive: "Inattivo", // <<< NEU
      status_reset: "Reset", // <<< NEU
      noActiveAlarms: "Nessun allarme attivo", // <<< NEU
      noAlarmHistory: "Nessuno storico allarmi disponibile", // <<< NEU
      paginationText: "{{start}}-{{end}} di {{total}} voci", // <<< NEU
      errorLoadingHistory: "Errore durante il caricamento dello storico.", // <<< NEU
      errorLoadingActiveAlarms: "Errore durante il caricamento degli allarmi attivi.", // <<< NEU
      resetConfirmed: "Reset confermato dal sistema.", // <<< NEU
      // Priorità (Esempio)
      priority_prio1: "Prio 1",
      priority_prio2: "Prio 2",
      priority_prio3: "Prio 3",
      priority_warning: "Avviso",
      priority_info: "Info",
      priority_default: "Sconosciuta",
      userSettings: "Utente", // <<< NEU
      userSettingsTitle: "Impostazioni utente", // <<< NEU
      currentUser: "Utente corrente", // <<< NEU
      userSettingsPlaceholder: "Altre impostazioni seguiranno...", // <<< NEU
      notLoggedIn: "Non connesso.", // <<< NEU
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