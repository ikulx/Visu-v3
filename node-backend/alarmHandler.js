// src/alarmHandler.js
const sqlite3 = require('sqlite3');
const MQTT_TOPICS = require('./mqttConfig'); // Import der zentralen Topics

// DB Query Hilfsfunktion (sicherstellen, dass sie existiert)
function runDbQuery(sqliteDB, sql, params = [], method = 'all') {
    return new Promise((resolve, reject) => {
        if (!sqliteDB) return reject(new Error("Database instance is not provided."));
        if (!['all', 'get', 'run'].includes(method)) return reject(new Error(`Invalid DB method: ${method}`));
        const callback = function (err, result) { // 'function' für 'this' bei 'run'
            if (err) {
                console.error(`[DB ${method.toUpperCase()}] Error: ${sql}`, params, err);
                reject(err);
            } else {
                if (method === 'run') {
                    resolve({ lastID: this.lastID, changes: this.changes });
                } else {
                    resolve(result);
                }
            }
        };
        if (method === 'run') sqliteDB.run(sql, params, callback); else sqliteDB[method](sql, params, callback);
    });
}


// Konstante für den DB-Schlüssel der Mute-Einstellung
const MQTT_NOTIFICATION_SETTING_KEY = 'mqtt_new_alarm_notifications_enabled';
const SMS_NOTIFICATION_SETTING_KEY = 'sms_notifications_globally_enabled'; // Schlüssel für SMS Status

class AlarmHandler {
    constructor(io, sqliteDB, mqttHandlerInstance, mqttClient) {
        if (!io || !sqliteDB || !mqttHandlerInstance || typeof mqttHandlerInstance.onMessage !== 'function' || !mqttClient) {
            throw new Error("AlarmHandler requires io, sqliteDB, a valid mqttHandlerInstance with onMessage method, and mqttClient.");
        }
        this.io = io;
        this.sqliteDB = sqliteDB;
        this.mqttHandler = mqttHandlerInstance;
        this.mqttClient = mqttClient;
        this.alarmConfigs = new Map();
        this.lastValues = new Map();
        this.currentActiveAlarms = new Map();
        this.currentFooterAlarmValue = 1;
        this.isMqttNotificationEnabled = true; // Defaultwert, wird beim Initialisieren geladen
        this.isSmsNotificationsEnabled = false; // Defaultwert, wird beim Initialisieren geladen
        this.pendingNotifications = new Map(); // Für verzögerte Notifications

        this.initialize();
    }

    initialize = async () => {
        console.log("[AlarmHandler] Initializing...");
        try {
            await this.loadMqttNotificationSetting(); // Mute-Einstellung laden
            await this.loadSmsNotificationSetting(); // SMS Status laden
            await this.loadConfig(); // Alarmkonfiguration laden
            this.registerMqttListener(); // MQTT Listener registrieren
            this.setupSocketHandlers(); // Socket Handler einrichten
            console.log("[AlarmHandler] Initialized.");
        } catch (error) {
             console.error("[AlarmHandler] Initialization failed:", error);
        }
    }

    // Lädt die Mute-Einstellung aus der Datenbank
    loadMqttNotificationSetting = async () => {
        try {
            const settingRow = await runDbQuery(this.sqliteDB,
                'SELECT value FROM global_settings WHERE key = ?',
                [MQTT_NOTIFICATION_SETTING_KEY],
                'get'
            );
            this.isMqttNotificationEnabled = !(settingRow && settingRow.value === 'false');
            console.log(`[AlarmHandler] MQTT New Alarm Notifications Status loaded: ${this.isMqttNotificationEnabled}`);
        } catch (error) {
            console.error("[AlarmHandler] Error loading MQTT notification setting:", error);
            this.isMqttNotificationEnabled = true; // Fallback
            console.warn("[AlarmHandler] Falling back to default MQTT notification status (enabled).");
        }
    }

