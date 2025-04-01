// src/menuHandler.js
const sqlite3 = require('sqlite3').verbose();

// Standard-Menü – Label als Objekt (dynamisch möglich)
const defaultMenu = {
  menuItems: [
    {
      link: '/',
      label: { value: 'Home', source_type: 'static', source_key: '' },
      svg: 'home',
      properties: {
        "Anlagenamen": { value: "Init", source_type: "static", source_key: "" },
        "Projektnummer": { value: "x", source_type: "static", source_key: "" },
        "Schemanummer": { value: "y", source_type: "static", source_key: "" }
      },
      sub: []
    }
  ]
};

// Funktion zum Auflösen dynamischer Properties (wie bisher)
async function resolvePropertyValue(sqliteDB, property) {
  if (property.source_type === 'static') {
    return property.value;
  } else if (property.source_type === 'dynamic') {
    return new Promise((resolve) => {
      sqliteDB.get(
        `SELECT VAR_VALUE FROM QHMI_VARIABLES WHERE NAME = ?`,
        [property.source_key],
        (err, row) => {
          resolve(err || !row ? null : row.VAR_VALUE);
        }
      );
    });
  } else if (property.source_type === 'mqtt') {
    return null;
  }
  return null;
}

// Neue Funktion zum Auflösen des Labels
async function resolveLabelValue(sqliteDB, label) {
  if (typeof label !== 'object') return label;
  if (label.source_type === 'static') {
    return label.value;
  } else if (label.source_type === 'dynamic') {
    return new Promise((resolve) => {
      sqliteDB.get(
        `SELECT VAR_VALUE FROM QHMI_VARIABLES WHERE NAME = ?`,
        [label.source_key],
        (err, row) => {
          resolve(err || !row ? null : row.VAR_VALUE);
        }
      );
    });
  } else if (label.source_type === 'mqtt') {
    return null;
  }
  return null;
}

// Rohe Menüdaten aus der Datenbank abrufen
async function fetchMenuRawFromDB(sqliteDB) {
  return new Promise((resolve, reject) => {
    sqliteDB.all(
      `
      SELECT mi.*, mp.id AS prop_id, mp.key, mp.value, mp.source_type, mp.source_key,
             ma.id AS action_id, ma.action_name, ma.qhmi_variable_name
      FROM menu_items mi
      LEFT JOIN menu_properties mp ON mi.id = mp.menu_item_id
      LEFT JOIN menu_actions ma ON mi.id = ma.menu_item_id
      ORDER BY mi.sort_order ASC
    `,
      [],
      (err, rows) => {
        if (err) {
          console.error("Fehler beim Abrufen des rohen Menüs:", err);
          return reject(err);
        }

        const menuItems = [];
        const itemMap = new Map();

        rows.forEach((row) => {
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
              actions: {},
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
          if (row.action_name && row.qhmi_variable_name) {
            if (!item.actions[row.action_name]) {
              item.actions[row.action_name] = [];
            }
            item.actions[row.action_name].push(row.qhmi_variable_name);
          }
        });

        itemMap.forEach((item, id) => {
          const row = rows.find((r) => r.id === id);
          if (row.parent_id && itemMap.has(row.parent_id)) {
            itemMap.get(row.parent_id).sub.push(item);
          } else if (!row.parent_id) {
            menuItems.push(item);
          }
        });

        resolve({ menuItems });
      }
    );
  });
}


