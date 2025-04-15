// src/mqttHandler.js
const mqtt = require('mqtt');
const { fetchMenuRawFromDB } = require('./menuHandler'); // Direkter Import

let fetchMenuForFrontendFn = null;
let mqttTopicLookupMap = new Map(); // Für Menü-Updates
// +++ NEU: Topic für Alarm-Quittierungs-Antwort +++
const ALARM_ACKNOWLEDGE_TOPIC = process.env.MQTT_ALARM_ACK_TOPIC || 'visu/alarm/acknowledge';

async function buildMqttTopicLookupMap(sqliteDB) {
    console.log('[buildMqttTopicLookupMap] Starting map build...');
    const newMap = new Map();
    try {
        const rawMenu = await fetchMenuRawFromDB(sqliteDB);
        if (!rawMenu || !Array.isArray(rawMenu.menuItems)) {
            console.error("[buildMqttTopicLookupMap] fetchMenuRawFromDB did not return a valid menu structure:", rawMenu);
            mqttTopicLookupMap = newMap; // Leere Map setzen
            return; // Kein Fehler werfen, aber Map bleibt leer
        }

        const processItems = (items) => {
           if (!items || !Array.isArray(items)) return;
            for (const item of items) {
                if (!item || item.enable !== true) continue; // Überspringe null/undefined/deaktivierte Items

                // Verarbeite Properties
                for (const [propKey, prop] of Object.entries(item.properties || {})) {
                    if (prop && prop.source_type === 'mqtt' && prop.source_key) {
                        if (!newMap.has(prop.source_key)) newMap.set(prop.source_key, []);
                        if (!newMap.get(prop.source_key).some(entry => entry.menuItemLink === item.link && entry.propertyKey === propKey)) {
                            newMap.get(prop.source_key).push({ menuItemLink: item.link, propertyKey: propKey });
                        }
                    }
                }
                // Verarbeite Label
                if (typeof item.label === 'object' && item.label !== null && item.label.source_type === 'mqtt' && item.label.source_key) {
                   if (!newMap.has(item.label.source_key)) newMap.set(item.label.source_key, []);
                   if (!newMap.get(item.label.source_key).some(entry => entry.menuItemLink === item.link && entry.propertyKey === 'label')) {
                     newMap.get(item.label.source_key).push({ menuItemLink: item.link, propertyKey: 'label' });
                   }
                }
                // Rekursiv Sub-Items verarbeiten
                if (item.sub) processItems(item.sub);
            }
        };

        processItems(rawMenu.menuItems);
        mqttTopicLookupMap = newMap; // Globale Map aktualisieren
        console.log(`[buildMqttTopicLookupMap] Map build successful. Found mappings for ${mqttTopicLookupMap.size} topics.`);

      } catch (err) {
        console.error("[buildMqttTopicLookupMap] Error during map build:", err);
        mqttTopicLookupMap = new Map(); // Leere Map im Fehlerfall
        // Fehler weiterwerfen, damit setupMqtt ihn fangen kann
        throw new Error(`Failed during buildMqttTopicLookupMap: ${err.message}`);
      }
}

async function updateCachedMenuData(sqliteDB) {
    try {
      await buildMqttTopicLookupMap(sqliteDB);
      console.log('[updateCachedMenuData] MQTT lookup map updated.');
    } catch (err) {
      console.error('[updateCachedMenuData] Fehler beim Aktualisieren der MQTT Map:', err);
       // Fehler hier nicht unbedingt weiterwerfen, ist nur ein Update
    }
}