    // Lädt die SMS-Aktivierungs-Einstellung aus der Datenbank
    loadSmsNotificationSetting = async () => {
        try {
            const settingRow = await runDbQuery(this.sqliteDB,
                'SELECT value FROM global_settings WHERE key = ?',
                [SMS_NOTIFICATION_SETTING_KEY],
                'get'
            );
            this.isSmsNotificationsEnabled = (settingRow && settingRow.value === 'true');
            console.log(`[AlarmHandler] SMS Notifications Globally Enabled Status loaded: ${this.isSmsNotificationsEnabled}`);
        } catch (error) {
            console.error("[AlarmHandler] Error loading SMS notification setting:", error);
            this.isSmsNotificationsEnabled = false; // Fallback auf 'false'
            console.warn("[AlarmHandler] Falling back to default SMS notification status (disabled).");
        }
    }


    registerMqttListener = () => {
        // Hört auf ALLE Nachrichten, die der mqttHandler empfängt
        this.mqttHandler.onMessage(this.processAlarmData);
        console.log("[AlarmHandler] Registered callback with MQTT handler.");
    }

    loadConfig = async () => {
        console.log("[AlarmHandler] Loading alarm configuration from DB...");
        const newConfig = new Map();
        const newLastValues = new Map();
        const identifiers = new Set();
        try {
            const configs = await runDbQuery(this.sqliteDB, 'SELECT * FROM alarm_configs');
            for (const config of configs) {
                 const identifier = config.mqtt_topic;
                 if (!identifier) continue; // Identifier muss vorhanden sein
                 const definitionsRaw = await runDbQuery( this.sqliteDB, 'SELECT * FROM alarm_definitions WHERE config_id = ? AND enabled = 1', [config.id] );
                 const definitionsMap = new Map();
                 definitionsRaw.forEach(def => { definitionsMap.set(def.bit_number, def); });
                 if (definitionsMap.size > 0) {
                    newConfig.set(identifier, { config: config, definitions: definitionsMap });
                    newLastValues.set(identifier, this.lastValues.get(identifier) || null); // Vorhandenen Wert behalten oder null
                    identifiers.add(identifier);
                 } else {
                    newLastValues.delete(identifier); // Wert löschen, wenn keine Defs mehr da sind
                 }
            }
             this.alarmConfigs = newConfig;
             this.lastValues = newLastValues;
             console.log(`[AlarmHandler] Loaded configuration for ${this.alarmConfigs.size} identifiers.`);
             this.reEvaluateActiveAlarms();
             this.updateFooterAlarmStatus();
        } catch (error) {
             console.error("[AlarmHandler] Error loading configuration:", error);
             this.alarmConfigs = new Map(); this.lastValues = new Map(); this.currentActiveAlarms = new Map();
             this.reEvaluateActiveAlarms(); this.updateFooterAlarmStatus();
        }
    }

    reEvaluateActiveAlarms = () => {
        const previouslyActive = new Set(this.currentActiveAlarms.keys());
        const currentlyActive = new Set();
        let changed = false;
        this.lastValues.forEach((value, identifier) => {
            if (value === null || !this.alarmConfigs.has(identifier)) return;
            const configEntry = this.alarmConfigs.get(identifier);
            configEntry.definitions.forEach((definition, bit) => {
                const mask = 1 << bit;
                const isActive = (value & mask) !== 0;
                if (isActive) {
                    currentlyActive.add(definition.id);
                    if (!this.currentActiveAlarms.has(definition.id)) {
                        this.currentActiveAlarms.set(definition.id, { definition, timestamp: new Date().toISOString() });
                        changed = true;
                    }
                }
            });
        });
        previouslyActive.forEach(defId => {
            if (!currentlyActive.has(defId)) {
                this.currentActiveAlarms.delete(defId);
                changed = true;
            }
        });
        if (changed) {
             // console.log("[AlarmHandler] Active alarms re-evaluated.");
             this.broadcastCurrentAlarms(); // Sendet an Socket.IO
        }
     }