// Rekursive Funktion zum Auflösen dynamischer Labels und Properties in der Menüstruktur
async function resolveLabelsInMenu(sqliteDB, items) {
  return Promise.all(
    items.map(async (item) => {
      let resolvedLabel = item.label;
      let resolvedEnable = item.enable;

      // Prüfen, ob das Label ein Objekt ist und dynamisch aufgelöst werden muss
      if (typeof item.label === 'object' && item.label.source_type === 'dynamic') {
        resolvedLabel = await resolveLabelValue(sqliteDB, item.label);

        // Zusätzlich das 'visible'-Feld aus QHMI_VARIABLES abrufen und 'enable' setzen
        resolvedEnable = await new Promise((resolve) => {
          sqliteDB.get(
            `SELECT visible FROM QHMI_VARIABLES WHERE NAME = ?`,
            [item.label.source_key],
            (err, row) => {
              if (err || !row) {
                console.error(`Fehler beim Abrufen von visible für ${item.label.source_key}:`, err);
                resolve(item.enable); // Fallback auf ursprünglichen Wert
              } else {
                // Konvertiere 'visible' (VARCHAR) zu einem Boolean-Wert für 'enable'
                resolve(row.visible === '1' || row.visible === 'true');
              }
            }
          );
        });
      } else if (typeof item.label === 'object') {
        resolvedLabel = await resolveLabelValue(sqliteDB, item.label);
      }

      // Untermenüs rekursiv auflösen
      let resolvedSub = [];
      if (item.sub && item.sub.length > 0) {
        resolvedSub = await resolveLabelsInMenu(sqliteDB, item.sub);
      }

      // Properties auflösen
      const properties = {};
      for (const [key, prop] of Object.entries(item.properties)) {
        properties[key] = await resolvePropertyValue(sqliteDB, prop);
      }

      return {
        ...item,
        label: resolvedLabel,
        enable: resolvedEnable, // Aktualisiertes enable-Feld
        properties,
        sub: resolvedSub
      };
    })
  );
}

// Menü für das Frontend vorbereiten – hier werden die dynamischen Labels und Properties neu aus QHMI_VARIABLES gelesen.
async function fetchMenuForFrontend(sqliteDB) {
  const rawMenu = await fetchMenuRawFromDB(sqliteDB);
  const menuItems = await resolveLabelsInMenu(sqliteDB, rawMenu.menuItems);
  return { menuItems };
}