async function setupMqtt(io, sqliteDB, fetchMenuForFrontend) {
  console.log("[setupMqtt] Initializing MQTT setup...");
  fetchMenuForFrontendFn = fetchMenuForFrontend;
  let messageCallbacks = []; // Array für Listener

  try {
      await buildMqttTopicLookupMap(sqliteDB);

      const mqttOptions = {
            protocolVersion: 4,
            clientId: 'visu-backend-' + Math.random().toString(16).substr(2, 8),
            reconnectPeriod: 5000,
            connectTimeout: 30 * 1000,
            clean: true,
       };
      const mqttBrokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://192.168.10.31:1883';
      const mqttClient = mqtt.connect(mqttBrokerUrl, mqttOptions);

      const dataTopic = 'modbus/data';
      // +++ NEU: Topics, die abonniert werden sollen +++
      const topicsToSubscribe = [dataTopic, ALARM_ACKNOWLEDGE_TOPIC];

      mqttClient.on('connect', () => {
          console.log(`[MQTT Handler] Verbunden mit MQTT-Broker: ${mqttBrokerUrl}`);
          // +++ GEÄNDERT: Beide Topics abonnieren +++
          mqttClient.subscribe(topicsToSubscribe, { qos: 0 }, (err, granted) => {
            if (err) {
                console.error(`[MQTT Handler] Fehler beim Abonnieren von Topics [${topicsToSubscribe.join(', ')}]:`, err);
            } else {
                console.log(`[MQTT Handler] Erfolgreich abonniert:`, granted.map(g => `${g.topic} (QoS ${g.qos})`).join(', '));
            }
          });
      });

      // Handler für eingehende Nachrichten
      mqttClient.on('message', async (topic, message) => {
           // +++ NEU: Unterscheidung nach Topic +++
           if (topic === dataTopic) {
                // Verarbeitung für modbus/data
                try {
                    const payloadString = message.toString();
                    const payloadArray = JSON.parse(payloadString);
                    if (!Array.isArray(payloadArray)) return;

                    const menuUpdates = {};
                    for (const item of payloadArray) {
                        const { topic: itemTopic, value } = item; // itemTopic ist der Identifier
                        if (itemTopic === undefined || value === undefined) continue;

                        // Menü-Property-Updates
                        const menuTargets = mqttTopicLookupMap.get(itemTopic);
                        if (menuTargets) {
                           menuTargets.forEach(target => {
                                menuUpdates[`${target.menuItemLink}.${target.propertyKey}`] = value;
                            });
                        }

                        // Callbacks ausführen (Logging, Alarm Verarbeitung)
                        if (messageCallbacks.length > 0) {
                            messageCallbacks.forEach(cb => {
                                try { cb(itemTopic, value); } // Übergibt Identifier und Wert
                                catch (e) { console.error(`[MQTT Handler] Fehler beim Ausführen eines Callbacks für ${itemTopic}:`, e); }
                            });
                        }
                    } // Ende for item in payloadArray

                    if (Object.keys(menuUpdates).length > 0) { io.emit('mqtt-property-update', menuUpdates); }

                } catch (err) { console.error(`[MQTT Handler] Fehler beim Verarbeiten der MQTT-Nachricht auf ${topic}:`, err, message.toString()); }

           } else if (topic === ALARM_ACKNOWLEDGE_TOPIC) {
                // +++ NEU: Verarbeitung für Alarm-Quittierungs-Antwort +++
                const payload = message.toString();
                console.log(`[MQTT Handler] Nachricht auf ${ALARM_ACKNOWLEDGE_TOPIC} empfangen:`, payload);
                // Prüfe, ob der Payload dem erwarteten "false" entspricht
                let ackStatus = null;
                if (payload.toLowerCase() === 'false') {
                    ackStatus = false;
                } else {
                    try {
                       const parsedPayload = JSON.parse(payload);
                       if (parsedPayload && parsedPayload.acknowledged === false) {
                           ackStatus = false;
                       }
                    } catch(e) {
                        console.warn(`[MQTT Handler] Unerwarteter Payload auf ${ALARM_ACKNOWLEDGE_TOPIC}: ${payload}`);
                    }
                }

                // Wenn der Status 'false' ist, sende Event an Clients
                if (ackStatus === false) {
                     console.log(`[MQTT Handler] Sende 'alarm-ack-status' an Clients.`);
                     io.emit('alarm-ack-status', { status: false }); // Event für Frontend
                }
           }
           // Hier könnten weitere else if für andere Topics folgen
      });

      // Andere MQTT Listener (error, reconnect, etc. bleiben)
      mqttClient.on('error', (err) => console.error('[MQTT Handler] MQTT Verbindungsfehler:', err.message));
      mqttClient.on('reconnect', () => console.log('[MQTT Handler] Versuche, erneut mit MQTT-Broker zu verbinden...'));
      mqttClient.on('close', () => console.log('[MQTT Handler] MQTT-Verbindung geschlossen.'));
      mqttClient.on('offline', () => console.log('[MQTT Handler] MQTT-Client ist offline.'));

      console.log("[setupMqtt] MQTT setup complete.");

      // Gültiges Objekt mit Client und Listener-Registrierungsfunktion zurückgeben
      return {
          mqttClient: mqttClient,
          onMessage: (callback) => {
              if (typeof callback === 'function' && !messageCallbacks.includes(callback)) {
                  messageCallbacks.push(callback);
                  console.log('[setupMqtt] Message callback registered. Total listeners:', messageCallbacks.length);
              }
          }
      };

  } catch (error) {
      // Wenn im try-Block ein Fehler auftritt
      console.error("[setupMqtt] FATAL error during MQTT setup:", error);
      throw error; // Fehler weiterwerfen, wird in server.js gefangen
  }
} // Ende setupMqtt