    processAlarmData = async (identifier, value) => { // Funktion muss async sein!
        if (!this.alarmConfigs.has(identifier)) return;
        let newValueInt;
        try { newValueInt = parseInt(value, 10); if (isNaN(newValueInt)) return; }
        catch (e) { console.warn(`[AlarmHandler] Error parsing value for ${identifier}: ${value}`, e); return; }

        const previousValue = this.lastValues.get(identifier);
        if (newValueInt === previousValue && previousValue !== null) return;

        const configEntry = this.alarmConfigs.get(identifier);
        const definitions = configEntry.definitions;
        let activeAlarmsChanged = false;
        const now = new Date().toISOString();
        const nowTimestamp = Date.now(); // Für Timer-Berechnungen

        for (let bit = 0; bit < 16; bit++) {
            const definition = definitions.get(bit);
            if (!definition) continue;

            const mask = 1 << bit;
            const newBitStatus = (newValueInt & mask) !== 0;
            const previousBitStatus = (previousValue !== null) ? (previousValue & mask) !== 0 : !newBitStatus;

            if (newBitStatus && !previousBitStatus) { // --- Alarm WIRD AKTIV ---
                console.log(`[AlarmHandler] ---> ALARM ACTIVE: DefID=${definition.id}, Prio=${definition.priority}`);

                // Prüfe globalen Mute-Schalter zuerst
                if (!this.isMqttNotificationEnabled) {
                     console.log(`[AlarmHandler] MQTT Notifications globally disabled. Skipping ALL specific notifications for DefID ${definition.id}.`);
                } else {
                    // --- Sende spezifische Notifications ---
                    try {
                        // 1. Hole alle konfigurierten Notification Targets
                        const notificationTargets = await runDbQuery(this.sqliteDB, 'SELECT id, type, target, priorities, delay_minutes FROM notification_targets');

                        // 2. Finde die Ziele, die diese Priorität abonniert haben
                        const matchingTargets = (notificationTargets || []).filter(target =>
                            (target.priorities || '').split(',').includes(definition.priority)
                        );

                        if (matchingTargets.length > 0) {
                            // console.log(`[AlarmHandler] Found ${matchingTargets.length} targets for alarm DefID ${definition.id} (Prio: ${definition.priority})`);
                            // 3. Sende MQTT Nachricht für jedes passende Ziel
                            const notificationTopic = MQTT_TOPICS.OUTGOING_ALARM_NOTIFICATION; // Neues Topic verwenden
                            const alarmDetails = { // Standardisierte Alarmdetails
                                definitionId: definition.id, timestamp: now, status: 'active',
                                identifier: identifier, bitNumber: bit, rawValue: newValueInt,
                                alarmTextKey: definition.alarm_text_key, priority: definition.priority
                            };

                            for (const target of matchingTargets) {

                                // Prüfung für SMS-Aktivierung
                                if (target.type === 'phone' && !this.isSmsNotificationsEnabled) {
                                    console.log(`[AlarmHandler] Skipping phone notification for ${target.target} (DefID ${definition.id}) because SMS notifications are globally disabled.`);
                                    continue; // Überspringe dieses Ziel
                                }

                                // Verzögerung gilt jetzt für beide Typen, falls > 0
                                const delayMs = (target.delay_minutes > 0)
                                                  ? target.delay_minutes * 60 * 1000
                                                  : 0;
                                const notificationKey = `${definition.id}:${target.id}`; // Eindeutiger Key

                                // Funktion zum Senden der MQTT Nachricht
                                const sendNotification = () => {
                                    this.pendingNotifications.delete(notificationKey); // Timer aus Map entfernen
                                    // ERNEUT PRÜFEN: Ist der Alarm IMMER NOCH aktiv?
                                    if (!this.currentActiveAlarms.has(definition.id)) {
                                         console.log(`[AlarmHandler] Notification cancelled for ${target.target} (DefID ${definition.id}) - Alarm became inactive during delay.`);
                                         return;
                                    }
                                    // Payload erstellen
                                    const notificationPayload = JSON.stringify({
                                        type: target.type, // 'email' oder 'phone'
                                        target: target.target, // Die Adresse/Nummer
                                        alarm: alarmDetails // Die Alarmdetails
                                    });
                                    // Senden
                                    if (this.mqttClient && this.mqttClient.connected) {
                                        this.mqttClient.publish(notificationTopic, notificationPayload, { qos: 1, retain: false }, (error) => {
                                            if (error) console.error(`[AlarmHandler] Fehler Senden (Notification an ${target.target}) an MQTT ${notificationTopic}:`, error);
                                            // else console.log(`[AlarmHandler] Delayed Notification für DefID ${definition.id} an ${target.target} gesendet.`);
                                        });
                                    } else console.warn(`[AlarmHandler] MQTT nicht verbunden bei verzögertem Senden für ${target.target}.`);
                                };

                                // Prüfen ob Verzögerung nötig (unabhängig vom Typ)
                                if (delayMs > 0) {
                                    console.log(`[AlarmHandler] Scheduling notification for ${target.target} (${target.type}) with delay: ${target.delay_minutes} min.`);
                                    // Alten Timer für diesen Key löschen, falls vorhanden
                                    const oldTimerId = this.pendingNotifications.get(notificationKey);
                                    if (oldTimerId) clearTimeout(oldTimerId);
                                    // Neuen Timer starten und ID speichern
                                    const timerId = setTimeout(sendNotification, delayMs);
                                    this.pendingNotifications.set(notificationKey, timerId);
                                } else {
                                    // Sofort senden
                                    // console.log(`[AlarmHandler] Sending immediate notification for ${target.target} (${target.type}).`);
                                    sendNotification(); // Direkter Aufruf
                                }
                            } // Ende for target
                        }
                        // else { console.log(`[AlarmHandler] No matching targets for DefID ${definition.id} (Prio: ${definition.priority}).`); }

                    } catch (dbError) {
                         console.error(`[AlarmHandler] Fehler beim Holen/Verarbeiten der Notification Targets für DefID ${definition.id}:`, dbError);
                    }
                     // --- ENDE Sende spezifische Notifications ---
                } // Ende der Mute-Prüfung

                // Standard-Logik: History + Aktive Liste
                this.logAlarmEvent(definition, 'active', identifier, newValueInt, now);
                this.currentActiveAlarms.set(definition.id, { definition, timestamp: now });
                activeAlarmsChanged = true;

            } else if (!newBitStatus && previousBitStatus) { // --- Alarm WIRD INAKTIV ---
                console.log(`[AlarmHandler] ---> ALARM INACTIVE: DefID=${definition.id}`);

                // --- Laufende Timer für diesen spezifischen Alarm löschen ---
                this.pendingNotifications.forEach((timerId, key) => {
                    const [defIdStr, targetId] = key.split(':');
                    if (defIdStr && parseInt(defIdStr, 10) === definition.id) {
                        clearTimeout(timerId);
                        this.pendingNotifications.delete(key);
                        console.log(`[AlarmHandler] Cancelled pending notification timer (alarm inactive): Key=${key}`);
                    }
                });
                // --- Ende ---

                // Standard-Logik: History + Aktive Liste
                this.logAlarmEvent(definition, 'inactive', identifier, newValueInt, now);
                this.currentActiveAlarms.delete(definition.id);
                activeAlarmsChanged = true;
            }
        } // Ende for loop (bits)

        this.lastValues.set(identifier, newValueInt);
        if (activeAlarmsChanged) {
            // console.log(`[AlarmHandler.processAlarmData] Alarm status changed. Broadcasting updates.`);
            this.broadcastCurrentAlarms(); // Sendet NUR an Socket.IO
            this.updateFooterAlarmStatus();
        }
    } // Ende processAlarmData