// Menüeinträge in die Datenbank einfügen
async function insertMenuItems(sqliteDB, items, parentId = null, sortOrderStart = 0) {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const sortOrder = sortOrderStart + i;
    const labelValue = typeof item.label === 'object' ? JSON.stringify(item.label) : item.label;
    const itemId = await new Promise((resolve, reject) => {
      sqliteDB.run(
        `INSERT INTO menu_items (label, link, svg, enable, parent_id, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
        [labelValue, item.link, item.svg, item.enable ? 1 : 0, parentId, sortOrder],
        function (err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });

    if (item.properties) {
      for (const [key, propData] of Object.entries(item.properties)) {
        const { value, source_type, source_key } =
          typeof propData === 'object' && propData !== null
            ? propData
            : { value: propData, source_type: 'static', source_key: null };
        const insertValue = source_type === 'static' ? value : null;

        await sqliteDB.run(
          `INSERT INTO menu_properties (menu_item_id, key, value, source_type, source_key) VALUES (?, ?, ?, ?, ?)`,
          [itemId, key, insertValue, source_type || 'static', source_key || null]
        );
      }
    }

    if (item.actions) {
      for (const [actionName, qhmiVariableNames] of Object.entries(item.actions)) {
        for (const qhmiVariableName of qhmiVariableNames) {
          await sqliteDB.run(
            `INSERT INTO menu_actions (menu_item_id, action_name, qhmi_variable_name) VALUES (?, ?, ?)`,
            [itemId, actionName, qhmiVariableName]
          );
        }
      }
    }

    if (item.sub && Array.isArray(item.sub)) {
      await insertMenuItems(sqliteDB, item.sub, itemId, 0);
    }
  }
}

// Menü-Update-Handler für Socket.IO
function setupMenuHandlers(io, sqliteDB, updateCachedMenuData, fetchMenuForFrontend) {
  let currentMenu;
  // Initiales Laden des Menüs (dynamische Werte werden hier noch nicht zwingend benötigt)
  (async () => {
    try {
      currentMenu = await fetchMenuForFrontend(sqliteDB);
      console.log('Menü für Frontend geladen.');
    } catch (err) {
      console.warn('Fehler beim Laden des Menüs – verwende Default-Menü.');
      currentMenu = defaultMenu;
    }
  })();

  io.on('connection', async (socket) => {
    // Vor dem Senden des Menüs an den Client werden die dynamischen Labels und Properties neu aus der QHMI_VARIABLES gelesen.
    currentMenu = await fetchMenuForFrontend(sqliteDB);
    socket.emit('menu-update', currentMenu);

    socket.on('update-menu-config', async (newMenu) => {
      try {
        await new Promise((resolve, reject) => {
          sqliteDB.run(`DELETE FROM menu_properties`, [], (err) => {
            if (err) reject(err);
            sqliteDB.run(`DELETE FROM menu_items`, [], (err) => (err ? reject(err) : resolve()));
          });
        });

        await insertMenuItems(sqliteDB, newMenu.menuItems, null, 0);
        const rawMenu = await fetchMenuRawFromDB(sqliteDB);
        currentMenu = await fetchMenuForFrontend(sqliteDB);

        await updateCachedMenuData(sqliteDB);

        console.log('Updated menu before sending:', JSON.stringify(currentMenu, null, 2));
        socket.emit('menu-config-success', { message: 'Menü erfolgreich aktualisiert', menu: rawMenu });
        socket.broadcast.emit('menu-update', currentMenu);
        socket.emit('menu-update', currentMenu);
      } catch (err) {
        console.error('Fehler beim Aktualisieren des Menüs:', err);
        socket.emit('menu-config-error', { message: 'Fehler beim Speichern des Menüs' });
      }
    });

    socket.on('request-menu-config', async () => {
      try {
        const rawMenu = await fetchMenuRawFromDB(sqliteDB);
        socket.emit('menu-config-update', rawMenu);
      } catch (err) {
        console.error('Fehler beim Abrufen der Menükonfiguration:', err);
        socket.emit('menu-config-error', { message: 'Fehler beim Abrufen der Menükonfiguration' });
      }
    });
  });

  return { currentMenu, fetchMenuForFrontend };
}

// API-Handler für Menü-Updates
async function updateMenuHandler(req, res, sqliteDB, fetchMenuForFrontend) {
  const newMenu = req.body;
  try {
    await new Promise((resolve, reject) => {
      sqliteDB.run(`DELETE FROM menu_properties`, [], (err) => {
        if (err) reject(err);
        sqliteDB.run(`DELETE FROM menu_items`, [], (err) => (err ? reject(err) : resolve()));
      });
    });

    await insertMenuItems(sqliteDB, newMenu.menuItems, null, 0);
    const currentMenu = await fetchMenuForFrontend(sqliteDB);
    io.emit('menu-update', currentMenu);
    res.sendStatus(200);
  } catch (err) {
    console.error('Fehler beim Aktualisieren des Menüs:', err);
    res.status(500).send('Fehler beim Aktualisieren des Menüs');
  }
}

// API-Handler für Properties-Updates
async function updatePropertiesHandler(req, res, sqliteDB, fetchMenuForFrontend) {
  const { link, properties } = req.body;
  try {
    const menuItem = await new Promise((resolve, reject) => {
      sqliteDB.get(`SELECT id FROM menu_items WHERE link = ?`, [link], (err, row) => {
        if (err) reject(err);
        else if (!row) reject(new Error('Menu item not found'));
        else resolve(row);
      });
    });

    for (const [key, value] of Object.entries(properties)) {
      await sqliteDB.run(
        `UPDATE menu_properties SET value = ?, updated_at = strftime('%Y-%m-%dT%H:%M','now', 'localtime')
         WHERE menu_item_id = ? AND key = ?`,
        [value, menuItem.id, key]
      );
    }

    const currentMenu = await fetchMenuForFrontend(sqliteDB);
    io.emit('menu-update', currentMenu);
    res.sendStatus(200);
  } catch (err) {
    console.error('Fehler beim Aktualisieren der Properties:', err);
    res.status(404).send('Menu item or property not found');
  }
}

module.exports = {
  fetchMenuRawFromDB,
  fetchMenuForFrontend,
  insertMenuItems,
  setupMenuHandlers,
  updateMenuHandler,
  updatePropertiesHandler,
  defaultMenu
};
