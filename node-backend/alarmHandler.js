// src/alarmHandler.js
const sqlite3 = require('sqlite3');
const MQTT_TOPICS = require('./mqttConfig'); // Import der zentralen Topics

// DB Query Hilfsfunktion (unverändert)
function runDbQuery(sqliteDB, sql, params = [], method = 'all') {
    return new Promise((resolve, reject) => {
        if (!sqliteDB) return reject(new Error("Database instance is not provided."));
        if (!['all', 'get', 'run'].includes(method)) return reject(new Error(`Invalid DB method: ${method}`));
        const callback = function (err, result) {
            if (err) { console.error(`[DB ${method.toUpperCase()}] Error: ${sql}`, params, err); reject(err); }
            else { if (method === 'run') resolve({ lastID: this.lastID, changes: this.changes }); else resolve(result); }
        };
        if (method === 'run') sqliteDB.run(sql, params, callback); else sqliteDB[method](sql, params, callback);
    });
}

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
                 if (!identifier) continue;
                 const definitionsRaw = await runDbQuery( this.sqliteDB, 'SELECT * FROM alarm_definitions WHERE config_id = ? AND enabled = 1', [config.id] );
                 const definitionsMap = new Map();
                 definitionsRaw.forEach(def => { definitionsMap.set(def.bit_number, def); });
                 if (definitionsMap.size > 0) {
                    newConfig.set(identifier, { config: config, definitions: definitionsMap });
                    newLastValues.set(identifier, this.lastValues.get(identifier) || null);
                    identifiers.add(identifier);
                 } else { newLastValues.delete(identifier); }
            }
             this.alarmConfigs = newConfig;
             this.lastValues = newLastValues;
             console.log(`[AlarmHandler] Loaded configuration for ${this.alarmConfigs.size} identifiers:`, Array.from(identifiers));
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
             console.log("[AlarmHandler] Active alarms re-evaluated.");
             this.broadcastCurrentAlarms(); // Sendet NUR noch an Socket.IO
        }
     }

    processAlarmData = (identifier, value) => {
        if (!this.alarmConfigs.has(identifier)) return;
        let newValueInt;
        try {
            newValueInt = parseInt(value, 10);
            if (isNaN(newValueInt)) return;
        } catch (e) { console.warn(`[AlarmHandler] Error parsing value for ${identifier}: ${value}`, e); return; }

        const previousValue = this.lastValues.get(identifier);
        if (newValueInt === previousValue && previousValue !== null) return;

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

            if (newBitStatus && !previousBitStatus) { // --- Alarm WIRD AKTIV ---
                console.log(`[AlarmHandler] ---> ALARM ACTIVE: Identifier=${identifier}, Bit=${bit}, DefID=${definition.id}, TextKey=${definition.alarm_text_key}`);

                // +++ MQTT-Nachricht für NEUEN Alarm senden +++
                const newAlarmTopic = MQTT_TOPICS.OUTGOING_NEW_ALARM_EVENT;
                const newAlarmPayload = JSON.stringify({
                    definitionId: definition.id, timestamp: now, status: 'active',
                    identifier: identifier, bitNumber: bit, rawValue: newValueInt,
                    alarmTextKey: definition.alarm_text_key, priority: definition.priority
                });
                if (this.mqttClient && this.mqttClient.connected) {
                    this.mqttClient.publish(newAlarmTopic, newAlarmPayload, { qos: 1, retain: false }, (error) => {
                        if (error) console.error(`[AlarmHandler] Fehler Senden (NEUER Alarm) an MQTT ${newAlarmTopic}:`, error);
                        else console.log(`[AlarmHandler] Neuer Alarm (DefID ${definition.id}) an MQTT ${newAlarmTopic} gesendet.`);
                    });
                } else console.warn(`[AlarmHandler] MQTT nicht verbunden. Neuer Alarm (DefID ${definition.id}) nicht an ${newAlarmTopic} gesendet.`);
                // +++ ENDE MQTT +++

                this.logAlarmEvent(definition, 'active', identifier, newValueInt, now);
                this.currentActiveAlarms.set(definition.id, { definition, timestamp: now });
                activeAlarmsChanged = true;

            } else if (!newBitStatus && previousBitStatus) { // --- Alarm WIRD INAKTIV ---
                console.log(`[AlarmHandler] ---> ALARM INACTIVE: Identifier=${identifier}, Bit=${bit}, DefID=${definition.id}, TextKey=${definition.alarm_text_key}`);
                this.logAlarmEvent(definition, 'inactive', identifier, newValueInt, now);
                this.currentActiveAlarms.delete(definition.id);
                activeAlarmsChanged = true;
            }
        }
        this.lastValues.set(identifier, newValueInt);
        if (activeAlarmsChanged) {
            console.log(`[AlarmHandler.processAlarmData] Alarm status changed for ${identifier}. Broadcasting updates.`);
            this.broadcastCurrentAlarms(); // Sendet NUR noch an Socket.IO
            this.updateFooterAlarmStatus();
        }
    }

    logAlarmEvent = async (definition, status, identifier, rawValue, timestamp) => {
        let definitionId = null, textKey = null, priority = null;
        let effectiveIdentifier = identifier, effectiveRawValue = rawValue;
        if (definition) {
            definitionId = definition.id; textKey = definition.alarm_text_key; priority = definition.priority;
        } else if (status === 'reset') {
            definitionId = null; effectiveIdentifier = identifier || 'USER_ACTION';
            effectiveRawValue = rawValue === undefined ? null : rawValue;
            textKey = 'ALARM_RESET_ACTION'; priority = 'info';
            console.log(`[AlarmHandler.logAlarmEvent] Logging RESET action: ID=${effectiveIdentifier}, Prio=${priority}, Key=${textKey}, TS=${timestamp}`);
        } else { console.error(`[AlarmHandler.logAlarmEvent] Invalid call: status='${status}', no definition.`); return; }

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

    // --- GEÄNDERT: Sendet nur noch an Socket.IO ---
    broadcastCurrentAlarms = () => {
         const activeAlarmsArray = Array.from(this.currentActiveAlarms.values());
         const prioMap = { 'prio1': 5, 'prio2': 4, 'prio3': 3, 'warning': 2, 'info': 1 };
          activeAlarmsArray.sort((a, b) => {
                const prioA = prioMap[a.definition?.priority] || 0;
                const prioB = prioMap[b.definition?.priority] || 0;
                if (prioB !== prioA) return prioB - prioA;
                return new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime();
          });

         // Nur noch an Socket.IO senden
         this.io.emit('alarms-update', activeAlarmsArray);
         console.log(`[AlarmHandler] Broadcasted 'alarms-update' to ${this.io.sockets.sockets.size} clients.`);

         // --- MQTT Broadcast für visu/alarm/data wurde entfernt ---
    }
    // --- ENDE ÄNDERUNG ---

    updateFooterAlarmStatus = () => {
         let highestPrioValue = 0;
         const prioMap = { 'info': 1, 'warning': 2, 'prio3': 3, 'prio2': 4, 'prio1': 5 };
         this.currentActiveAlarms.forEach(alarmInfo => {
            const prioVal = prioMap[alarmInfo.definition.priority] || 0;
            if (prioVal > highestPrioValue) highestPrioValue = prioVal;
         });
         let footerAlarmValue = 1;
         if (highestPrioValue >= 3) footerAlarmValue = 3;
         else if (highestPrioValue === 2) footerAlarmValue = 2;

         if (this.currentFooterAlarmValue !== footerAlarmValue) {
             this.currentFooterAlarmValue = footerAlarmValue;
             if (global.io) {
                 global.io.emit('footer-update', { alarmButton: this.currentFooterAlarmValue });
             }
         }
     }

    setupSocketHandlers = () => {
        this.io.on('connection', (socket) => {
            // console.log(`[AlarmHandler] Client ${socket.id} connected, sending initial state.`);
            const currentActiveAlarmsArray = Array.from(this.currentActiveAlarms.values());
            const prioMap = { 'prio1': 5, 'prio2': 4, 'prio3': 3, 'warning': 2, 'info': 1 };
            currentActiveAlarmsArray.sort((a, b) => { /* ... */ });
            socket.emit('alarms-update', currentActiveAlarmsArray);
            socket.emit('footer-update', { alarmButton: this.currentFooterAlarmValue });

            socket.on('request-current-alarms', () => {
                 const activeAlarmsArray = Array.from(this.currentActiveAlarms.values());
                 /* ... sort ... */
                 socket.emit('alarms-update', activeAlarmsArray);
            });
            socket.on('request-alarm-configs', async () => {
                 try { const configs = await this.getConfigsForClient(); socket.emit('alarm-configs-update', configs); }
                 catch (error) { socket.emit('alarm-configs-error', { message: 'Fehler Laden Konfig.' }); }
            });
            socket.on('update-alarm-configs', async (data) => {
                if (!Array.isArray(data)) return socket.emit('alarm-configs-error', { message: 'Ungültiges Format.' });
                try {
                    await new Promise((resolve, reject) => { /* ... DB Transaction Logic ... */ });
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

            // Listener für Alarm-Quittierung (Reset) vom Frontend (unverändert)
            socket.on('acknowledge-alarms', (data) => {
                 if (!this.mqttClient || !this.mqttClient.connected) { /* ... */ return; }
                 const targetTopic = MQTT_TOPICS.OUTGOING_ALARM_ACK_REQUEST;
                 const payload = "true";
                 const options = { qos: 1, retain: false };
                 this.mqttClient.publish(targetTopic, payload, options, (error) => { /* ... */ });
                 this.logAlarmEvent(null, 'reset', 'USER_ACTION', null, data?.timestamp || new Date().toISOString());
            });

        });
    }

    // Helfer zum Holen der Config für Client (unverändert)
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

// Singleton Instanz und Setup Funktion (unverändert)
let alarmHandlerInstance = null;
function setupAlarmHandler(io, sqliteDB, mqttHandlerInstance, mqttClient) {
    if (!alarmHandlerInstance) {
        alarmHandlerInstance = new AlarmHandler(io, sqliteDB, mqttHandlerInstance, mqttClient);
    }
    return alarmHandlerInstance;
}

module.exports = { setupAlarmHandler };