    logAlarmEvent = async (definition, status, identifier, rawValue, timestamp) => {
        let definitionId = null, textKey = null, priority = null;
        let effectiveIdentifier = identifier, effectiveRawValue = rawValue;
        if (definition) {
            definitionId = definition.id; textKey = definition.alarm_text_key; priority = definition.priority;
        } else if (status === 'reset') {
            definitionId = null; effectiveIdentifier = identifier || 'USER_ACTION';
            effectiveRawValue = rawValue === undefined ? null : rawValue;
            textKey = 'ALARM_RESET_ACTION'; priority = 'info';
        } else { console.error(`[AlarmHandler.logAlarmEvent] Invalid call.`); return; }

        try {
            const sql = `INSERT INTO alarm_history (definition_id, status, mqtt_topic, raw_value, timestamp, priority, alarm_text_key) VALUES (?, ?, ?, ?, ?, ?, ?)`;
            const result = await runDbQuery( this.sqliteDB, sql, [definitionId, status, effectiveIdentifier, effectiveRawValue, timestamp, priority, textKey], 'run' );
            const newHistoryEntry = {
                id: result.lastID, definition_id: definitionId, status: status, mqtt_topic: effectiveIdentifier,
                raw_value: effectiveRawValue, timestamp: timestamp, alarm_text_key: textKey, priority: priority
            };
            this.io.emit('alarm-history-entry', newHistoryEntry);
        } catch (error) { console.error(`[AlarmHandler] Error logging alarm event:`, error); }
    }

