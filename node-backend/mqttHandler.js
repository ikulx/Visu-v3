// src/mqttHandler.js
const mqtt = require('mqtt');
// Direkter Import statt Alias
const { fetchMenuRawFromDB } = require('./menuHandler');

let fetchMenuForFrontendFn = null;
let messageCallback = null;
let mqttTopicLookupMap = new Map(); // Lookup-Map

// Funktion zum Aufbau der MQTT Lookup-Map
async function buildMqttTopicLookupMap(sqliteDB) {
  console.log('[buildMqttTopicLookupMap] Starting map build...');
  const newMap = new Map();
  try {
    const rawMenu = await fetchMenuRawFromDB(sqliteDB); // Direkter Aufruf

    // Robuster Check
    console.log('[buildMqttTopicLookupMap] Received rawMenu from fetchMenuRawFromDB:', JSON.stringify(rawMenu ? rawMenu.menuItems?.length : 'undefined', null, 2)); // Logge nur die Länge

    if (!rawMenu || typeof rawMenu !== 'object') {
        console.error("[buildMqttTopicLookupMap] fetchMenuRawFromDB hat kein Objekt zurückgegeben:", rawMenu);
        mqttTopicLookupMap = newMap;
        return;
    }
     if (!Array.isArray(rawMenu.menuItems)) {
         console.error("[buildMqttTopicLookupMap] rawMenu.menuItems ist kein Array:", rawMenu.menuItems);
         mqttTopicLookupMap = newMap;
         return;
     }

    const processItems = (items) => {
       if (!items || !Array.isArray(items)) return;
        for (const item of items) {
            // Stelle sicher, dass 'item' existiert und 'enable' geprüft werden kann
            if (!item || item.enable !== true) continue; // Überspringe null/undefined/deaktivierte Items

             // Verarbeite Properties
            for (const [propKey, prop] of Object.entries(item.properties || {})) {
                if (prop && prop.source_type === 'mqtt' && prop.source_key) {
                    if (!newMap.has(prop.source_key)) newMap.set(prop.source_key, []);
                    // Verhindere Duplikate
                    if (!newMap.get(prop.source_key).some(entry => entry.menuItemLink === item.link && entry.propertyKey === propKey)) {
                        newMap.get(prop.source_key).push({ menuItemLink: item.link, propertyKey: propKey });
                    }
                }
            }
             // Verarbeite Label
            if (typeof item.label === 'object' && item.label !== null && item.label.source_type === 'mqtt' && item.label.source_key) {
               if (!newMap.has(item.label.source_key)) newMap.set(item.label.source_key, []);
                // Verhindere Duplikate
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
  }
}

// updateCachedMenuData löst jetzt nur noch den Map-Neuaufbau aus
async function updateCachedMenuData(sqliteDB) {
  try {
    await buildMqttTopicLookupMap(sqliteDB);
    console.log('[updateCachedMenuData] MQTT lookup map updated.');
  } catch (err) {
    console.error('[updateCachedMenuData] Fehler beim Aktualisieren der MQTT Map:', err);
  }
}

// setupMqtt (async, mit await für initialen Build)
async function setupMqtt(io, sqliteDB, fetchMenuForFrontend) {
  console.log("[setupMqtt] Initializing MQTT setup...");
  fetchMenuForFrontendFn = fetchMenuForFrontend; // Speichern für spätere Verwendung (falls benötigt)

  await buildMqttTopicLookupMap(sqliteDB); // Warte auf initialen Build

  const mqttClient = mqtt.connect('mqtt://192.168.10.31:1883', {
      protocolVersion: 4,
      clientId: 'visu-backend-' + Math.random().toString(16).substr(2, 8),
      reconnectPeriod: 1000, // ms
      connectTimeout: 30 * 1000, // ms
      clean: true // Beginne mit einer sauberen Session
  });
  const fixedTopic = 'modbus/data'; // Oder '#', um alles zu empfangen und dann zu filtern

  mqttClient.on('connect', () => {
    console.log('Verbunden mit MQTT-Broker');
    mqttClient.subscribe(fixedTopic, { qos: 0 }, (err) => {
      if (err) console.error(`Fehler beim Abonnieren von ${fixedTopic}:`, err);
      else console.log(`Abonniert: ${fixedTopic}`);
    });
  });

  mqttClient.on('message', async (topic, message) => {
    // Optional: Filtern, wenn '#' abonniert wurde
    // if (!topic.startsWith('modbus/data')) return;

    try {
      const payloadArray = JSON.parse(message.toString());
      if (!Array.isArray(payloadArray)) {
        // console.warn('MQTT-Nachricht ist kein Array:', payloadArray); // Kann vorkommen, ggf. weniger loggen
        return;
      }

      const updates = {}; // { 'link.propertyKey': value } oder { 'link.label': value }

      for (const item of payloadArray) {
        const { topic: itemTopic, value } = item;
        if (itemTopic === undefined || value === undefined) {
            // console.warn('Ungültiges MQTT-Item (topic oder value fehlt):', item); // Ggf. weniger loggen
            continue;
        }

        const targets = mqttTopicLookupMap.get(itemTopic);

        if (targets && targets.length > 0) {
          targets.forEach(target => {
            const updateKey = `${target.menuItemLink}.${target.propertyKey}`;
            updates[updateKey] = value;
          });
        }

        // Logging-Handler Callback
        if (messageCallback) {
          messageCallback(itemTopic, value);
        }
      }

      if (Object.keys(updates).length > 0) {
        io.emit('mqtt-property-update', updates); // Sende gesammelte Updates
        // console.log('Gezielte MQTT-Property-Updates gesendet:', updates); // Weniger Logging in Produktion
      }

    } catch (err) {
      console.error(`Fehler beim Verarbeiten von MQTT-Nachricht für Topic '${topic}':`, err, message.toString());
    }
  });

  mqttClient.on('error', (err) => console.error('MQTT-Verbindungsfehler:', err));
  mqttClient.on('reconnect', () => console.log('Versuche, erneut mit MQTT-Broker zu verbinden...'));
  mqttClient.on('close', () => console.log('MQTT-Verbindung geschlossen.'));
  mqttClient.on('offline', () => console.log('MQTT-Client ist offline.'));

  console.log("[setupMqtt] MQTT setup complete.");
  return {
    mqttClient,
    onMessage: (callback) => {
      messageCallback = callback;
    }
  };
}

// checkAndSendMqttUpdates (bleibt vorerst unverändert)
async function checkAndSendMqttUpdates(io, sqliteDB) {
    console.log("[checkAndSendMqttUpdates] Wird ausgeführt...");
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
        const dynamicKeysAndValues = new Map(); // Speichert Key und aktuellen aufgelösten Wert

        // Sammle alle Keys, die von MQTT kommen könnten UND deren aktuelle Werte
        const collectDynamicData = (items) => {
            if (!items || !Array.isArray(items)) return;
            for (const item of items) {
                if (!item || item.enable !== true) continue; // Nur aktivierte Items

                 // Properties prüfen
                 for (const [key, propValue] of Object.entries(item.properties || {})) {
                    // Finde die Rohdaten für dieses Property, um source_type zu prüfen
                    // (Dieser Teil ist ohne Zugriff auf die rohen Daten hier komplexer)
                    // Annahme: Wenn ein Wert da ist, könnte er von MQTT stammen.
                    // Eine bessere Lösung wäre, die Rohdaten hier verfügbar zu haben.
                    // Temporärer Workaround: Sende alle aktuellen Werte.
                    const fullKey = `${item.link}.${key}`;
                    dynamicKeysAndValues.set(fullKey, propValue); // Speichert den aufgelösten Wert
                 }

                 // Label prüfen
                  if(typeof item.label === 'object' && item.label !== null && item.label.source_type === 'mqtt'){
                       const fullKey = `${item.link}.label`;
                       dynamicKeysAndValues.set(fullKey, item.label.value); // Speichert den aufgelösten Label-Wert
                  }


                if (item.sub) {
                    collectDynamicData(item.sub);
                }
            }
        };

        collectDynamicData(currentMenu.menuItems);

        // Vergleiche aktuelle Werte mit MQTT-Map und sende nur, was relevant ist
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
            console.log('[checkAndSendMqttUpdates] Gezielte MQTT-Property-Updates nach Check gesendet:', updates);
        } else {
            console.log('[checkAndSendMqttUpdates] Keine relevanten MQTT-Property-Updates nach Check erforderlich.');
        }
    } catch (err) {
        console.error('[checkAndSendMqttUpdates] Fehler beim Überprüfen der MQTT-Properties:', err);
    }
}


module.exports = { setupMqtt, updateCachedMenuData, checkAndSendMqttUpdates };