// Prüfung und Versand von MQTT-Updates für Menü-Properties (bleibt unverändert)
async function checkAndSendMqttUpdates(io, sqliteDB) {
    // console.log("[checkAndSendMqttUpdates] Wird ausgeführt...");
    try {
        if (!fetchMenuForFrontendFn) {
            console.error("[checkAndSendMqttUpdates] fetchMenuForFrontendFn ist nicht verfügbar.");
            return;
        }
        const currentMenu = await fetchMenuForFrontendFn(sqliteDB);
        if (!currentMenu || !currentMenu.menuItems) {
            console.warn('[checkAndSendMqttUpdates] Keine Menüdaten verfügbar für MQTT-Überprüfung.');
            return;
        }
        const updates = {};
        const dynamicKeysAndValues = new Map();
        const collectDynamicData = (items) => {
            if (!items || !Array.isArray(items)) return;
            for (const item of items) {
                if (!item || item.enable !== true) continue;
                 for (const [key, propValue] of Object.entries(item.properties || {})) {
                    const fullKey = `${item.link}.${key}`;
                    dynamicKeysAndValues.set(fullKey, propValue);
                 }
                 if(typeof item.label === 'object' && item.label !== null && item.label.source_type === 'mqtt'){
                       const fullKey = `${item.link}.label`;
                       dynamicKeysAndValues.set(fullKey, item.label.value);
                  }
                if (item.sub) collectDynamicData(item.sub);
            }
        };
        collectDynamicData(currentMenu.menuItems);
         for (const [topic, targets] of mqttTopicLookupMap.entries()) {
             for(const target of targets) {
                 const updateKey = `${target.menuItemLink}.${target.propertyKey}`;
                 if (dynamicKeysAndValues.has(updateKey)) {
                     updates[updateKey] = dynamicKeysAndValues.get(updateKey);
                 }
             }
         }
        if (Object.keys(updates).length > 0) {
            io.emit('mqtt-property-update', updates);
            // console.log('[checkAndSendMqttUpdates] Gezielte MQTT-Property-Updates nach Check gesendet:', Object.keys(updates));
        }
    } catch (err) {
        console.error('[checkAndSendMqttUpdates] Fehler beim Überprüfen der MQTT-Properties:', err);
    }
}


module.exports = { setupMqtt, updateCachedMenuData, checkAndSendMqttUpdates };