    broadcastCurrentAlarms = () => {
         const activeAlarmsArray = Array.from(this.currentActiveAlarms.values());
         const prioMap = { 'prio1': 5, 'prio2': 4, 'prio3': 3, 'warning': 2, 'info': 1 };
          activeAlarmsArray.sort((a, b) => {
                const prioA = prioMap[a.definition?.priority] || 0;
                const prioB = prioMap[b.definition?.priority] || 0;
                if (prioB !== prioA) return prioB - prioA;
                return new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime();
          });
         this.io.emit('alarms-update', activeAlarmsArray);
         // console.log(`[AlarmHandler] Broadcasted 'alarms-update' to clients.`);
    }

    updateFooterAlarmStatus = () => {
         let highestPrioValue = 0;
         const prioMap = { 'info': 1, 'warning': 2, 'prio3': 3, 'prio2': 4, 'prio1': 5 };
         this.currentActiveAlarms.forEach(alarmInfo => {
             const prioVal = prioMap[alarmInfo.definition?.priority] || 0;
             if (prioVal > highestPrioValue) highestPrioValue = prioVal;
         });
         let footerAlarmValue = 1;
         if (highestPrioValue >= 3) footerAlarmValue = 3; else if (highestPrioValue === 2) footerAlarmValue = 2;
         if (this.currentFooterAlarmValue !== footerAlarmValue) {
             this.currentFooterAlarmValue = footerAlarmValue;
             if (global.io) global.io.emit('footer-update', { alarmButton: this.currentFooterAlarmValue });
         }
     }

