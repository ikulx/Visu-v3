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
        if (!itemMap.has(row.id)) {
          itemMap.set(row.id, {
            link: row.link,
            label: row.label,
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

function setupMqtt(io, sqliteDB, fetchMenuFromDB) {
  const mqttClient = mqtt.connect('mqtt://192.168.10.31:1883'); // Ersetzen Sie mit Ihrem MQTT-Broker-URL
  const fixedTopic = 'modbus/data';

  mqttClient.on('connect', () => {
    console.log('Verbunden mit MQTT-Broker');
    mqttClient.subscribe(fixedTopic, (err) => {
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

      // Hole die rohe Menüstruktur
      const menuData = await fetchMenuRawFromDB(sqliteDB);

      // Aktualisiere die mqtt-Properties direkt im menuData-Objekt
      for (const item of payload) {
        const { topic: itemTopic, value } = item;
        if (!itemTopic || value === undefined) {
          console.warn('Ungültiges MQTT-Item:', item);
          continue;
        }

        // Durchsuche menuItems nach passenden mqtt-Properties
        for (const menuItem of menuData.menuItems) {
          for (const [propKey, prop] of Object.entries(menuItem.properties)) {
            if (prop.source_type === 'mqtt' && prop.source_key === itemTopic) {
              menuItem.properties[propKey].value = value; // Setze den Wert direkt
            }
          }
          if (menuItem.sub) {
            updateSubItems(menuItem.sub, itemTopic, value);
          }
        }
      }

      // Sende das aktualisierte Menü an alle Clients
      io.emit('menu-update', menuData);
      console.log('MQTT-Update verarbeitet und gesendet:', payload);
    } catch (err) {
      console.error('Fehler beim Verarbeiten der MQTT-Nachricht:', err);
    }
  });

  function updateSubItems(subItems, itemTopic, value) {
    for (const subItem of subItems) {
      for (const [propKey, prop] of Object.entries(subItem.properties)) {
        if (prop.source_type === 'mqtt' && prop.source_key === itemTopic) {
          subItem.properties[propKey].value = value;
        }
      }
      if (subItem.sub) {
        updateSubItems(subItem.sub, itemTopic, value);
      }
    }
  }

  mqttClient.on('error', (err) => {
    console.error('MQTT-Verbindungsfehler:', err);
  });

  return mqttClient;
}

module.exports = { setupMqtt };