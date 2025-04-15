// src/alarmHandler.js
const sqlite3 = require('sqlite3');
// const { performVariableUpdate } = require('./dbRoutes'); // Nicht direkt hier benötigt

// DB Query Hilfsfunktion
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

        if (method === 'run') {
            sqliteDB.run(sql, params, callback);
        } else {
            sqliteDB[method](sql, params, callback);
        }
    });
}

// MQTT Topic für Quittierung
const ALARM_ACKNOWLEDGE_TOPIC = process.env.MQTT_ALARM_ACK_TOPIC || 'visu/alarm/acknowledge';

class AlarmHandler {
    // Konstruktor braucht mqttHandler Instanz und mqttClient
    constructor(io, sqliteDB, mqttHandlerInstance, mqttClient) {
        if (!io || !sqliteDB || !mqttHandlerInstance || typeof mqttHandlerInstance.onMessage !== 'function' || !mqttClient) {
            throw new Error("AlarmHandler requires io, sqliteDB, a valid mqttHandlerInstance with onMessage method, and mqttClient.");
        }
        this.io = io;
        this.sqliteDB = sqliteDB;
        this.mqttHandler = mqttHandlerInstance;
        this.mqttClient = mqttClient; // MQTT Client speichern

        // Interne Zustände
        this.alarmConfigs = new Map();
        this.lastValues = new Map();
        this.currentActiveAlarms = new Map();
        this.currentFooterAlarmValue = 1; // Default = OK

        this.initialize();
    }

    initialize = async () => {
        console.log("[AlarmHandler] Initializing...");
        try {
            await this.loadConfig();
            this.registerMqttListener();
            this.setupSocketHandlers();
            console.log("[AlarmHandler] Initialized.");
        } catch (error) {
             console.error("[AlarmHandler] Initialization failed:", error);
        }
    }