    setupSocketHandlers = () => {
        this.io.on('connection', (socket) => {
            // console.log(`[AlarmHandler] Client ${socket.id} connected.`);
            // Initialen Status senden (Alarme, Footer, Mute-Status, SMS-Status)
            const currentActiveAlarmsArray = Array.from(this.currentActiveAlarms.values());
            const prioMap = { 'prio1': 5, 'prio2': 4, 'prio3': 3, 'warning': 2, 'info': 1 };
            currentActiveAlarmsArray.sort((a, b) => { /* ... Sortierung ... */ });
            socket.emit('alarms-update', currentActiveAlarmsArray);
            socket.emit('footer-update', { alarmButton: this.currentFooterAlarmValue });
            socket.emit('mqtt-notification-status-update', { enabled: this.isMqttNotificationEnabled });
            socket.emit('sms-notification-status-update', { enabled: this.isSmsNotificationsEnabled }); // SMS Status senden

            // Bestehende Listener
            socket.on('request-current-alarms', () => {
                 const activeAlarmsArray = Array.from(this.currentActiveAlarms.values());
                 /* ... Sortierung ... */
                 socket.emit('alarms-update', activeAlarmsArray);
            });
            socket.on('request-alarm-configs', async () => {
                 try { const configs = await this.getConfigsForClient(); socket.emit('alarm-configs-update', configs); }
                 catch (error) { socket.emit('alarm-configs-error', { message: 'Fehler Laden Konfig.' }); }
            });
            socket.on('update-alarm-configs', async (data) => {
                 if (!Array.isArray(data)) return socket.emit('alarm-configs-error', { message: 'Ungültiges Format.' });
                 try {
                     await new Promise((resolve, reject) => { this.sqliteDB.run('BEGIN TRANSACTION', async (beginErr) => { /* ... DB Transaction Logic ... */ }); });
                     await this.loadConfig();
                     const newConfigs = await this.getConfigsForClient();
                     this.io.emit('alarm-configs-update', newConfigs);
                     socket.emit('alarm-configs-success', { message: 'Konfig gespeichert.' });
                 } catch (error) { socket.emit('alarm-configs-error', { message: `Fehler Speichern: ${error.message}` }); }
             });
             socket.on('request-alarm-history', async (options = {}) => {
                  const limit = Math.max(1, Math.min(options.limit || 50, 200));
                  const offset = Math.max(0, options.offset || 0);
                  try {
                      const history = await runDbQuery(this.sqliteDB, `SELECT h.id, h.timestamp, h.status, h.mqtt_topic, h.raw_value, h.definition_id, h.alarm_text_key, h.priority FROM alarm_history h ORDER BY h.timestamp DESC LIMIT ? OFFSET ?`, [limit, offset]);
                      const totalCountResult = await runDbQuery(this.sqliteDB, `SELECT COUNT(*) as count FROM alarm_history`, [], 'get');
                      socket.emit('alarm-history-update', { history: history || [], total: totalCountResult?.count || 0, limit: limit, offset: offset });
                  } catch (error) { socket.emit('alarm-history-error', { message: `Fehler Laden Historie: ${error.message}` }); }
             });
             socket.on('acknowledge-alarms', (data) => {
                  if (!this.mqttClient || !this.mqttClient.connected) { return; }
                  const targetTopic = MQTT_TOPICS.OUTGOING_ALARM_ACK_REQUEST;
                  this.mqttClient.publish(targetTopic, "true", { qos: 1, retain: false }, (error) => { if(error) console.error(`Fehler publish an ${targetTopic}:`, error); else console.log(`Reset request publiziert an ${targetTopic}`); });
                  this.logAlarmEvent(null, 'reset', 'USER_ACTION', null, data?.timestamp || new Date().toISOString());
             });
            socket.on('request-mqtt-notification-status', () => {
                 socket.emit('mqtt-notification-status-update', { enabled: this.isMqttNotificationEnabled });
            });
            socket.on('set-mqtt-notification-status', async (data) => {
                 if (typeof data?.enabled !== 'boolean') { return; }
                 const newState = data.enabled;
                 const newStateString = newState ? 'true' : 'false';
                 console.log(`[AlarmHandler] Client ${socket.id} setzt MQTT notification status auf: ${newState}`);
                 try {
                     await runDbQuery(this.sqliteDB, `INSERT INTO global_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [MQTT_NOTIFICATION_SETTING_KEY, newStateString], 'run');
                     this.isMqttNotificationEnabled = newState;
                     this.io.emit('mqtt-notification-status-update', { enabled: this.isMqttNotificationEnabled });
                     console.log(`[AlarmHandler] MQTT notification status auf ${newState} gesetzt und broadcastet.`);
                 } catch (error) {
                     console.error(`[AlarmHandler] Fehler beim Speichern/Broadcasten des MQTT notification status:`, error);
                 }
            });

            // --- Listener für Notification Targets (mit Logging & Delay) ---
            socket.on('request-notification-targets', async () => {
                console.log(`[AlarmHandler] Received 'request-notification-targets' from ${socket.id}`);
                try {
                    // delay_minutes mit abfragen
                    const targets = await runDbQuery(this.sqliteDB, 'SELECT id, type, target, priorities, delay_minutes FROM notification_targets ORDER BY type, target');
                    console.log(`[AlarmHandler] Sending 'notification-targets-update' with ${targets?.length || 0} targets to ${socket.id}`);
                    socket.emit('notification-targets-update', targets || []);
                } catch (error) {
                    console.error('[AlarmHandler] Error fetching notification targets:', error);
                    socket.emit('notification-targets-error', { message: 'Fehler beim Laden der Benachrichtigungsziele.' });
                }
            });

            socket.on('add-notification-target', async (data) => {
                console.log(`[AlarmHandler] Received add-notification-target from ${socket.id}:`, data);
                // Validierung: delay_minutes ist jetzt für beide Typen optional aber muss eine Zahl >= 0 sein
                if (!data || !['email', 'phone'].includes(data.type) || !data.target || typeof data.target !== 'string' || !Array.isArray(data.priorities) || (data.delay_minutes != null && (typeof data.delay_minutes !== 'number' || data.delay_minutes < 0))) {
                    return socket.emit('notification-targets-error', { message: 'Ungültige Daten zum Hinzufügen.' });
                }
                const target = data.target.trim();
                const prioritiesString = data.priorities.join(',');
                // Delay für beide Typen übernehmen, default 0
                const delayMinutes = (typeof data.delay_minutes === 'number') ? Math.max(0, Math.floor(data.delay_minutes)) : 0;

                if (!target) return socket.emit('notification-targets-error', { message: 'Ziel darf nicht leer sein.' });

                try {
                    // delay_minutes immer speichern
                    await runDbQuery(this.sqliteDB,
                        'INSERT INTO notification_targets (type, target, priorities, delay_minutes) VALUES (?, ?, ?, ?)',
                        [data.type, target, prioritiesString, delayMinutes],
                        'run'
                    );
                    const targets = await runDbQuery(this.sqliteDB, 'SELECT id, type, target, priorities, delay_minutes FROM notification_targets ORDER BY type, target');
                    this.io.emit('notification-targets-update', targets || []); // An alle senden
                } catch (error) {
                    console.error('[AlarmHandler] Error adding notification target:', error);
                    if (error.message && error.message.includes('UNIQUE constraint failed')) socket.emit('notification-targets-error', { message: `"${target}" (${data.type}) existiert bereits.` });
                    else socket.emit('notification-targets-error', { message: 'Fehler beim Hinzufügen des Ziels.' });
                }
            });

            socket.on('update-notification-target', async (data) => {
                 console.log(`[AlarmHandler] Received update-notification-target from ${socket.id}:`, data);
                 // Validierung: delay_minutes ist jetzt für beide Typen optional aber muss eine Zahl >= 0 sein
                  if (!data || typeof data.id !== 'number' || !Array.isArray(data.priorities) || (data.delay_minutes != null && (typeof data.delay_minutes !== 'number' || data.delay_minutes < 0))) {
                      return socket.emit('notification-targets-error', { message: 'Ungültige Daten zum Aktualisieren.' });
                  }
                  const prioritiesString = data.priorities.join(',');
                  // Delay für beide Typen übernehmen, default 0
                  const delayMinutes = (typeof data.delay_minutes === 'number') ? Math.max(0, Math.floor(data.delay_minutes)) : 0;

                 try {
                     // delay_minutes immer speichern
                     const result = await runDbQuery(this.sqliteDB,
                         'UPDATE notification_targets SET priorities = ?, delay_minutes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                         [prioritiesString, delayMinutes, data.id],
                         'run'
                     );
                     if (result.changes === 0) throw new Error("Target not found or no changes made.");
                     const targets = await runDbQuery(this.sqliteDB, 'SELECT id, type, target, priorities, delay_minutes FROM notification_targets ORDER BY type, target');
                     this.io.emit('notification-targets-update', targets || []);
                 } catch (error) {
                     console.error('[AlarmHandler] Error updating notification target:', error);
                     socket.emit('notification-targets-error', { message: 'Fehler beim Aktualisieren des Ziels.' });
                 }
             });

             socket.on('delete-notification-target', async (data) => {
                 console.log(`[AlarmHandler] Received delete-notification-target from ${socket.id}:`, data);
                 if (!data || typeof data.id !== 'number') {
                      return socket.emit('notification-targets-error', { message: 'Ungültige ID zum Löschen.' });
                 }
                 try {
                      const result = await runDbQuery(this.sqliteDB, 'DELETE FROM notification_targets WHERE id = ?', [data.id], 'run');
                      if (result.changes === 0) throw new Error("Target not found for delete.");
                      // Laufende Timer für dieses Ziel löschen
                      this.pendingNotifications.forEach((timerId, key) => {
                          const [defId, targetId] = key.split(':');
                          if (targetId && parseInt(targetId, 10) === data.id) {
                              clearTimeout(timerId);
                              this.pendingNotifications.delete(key);
                              console.log(`[AlarmHandler] Cancelled pending notification timer (target deleted): Key=${key}`);
                          }
                      });
                      const targets = await runDbQuery(this.sqliteDB, 'SELECT id, type, target, priorities, delay_minutes FROM notification_targets ORDER BY type, target');
                      this.io.emit('notification-targets-update', targets || []);
                  } catch (error) {
                      console.error('[AlarmHandler] Error deleting notification target:', error);
                      socket.emit('notification-targets-error', { message: 'Fehler beim Löschen des Ziels.' });
                  }
             });
             // --- Ende Listener für Notification Targets ---

             // --- Listener für SMS Notification Status (mit Logging & DB Check auf Payload-User) ---
             socket.on('request-sms-notification-status', () => {
                 console.log(`[AlarmHandler] Received 'request-sms-notification-status' from ${socket.id}`);
                 socket.emit('sms-notification-status-update', { enabled: this.isSmsNotificationsEnabled });
             });

             socket.on('set-sms-notification-status', async (data) => {
                 // Benutzer aus den empfangenen Daten holen (wird vom Frontend mitgesendet)
                 const currentUserRole = data?.user;
                 const socketId = socket.id;
                 console.log(`[AlarmHandler] Received 'set-sms-notification-status' from User: ${currentUserRole} (${socketId}), Data:`, data);

                 // Backend-Autorisierungsprüfung
                 if (!['admin', 'fachmann'].includes(currentUserRole)) {
                      console.warn(`[AlarmHandler] User ${currentUserRole || 'unknown'} (${socketId}) attempt to change SMS status denied.`);
                      return; // Keine Berechtigung
                  }

                 if (typeof data?.enabled !== 'boolean') {
                     console.warn(`[AlarmHandler] Invalid data payload for set-sms-notification-status.`);
                     return;
                 }
                 const newState = data.enabled;
                 const newStateString = newState ? 'true' : 'false';

                 try {
                     // Einstellung in DB speichern (UPSERT)
                     console.log(`[AlarmHandler] Updating DB: key='${SMS_NOTIFICATION_SETTING_KEY}', value='${newStateString}'`);
                     const dbResult = await runDbQuery(this.sqliteDB,
                         `INSERT INTO global_settings (key, value) VALUES (?, ?)
                          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
                         [SMS_NOTIFICATION_SETTING_KEY, newStateString],
                         'run'
                     );
                     console.log(`[AlarmHandler] DB update result for SMS status: changes=${dbResult.changes}`);

                     // Internen Zustand aktualisieren
                     this.isSmsNotificationsEnabled = newState;

                     // Neuen Status an ALLE Clients broadcasten
                     console.log(`[AlarmHandler] Broadcasting 'sms-notification-status-update': enabled=${newState}`);
                     this.io.emit('sms-notification-status-update', { enabled: this.isSmsNotificationsEnabled });

                 } catch (error) {
                     console.error(`[AlarmHandler] Error saving/broadcasting SMS notification status:`, error);
                 }
             });
             // --- Ende Listener für SMS Status ---

        }); // Ende io.on('connection')
    } // Ende setupSocketHandlers

