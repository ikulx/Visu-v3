// src/mqttHandler.js
const mqtt = require('mqtt');

async function fetchMenuRawFromDB(sqliteDB) {
  return new Promise((resolve, reject) => {
    sqliteDB.all(`
      SELECT mi.*, mp.id AS prop_id, mp.key, mp.value, mp.source_type, mp.source_key
      FROM menu_items mi
      LEFT JOIN menu_properties mp ON mi.id = mp.menu_item_id
      ORDER BY mi.sort_order ASC
    `, [], (err, rows) => {
      if (err) {
        console.error("Fehler beim Abrufen des rohen Menüs:", err);
        return reject(err);
      }

      const menuItems = [];
      const itemMap = new Map();

      rows.forEach(row => {
        let parsedLabel;
        try {
          parsedLabel = JSON.parse(row.label);
        } catch (e) {
          parsedLabel = row.label;
        }
        if (!itemMap.has(row.id)) {
          itemMap.set(row.id, {
            link: row.link,
            label: parsedLabel,
            svg: row.svg,
            enable: row.enable === 1,
            properties: {},
            sub: row.parent_id ? undefined : []
          });
        }
        const item = itemMap.get(row.id);
        if (row.key) {
          item.properties[row.key] = {
            value: row.value,
            source_type: row.source_type,
            source_key: row.source_key
          };
        }
      });

      itemMap.forEach((item, id) => {
        const row = rows.find(r => r.id === id);
        if (row.parent_id && itemMap.has(row.parent_id)) {
          itemMap.get(row.parent_id).sub.push(item);
        } else if (!row.parent_id) {
          menuItems.push(item);
        }
      });

      resolve({ menuItems });
    });
  });
}

let cachedMenuData = null;
let fetchMenuForFrontendFn = null;
let messageCallback = null; // Callback für externe Module

function setupMqtt(io, sqliteDB, fetchMenuForFrontend) {
  fetchMenuForFrontendFn = fetchMenuForFrontend;
  const mqttClient = mqtt.connect('mqtt://192.168.10.31:1883', {
    protocolVersion: 4,
    clientId: 'visu-backend-' + Math.random().toString(16).substr(2, 8),
    reconnectPeriod: 1000,
  });
  const fixedTopic = 'modbus/data';

  (async () => {
    try {
      cachedMenuData = await fetchMenuRawFromDB(sqliteDB);
      console.log('Initial Cached Menu Data geladen:', JSON.stringify(cachedMenuData, null, 2));
    } catch (err) {
      console.error('Fehler beim initialen Laden der Menüdaten:', err);
    }
  })();

  mqttClient.on('connect', () => {
    console.log('Verbunden mit MQTT-Broker');
    mqttClient.subscribe(fixedTopic, { qos: 0 }, (err) => {
      if (err) {
        console.error(`Fehler beim Abonnieren von ${fixedTopic}:`, err);
      } else {
        console.log(`Abonniert: ${fixedTopic}`);
      }
    });
  });

  mqttClient.on('message', async (topic, message) => {
    if (topic !== fixedTopic) return;

    try {
      const payload = JSON.parse(message.toString());
      if (!Array.isArray(payload)) {
        console.error('MQTT-Nachricht ist kein Array:', payload);
        return;
      }

      const updates = {};
      for (const item of payload) {
        const { topic: itemTopic, value } = item;
        if (!itemTopic || value === undefined) {
          console.warn('Ungültiges MQTT-Item:', item);
          continue;
        }
        let foundMatch = false;
        for (const menuItem of (cachedMenuData?.menuItems || [])) {
          if (!menuItem.enable) continue;
          for (const [propKey, prop] of Object.entries(menuItem.properties || {})) {
            if (prop && prop.source_type === 'mqtt' && prop.source_key === itemTopic) {
              const updateKey = `${menuItem.link}.${propKey}`;
              updates[updateKey] = value;
              console.log(`Property hinzugefügt: ${updateKey} = ${value}`);
              foundMatch = true;
            }
          }
          if (menuItem.sub) {
            const subFound = processSubItems(menuItem.sub, menuItem.link, itemTopic, value, updates);
            if (subFound) {
              foundMatch = true;
            }
          }
        }
        if (!foundMatch) {
          console.warn(`Kein Treffer für topic '${itemTopic}' in cachedMenuData`);
        }

        // Nachricht an Callback weiterleiten
        if (messageCallback) {
          messageCallback(itemTopic, value);
        }
      }

      if (Object.keys(updates).length > 0) {
        io.emit('mqtt-property-update', updates);
        console.log('MQTT-Property-Update gesendet:', JSON.stringify(updates, null, 2));
      } else {
        console.warn('Keine Updates generiert für die MQTT-Nachricht');
      }
    } catch (err) {
      console.error('Fehler beim Verarbeiten der MQTT-Nachricht:', err);
    }
  });

  function processSubItems(subItems, parentLink, itemTopic, value, updates) {
    let found = false;
    for (const subItem of subItems) {
      if (!subItem.enable) continue;
      for (const [propKey, prop] of Object.entries(subItem.properties || {})) {
        if (prop && prop.source_type === 'mqtt' && prop.source_key === itemTopic) {
          const updateKey = `${subItem.link}.${propKey}`;
          updates[updateKey] = value;
          console.log(`SubItem-Property hinzugefügt: ${updateKey} = ${value}`);
          found = true;
        }
      }
      if (subItem.sub) {
        const subFound = processSubItems(subItem.sub, subItem.link, itemTopic, value, updates);
        if (subFound) {
          found = true;
        }
      }
    }
    return found;
  }

  mqttClient.on('error', (err) => {
    console.error('MQTT-Verbindungsfehler:', err);
  });

  mqttClient.on('reconnect', () => {
    console.log('Versuche, erneut mit MQTT-Broker zu verbinden...');
  });

  return {
    mqttClient,
    onMessage: (callback) => {
      messageCallback = callback; // Callback für externe Module registrieren
    }
  };
}

