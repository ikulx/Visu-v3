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

// Funktion zum Abrufen der QHMI-Variablen aus der Datenbank
async function fetchQhmiVariables(sqliteDB) {
  return new Promise((resolve, reject) => {
    sqliteDB.all(
      `SELECT NAME, VAR_VALUE FROM QHMI_VARIABLES`,
      [],
      (err, rows) => {
        if (err) {
          console.error("Fehler beim Abrufen der QHMI-Variablen:", err);
          return reject(err);
        }
        const variables = {};
        rows.forEach(row => {
          variables[row.NAME] = row.VAR_VALUE;
        });
        resolve(variables);
      }
    );
  });
}

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
             ma.id AS action_id, ma.action_name, ma.qhmi_variable_name,
             msc.id AS condition_id, msc.value, msc.svg AS condition_svg
      FROM menu_items mi
      LEFT JOIN menu_properties mp ON mi.id = mp.menu_item_id
      LEFT JOIN menu_actions ma ON mi.id = ma.menu_item_id
      LEFT JOIN menu_svg_conditions msc ON mi.id = msc.menu_item_id
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
          if (!itemMap.has(row.id)) {
            itemMap.set(row.id, {
              link: row.link,
              label: JSON.parse(row.label) || row.label,
              svg: row.svg,
              enable: row.enable === 1,
              qhmiVariable: row.qhmiVariable,
              svgConditions: [],
              properties: {},
              actions: {},
              sub: row.parent_id ? undefined : []
            });
          }
          const item = itemMap.get(row.id);

          // Properties hinzufügen (überschreibt Duplikate durch Schlüssel)
          if (row.key) {
            item.properties[row.key] = {
              value: row.value,
              source_type: row.source_type,
              source_key: row.source_key
            };
          }

          // Actions hinzufügen (vermeide Duplikate durch Überprüfung)
          if (row.action_name && row.qhmi_variable_name) {
            if (!item.actions[row.action_name]) {
              item.actions[row.action_name] = [];
            }
            if (!item.actions[row.action_name].includes(row.qhmi_variable_name)) {
              item.actions[row.action_name].push(row.qhmi_variable_name);
            }
          }

          // SVG Conditions hinzufügen (vermeide Duplikate durch Überprüfung)
          if (row.value && row.condition_svg) {
            const conditionExists = item.svgConditions.some(
              cond => cond.value === row.value && cond.svg === row.condition_svg
            );
            if (!conditionExists) {
              item.svgConditions.push({ value: row.value, svg: row.condition_svg });
            }
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

      if (typeof item.label === 'object' && item.label.source_type === 'dynamic') {
        resolvedLabel = await resolveLabelValue(sqliteDB, item.label);
        resolvedEnable = await new Promise((resolve) => {
          sqliteDB.get(
            `SELECT visible FROM QHMI_VARIABLES WHERE NAME = ?`,
            [item.label.source_key],
            (err, row) => {
              if (err || !row) {
                console.error(`Fehler beim Abrufen von visible für ${item.label.source_key}:`, err);
                resolve(item.enable);
              } else {
                resolve(row.visible === '1' || row.visible === 'true');
              }
            }
          );
        });
      } else if (typeof item.label === 'object') {
        resolvedLabel = await resolveLabelValue(sqliteDB, item.label);
      }

      let resolvedSub = [];
      if (item.sub && item.sub.length > 0) {
        resolvedSub = await resolveLabelsInMenu(sqliteDB, item.sub);
      }

      const properties = {};
      for (const [key, prop] of Object.entries(item.properties)) {
        properties[key] = await resolvePropertyValue(sqliteDB, prop);
      }

      return {
        ...item,
        label: resolvedLabel,
        enable: resolvedEnable,
        properties,
        sub: resolvedSub
      };
    })
  );
}

// Menü für das Frontend vorbereiten
async function fetchMenuForFrontend(sqliteDB) {
  const rawMenu = await fetchMenuRawFromDB(sqliteDB);
  const qhmiVariables = await fetchQhmiVariables(sqliteDB);

  const resolveSvg = (item) => {
    if (item.qhmiVariable) {
      const variableValue = qhmiVariables[item.qhmiVariable];
      const condition = item.svgConditions.find(cond => cond.value === variableValue);
      if (condition) {
        item.svg = condition.svg;
      }
    }
    if (item.sub) {
      item.sub.forEach(subItem => resolveSvg(subItem));
    }
  };

  rawMenu.menuItems.forEach(item => resolveSvg(item));

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
        `INSERT INTO menu_items (label, link, svg, enable, parent_id, sort_order, qhmiVariable) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [labelValue, item.link, item.svg, item.enable ? 1 : 0, parentId, sortOrder, item.qhmiVariable || null],
        function (err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });

    if (item.properties) {
      for (const [key, propData] of Object.entries(item.properties)) {
        const { value, source_type, source_key } =
          typeof propData === 'object' ? propData : { value: propData, source_type: 'static', source_key: null };
        await sqliteDB.run(
          `INSERT INTO menu_properties (menu_item_id, key, value, source_type, source_key) 
           VALUES (?, ?, ?, ?, ?)`,
          [itemId, key, value, source_type || 'static', source_key || null]
        );
      }
    }

    if (item.actions) {
      for (const [actionName, qhmiVariableNames] of Object.entries(item.actions)) {
        for (const qhmiVariableName of qhmiVariableNames) {
          await sqliteDB.run(
            `INSERT INTO menu_actions (menu_item_id, action_name, qhmi_variable_name) 
             VALUES (?, ?, ?)`,
            [itemId, actionName, qhmiVariableName]
          );
        }
      }
    }

    if (item.svgConditions) {
      for (const condition of item.svgConditions) {
        await sqliteDB.run(
          `INSERT INTO menu_svg_conditions (menu_item_id, value, svg) VALUES (?, ?, ?)`,
          [itemId, condition.value, condition.svg]
        );
      }
    }

    if (item.sub && Array.isArray(item.sub)) {
      await insertMenuItems(sqliteDB, item.sub, itemId, 0);
    }
  }
}

// Menü-Update-Handler für Socket.IO
function setupMenuHandlers(io, sqliteDB, updateCachedMenuData) {
  let currentMenu;
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
    console.log('Neuer Client verbunden:', socket.id);
    currentMenu = await fetchMenuForFrontend(sqliteDB);
    socket.emit('menu-update', currentMenu);

    socket.on('update-menu-config', async (newMenu) => {
      try {
        // Lösche alle bestehenden Einträge aus den Tabellen
        await new Promise((resolve, reject) => {
          sqliteDB.serialize(() => {
            sqliteDB.run(`DELETE FROM menu_properties`, [], (err) => err && reject(err));
            sqliteDB.run(`DELETE FROM menu_actions`, [], (err) => err && reject(err));
            sqliteDB.run(`DELETE FROM menu_svg_conditions`, [], (err) => err && reject(err));
            sqliteDB.run(`DELETE FROM menu_items`, [], (err) => err ? reject(err) : resolve());
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
    // Lösche alle bestehenden Einträge aus den Tabellen
    await new Promise((resolve, reject) => {
      sqliteDB.serialize(() => {
        sqliteDB.run(`DELETE FROM menu_properties`, [], (err) => err && reject(err));
        sqliteDB.run(`DELETE FROM menu_actions`, [], (err) => err && reject(err));
        sqliteDB.run(`DELETE FROM menu_svg_conditions`, [], (err) => err && reject(err));
        sqliteDB.run(`DELETE FROM menu_items`, [], (err) => err ? reject(err) : resolve());
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