    getConfigsForClient = async () => {
         const configs = await runDbQuery(this.sqliteDB, 'SELECT * FROM alarm_configs ORDER BY mqtt_topic ASC');
         const definitions = await runDbQuery(this.sqliteDB, 'SELECT * FROM alarm_definitions ORDER BY config_id ASC, bit_number ASC');
         const configMap = new Map();
         configs.forEach(c => configMap.set(c.id, { ...c, definitions: [] }));
         definitions.forEach(d => {
             if (configMap.has(d.config_id)) {
                 configMap.get(d.config_id).definitions.push({ id: d.id, config_id: d.config_id, bit_number: d.bit_number, alarm_text_key: d.alarm_text_key || '', priority: d.priority || 'info', enabled: !!d.enabled });
             }
         });
         return Array.from(configMap.values());
     }

} // Ende Klasse AlarmHandler

// Singleton Instanz und Setup Funktion
let alarmHandlerInstance = null;
function setupAlarmHandler(io, sqliteDB, mqttHandlerInstance, mqttClient) {
    if (!alarmHandlerInstance) {
        alarmHandlerInstance = new AlarmHandler(io, sqliteDB, mqttHandlerInstance, mqttClient);
    }
    return alarmHandlerInstance;
}
module.exports = { setupAlarmHandler };