async function updateCachedMenuData(sqliteDB) {
  try {
    cachedMenuData = await fetchMenuRawFromDB(sqliteDB);
    console.log('Cached Menu Data aktualisiert:', JSON.stringify(cachedMenuData, null, 2));
  } catch (err) {
    console.error('Fehler beim Aktualisieren des Cached Menu Data:', err);
  }
}

async function checkAndSendMqttUpdates(io, sqliteDB) {
  try {
    const currentMenu = await fetchMenuForFrontendFn(sqliteDB);
    if (!currentMenu || !currentMenu.menuItems) {
      console.warn('Keine Menüdaten verfügbar für MQTT-Überprüfung.');
      return;
    }
    const updates = {};
    const dynamicKeys = new Set();
    const collectDynamicKeys = (items) => {
      for (const item of items) {
        if (!item) continue;
        for (const [key, prop] of Object.entries(item.properties || {})) {
          if (prop && prop.source_type === 'mqtt') {
            dynamicKeys.add(`${item.link}.${key}`);
          }
        }
        if (item.sub && Array.isArray(item.sub)) {
          collectDynamicKeys(item.sub);
        }
      }
    };
    if (cachedMenuData?.menuItems) {
      collectDynamicKeys(cachedMenuData.menuItems);
    }
    const collectUpdates = (items) => {
      for (const item of items) {
        if (!item) continue;
        if (item.enable !== true) {
          continue;
        }
        for (const [propKey, propValue] of Object.entries(item.properties || {})) {
          const fullKey = `${item.link}.${propKey}`;
          if (dynamicKeys.has(fullKey)) {
            let sendValue;
            if (propValue && typeof propValue === 'object' && 'value' in propValue) {
              sendValue = propValue.value;
            } else {
              sendValue = propValue;
            }
            updates[fullKey] = sendValue;
          }
        }
        if (item.sub && Array.isArray(item.sub)) {
          collectUpdates(item.sub);
        }
      }
    };
    collectUpdates(currentMenu.menuItems);
    if (Object.keys(updates).length > 0) {
      io.emit('mqtt-property-update', updates);
      console.log('MQTT-Property-Updates gesendet:', JSON.stringify(updates, null, 2));
    } else {
      console.log('Keine MQTT-Property-Updates erforderlich.');
    }
  } catch (err) {
    console.error('Fehler beim Überprüfen der MQTT-Properties:', err);
  }
}

module.exports = { setupMqtt, updateCachedMenuData, checkAndSendMqttUpdates };