    registerMqttListener = () => {
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
                 const definitionsRaw = await runDbQuery( this.sqliteDB, 'SELECT * FROM alarm_definitions WHERE config_id = ? AND enabled = 1', [config.id] );
                 const definitionsMap = new Map();
                 definitionsRaw.forEach(def => { definitionsMap.set(def.bit_number, def); });
                 if (definitionsMap.size > 0) {
                    newConfig.set(identifier, { config: config, definitions: definitionsMap });
                    newLastValues.set(identifier, this.lastValues.get(identifier) || null);
                    identifiers.add(identifier);
                 }
            }
             this.alarmConfigs = newConfig;
             this.lastValues = newLastValues;
             console.log(`[AlarmHandler] Loaded configuration for ${this.alarmConfigs.size} identifiers:`, Array.from(identifiers));
             this.reEvaluateActiveAlarms();
             this.updateFooterAlarmStatus();
        } catch (error) { console.error("[AlarmHandler] Error loading configuration:", error); }
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
            if (!currentlyActive.has(defId)) { this.currentActiveAlarms.delete(defId); changed = true; }
        });
        if (changed) {
             console.log("[AlarmHandler] Active alarms re-evaluated.");
             this.broadcastCurrentAlarms();
             // Footer Update wird durch loadConfig oder processAlarmData getriggert
        }
     }

    processAlarmData = (identifier, value) => {
        if (!this.alarmConfigs.has(identifier)) return;
        let newValueInt;
        try { newValueInt = parseInt(value, 10); if (isNaN(newValueInt)) return; }
        catch (e) { console.warn(`[AlarmHandler] Error parsing value for identifier ${identifier}: ${value}`, e); return; }

        const previousValue = this.lastValues.get(identifier);
        if (newValueInt === previousValue && previousValue !== null) return;

        console.log(`[AlarmHandler.processAlarmData] Processing ${identifier}: Prev=${previousValue}, NewInt=${newValueInt}`);
        const configEntry = this.alarmConfigs.get(identifier);
        const definitions = configEntry.definitions;
        let activeAlarmsChanged = false;
        const now = new Date().toISOString();

        for (let bit = 0; bit < 16; bit++) {
            const definition = definitions.get(bit);
            if (!definition) continue;
            const mask = 1 << bit;
            const newBitStatus = (newValueInt & mask) !== 0;
            const previousBitStatus = (previousValue !== null) ? (previousValue & mask) !== 0 : !newBitStatus;

            if (newBitStatus && !previousBitStatus) { // 0 -> 1 : Active
                console.log(`[AlarmHandler] ---> ALARM ACTIVE: Identifier=${identifier}, Bit=${bit}, DefID=${definition.id}, TextKey=${definition.alarm_text_key}`);
                this.logAlarmEvent(definition, 'active', identifier, newValueInt, now);
                this.currentActiveAlarms.set(definition.id, { definition, timestamp: now });
                activeAlarmsChanged = true;
            } else if (!newBitStatus && previousBitStatus) { // 1 -> 0 : Inactive
                console.log(`[AlarmHandler] ---> ALARM INACTIVE: Identifier=${identifier}, Bit=${bit}, DefID=${definition.id}, TextKey=${definition.alarm_text_key}`);
                this.logAlarmEvent(definition, 'inactive', identifier, newValueInt, now);
                this.currentActiveAlarms.delete(definition.id);
                activeAlarmsChanged = true;
            }
        }
        this.lastValues.set(identifier, newValueInt);
        if (activeAlarmsChanged) {
            console.log(`[AlarmHandler.processAlarmData] Alarm status changed for ${identifier}. Broadcasting updates.`);
            this.broadcastCurrentAlarms();
            this.updateFooterAlarmStatus();
        }
    }

    // +++ START DER ÄNDERUNG: logAlarmEvent angepasst +++
    logAlarmEvent = async (definition, status, identifier, rawValue, timestamp) => {
        let definitionId = null;
        let textKey = null;
        let priority = null;
        let effectiveIdentifier = identifier; // Variable für den tatsächlichen Identifier
        let effectiveRawValue = rawValue; // Variable für den tatsächlichen Rohwert

        if (definition) { // Bestehende Logik für spezifische Alarme
            definitionId = definition.id;
            textKey = definition.alarm_text_key;
            priority = definition.priority;
            // effectiveIdentifier und effectiveRawValue werden aus Parametern übernommen
            console.log(`[AlarmHandler.logAlarmEvent] Logging Specific Alarm: DefID=${definitionId}, Status=${status}, Identifier=${effectiveIdentifier}, RawVal=${effectiveRawValue}, Prio=${priority}, Key=${textKey}, TS=${timestamp}`);
        } else if (status === 'reset') { // Neue Logik für Reset
            definitionId = null; // Keine spezifische Definition
            effectiveIdentifier = identifier || 'USER_ACTION'; // Verwende übergebenen oder Standard-Identifier
            effectiveRawValue = rawValue === undefined ? null : rawValue; // Erlaube explizites null
            textKey = 'ALARM_RESET_ACTION'; // Definiere einen Schlüssel für die Übersetzung
            priority = 'info'; // Weise eine Priorität zu (z.B., 'info')
            console.log(`[AlarmHandler.logAlarmEvent] Logging RESET action: Identifier=${effectiveIdentifier}, Prio=${priority}, Key=${textKey}, TS=${timestamp}`);
        } else {
             console.error(`[AlarmHandler.logAlarmEvent] Invalid call: status is '${status}' but no definition provided.`);
             return; // Oder wirf einen Fehler
        }

        try {
            // SQL angepasst, um priority und alarm_text_key einzufügen
            const sql = `INSERT INTO alarm_history (definition_id, status, mqtt_topic, raw_value, timestamp, priority, alarm_text_key) VALUES (?, ?, ?, ?, ?, ?, ?)`;
            const result = await runDbQuery(
                this.sqliteDB,
                sql,
                [definitionId, status, effectiveIdentifier, effectiveRawValue, timestamp, priority, textKey],
                'run'
            );
            console.log(`[AlarmHandler.logAlarmEvent] DB Insert successful, new history ID: ${result.lastID}`);

            // Broadcast den neuen Eintrag (mit priority und textKey)
            const newHistoryEntry = {
                id: result.lastID,
                definition_id: definitionId,
                status: status,
                mqtt_topic: effectiveIdentifier, // Verwende effectiveIdentifier
                raw_value: effectiveRawValue,     // Verwende effectiveRawValue
                timestamp: timestamp,
                alarm_text_key: textKey,
                priority: priority
            };
            this.io.emit('alarm-history-entry', newHistoryEntry);
        } catch (error) {
            console.error(`[AlarmHandler] Error logging alarm event (Status: ${status}, DefID: ${definitionId}, Topic: ${effectiveIdentifier}):`, error);
        }
    }
    // +++ ENDE DER ÄNDERUNG +++

    broadcastCurrentAlarms = () => {
         const activeAlarmsArray = Array.from(this.currentActiveAlarms.values());
         const prioMap = { 'prio1': 5, 'prio2': 4, 'prio3': 3, 'warning': 2, 'info': 1 };
          activeAlarmsArray.sort((a, b) => { const prioA = prioMap[a.definition?.priority] || 0; const prioB = prioMap[b.definition?.priority] || 0; if (prioB !== prioA) return prioB - prioA; return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(); });
         this.io.emit('alarms-update', activeAlarmsArray);
    }

    updateFooterAlarmStatus = () => {
         let highestPrioValue = 0; const prioMap = { 'info': 1, 'warning': 2, 'prio3': 3, 'prio2': 4, 'prio1': 5 };
         this.currentActiveAlarms.forEach(alarmInfo => { const prioVal = prioMap[alarmInfo.definition.priority] || 0; if (prioVal > highestPrioValue) highestPrioValue = prioVal; });
         let footerAlarmValue = 1;
         if (highestPrioValue >= 3) footerAlarmValue = 3; else if (highestPrioValue === 2) footerAlarmValue = 2;
         this.currentFooterAlarmValue = footerAlarmValue;
         if (global.io) {
             global.io.emit('footer-update', { alarmButton: this.currentFooterAlarmValue });
         }
     }

    setupSocketHandlers = () => {
        this.io.on('connection', (socket) => {
            console.log(`[AlarmHandler] Client ${socket.id} connected, sending initial alarm state & footer status.`);
            const currentActiveAlarmsArray = Array.from(this.currentActiveAlarms.values());
            const prioMap = { 'prio1': 5, 'prio2': 4, 'prio3': 3, 'warning': 2, 'info': 1 };
             currentActiveAlarmsArray.sort((a, b) => { const prioA = prioMap[a.definition?.priority] || 0; const prioB = prioMap[b.definition?.priority] || 0; if (prioB !== prioA) return prioB - prioA; return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(); });
            socket.emit('alarms-update', currentActiveAlarmsArray);
            socket.emit('footer-update', { alarmButton: this.currentFooterAlarmValue });

            socket.on('request-current-alarms', () => {
                 console.log(`[AlarmHandler] Client ${socket.id} explicitly requested current alarms.`);
                 const activeAlarmsArray = Array.from(this.currentActiveAlarms.values());
                 const prioMap = { 'prio1': 5, 'prio2': 4, 'prio3': 3, 'warning': 2, 'info': 1 };
                 activeAlarmsArray.sort((a, b) => { const prioA = prioMap[a.definition?.priority] || 0; const prioB = prioMap[b.definition?.priority] || 0; if (prioB !== prioA) return prioB - prioA; return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(); });
                 socket.emit('alarms-update', activeAlarmsArray);
            });

            socket.on('request-alarm-configs', async () => {
                console.log(`[AlarmHandler] Client ${socket.id} requested alarm configs.`);
                try { const configs = await this.getConfigsForClient(); socket.emit('alarm-configs-update', configs); }
                catch (error) { console.error('[AlarmHandler] Error fetching alarm configs for client:', error); socket.emit('alarm-configs-error', { message: 'Fehler beim Laden der Alarmkonfiguration.' }); }
            });

            socket.on('update-alarm-configs', async (data) => {
                 console.log(`[AlarmHandler] Received update-alarm-configs from ${socket.id}`);
                 if (!Array.isArray(data)) { console.error('[AlarmHandler] Invalid data format for update-alarm-configs.'); return socket.emit('alarm-configs-error', { message: 'Ungültiges Datenformat.' }); }
                 try {
                      await new Promise((resolve, reject) => {
                           this.sqliteDB.run('BEGIN TRANSACTION', async (beginErr) => {
                               if (beginErr) return reject(beginErr);
                               try {
                                    const receivedConfigIds = new Set(data.map(c => c.id).filter(id => id != null));
                                    const existingConfigs = await runDbQuery(this.sqliteDB, 'SELECT id FROM alarm_configs');
                                    const configsToDelete = existingConfigs.filter(c => !receivedConfigIds.has(c.id));
                                    if (configsToDelete.length > 0) { const idsToDelete = configsToDelete.map(c => c.id); console.log('[AlarmHandler] Deleting alarm configs:', idsToDelete); await runDbQuery(this.sqliteDB, `DELETE FROM alarm_configs WHERE id IN (${idsToDelete.map(() => '?').join(',')})`, idsToDelete, 'run'); }

                                    const upsertConfigSql = `INSERT INTO alarm_configs (id, mqtt_topic, description) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET mqtt_topic=excluded.mqtt_topic, description=excluded.description, updated_at=strftime('%Y-%m-%dT%H:%M','now', 'localtime')`;
                                    const insertDefSql = `INSERT INTO alarm_definitions (config_id, bit_number, alarm_text_key, priority, enabled) VALUES (?, ?, ?, ?, ?)`;

                                    for (const config of data) {
                                        let configId = config.id;
                                        if (!config.mqtt_topic || String(config.mqtt_topic).trim() === '') { console.warn(`[AlarmHandler] Skipping config with empty identifier.`); continue; }
                                        const configResult = await runDbQuery(this.sqliteDB, upsertConfigSql, [configId, config.mqtt_topic, config.description], 'run');
                                        if (!configId && configResult.lastID) configId = configResult.lastID;

                                        if (configId) {
                                            const deleteDefResult = await runDbQuery(this.sqliteDB, `DELETE FROM alarm_definitions WHERE config_id = ?`, [configId], 'run');
                                            if (Array.isArray(config.definitions)) {
                                                for (const def of config.definitions) {
                                                    if ((def.enabled || (def.alarm_text_key && def.alarm_text_key.trim() !== '')) && Number.isInteger(def.bit_number) && def.bit_number >= 0 && def.bit_number <= 15) {
                                                        const params = [ configId, def.bit_number, def.alarm_text_key || '', def.priority || 'info', def.enabled ? 1 : 0 ];
                                                        try { await runDbQuery(this.sqliteDB, insertDefSql, params, 'run'); } catch(insertErr){ throw insertErr; }
                                                    }
                                                }
                                            }
                                        } else { console.error(`[AlarmHandler] Invalid configId for identifier ${config.mqtt_topic}.`); }
                                    }
                                    await new Promise((res, rej) => this.sqliteDB.run('COMMIT', commitErr => commitErr ? rej(commitErr) : res()));
                                    resolve();
                               } catch (processErr) { console.error("[AlarmHandler] Fehler während Config-Update-Transaktion, führe Rollback aus:", processErr); this.sqliteDB.run('ROLLBACK', rollbackErr => { if(rollbackErr) console.error("Rollback Error:", rollbackErr); }); reject(processErr); }
                           });
                      });
                      console.log("[AlarmHandler] Config update successful in DB.");
                      await this.loadConfig();
                      const newConfigs = await this.getConfigsForClient();
                      this.io.emit('alarm-configs-update', newConfigs);
                      socket.emit('alarm-configs-success', { message: 'Alarmkonfiguration erfolgreich gespeichert.' });
                 } catch (error) { console.error('[AlarmHandler] Error updating alarm configs:', error); socket.emit('alarm-configs-error', { message: `Fehler beim Speichern: ${error.message}` }); }
            });

            socket.on('request-alarm-history', async (options = {}) => {
                 console.log(`[AlarmHandler] Client ${socket.id} requested alarm history with options:`, options);
                 const limit = Math.max(1, Math.min(options.limit || 50, 200));
                 const offset = Math.max(0, options.offset || 0);
                 try {
                     // +++ GEÄNDERT: Priority und Text Key direkt aus History holen +++
                     const history = await runDbQuery(this.sqliteDB, `SELECT h.id, h.timestamp, h.status, h.mqtt_topic, h.raw_value, h.definition_id, h.alarm_text_key, h.priority FROM alarm_history h ORDER BY h.timestamp DESC LIMIT ? OFFSET ?`, [limit, offset]);
                     const totalCountResult = await runDbQuery(this.sqliteDB, `SELECT COUNT(*) as count FROM alarm_history`, [], 'get');
                     const totalCount = totalCountResult?.count || 0;
                     socket.emit('alarm-history-update', { history: history || [], total: totalCount, limit: limit, offset: offset });
                 } catch (error) { console.error('[AlarmHandler] Error fetching alarm history:', error); socket.emit('alarm-history-error', { message: `Fehler beim Laden der Alarmhistorie: ${error.message}` }); }
            });

            // +++ START DER ÄNDERUNG: Listener für Alarm-Quittierung angepasst +++
            socket.on('acknowledge-alarms', (data) => {
                 console.log(`[AlarmHandler] Received 'acknowledge-alarms' from ${socket.id}. Data:`, data);
                 if (!this.mqttClient || !this.mqttClient.connected) {
                     console.error("[AlarmHandler] Cannot acknowledge alarms: MQTT client not connected.");
                     // Optional: Fehler an den Client zurücksenden
                     // socket.emit('alarm-ack-error', { message: 'MQTT client not connected.' });
                     return;
                 }

                 const payload = "true"; // Sende immer "true" für Reset an MQTT
                 const options = { qos: 1, retain: false };

                 // An MQTT senden
                 this.mqttClient.publish(ALARM_ACKNOWLEDGE_TOPIC, payload, options, (error) => {
                     if (error) {
                         console.error(`[AlarmHandler] Failed to publish acknowledge message to ${ALARM_ACKNOWLEDGE_TOPIC}:`, error);
                     } else {
                         console.log(`[AlarmHandler] Successfully published acknowledge message ('${payload}') to ${ALARM_ACKNOWLEDGE_TOPIC}`);
                     }
                 });

                 // History-Eintrag für Reset hinzufügen
                 const resetTimestamp = data?.timestamp || new Date().toISOString();
                 // Rufe logAlarmEvent auf, um den Reset zu protokollieren
                 // Parameter: (definition=null, status='reset', identifier='USER_ACTION', rawValue=null, timestamp)
                 this.logAlarmEvent(null, 'reset', 'USER_ACTION', null, resetTimestamp);

            }); // Ende acknowledge-alarms Listener
            // +++ ENDE DER ÄNDERUNG +++

        }); // Ende io.on('connection')
    } // Ende setupSocketHandlers

     // Helfer zum Holen der Config für Client
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

// --- Singleton Instanz ---
let alarmHandlerInstance = null;

// Setup-Funktion erwartet jetzt mqttClient explizit
function setupAlarmHandler(io, sqliteDB, mqttHandlerInstance, mqttClient) {
    if (!alarmHandlerInstance) {
        console.log("[setupAlarmHandler] Creating AlarmHandler instance.");
        alarmHandlerInstance = new AlarmHandler(io, sqliteDB, mqttHandlerInstance, mqttClient); // mqttClient übergeben
    } else {
        console.log("[setupAlarmHandler] Returning existing AlarmHandler instance.");
    }
    return alarmHandlerInstance;
}

module.exports = { setupAlarmHandler };