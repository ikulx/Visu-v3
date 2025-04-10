// src/menuHandler.js
const sqlite3 = require('sqlite3').verbose();

// Standard-Menü – Label als Objekt (dynamisch möglich)
const defaultMenu = {
  menuItems: [
    {
      link: '/',
      label: { value: 'Home', source_type: 'static', source_key: '' }, // Beispiel für Objekt-Label
      svg: 'home',
      enable: true,
      properties: {
        "Anlagenamen": { value: "Default Anlage", source_type: "static", source_key: "" },
        "Projektnummer": { value: "0000", source_type: "static", source_key: "" },
        "Schemanummer": { value: "0000", source_type: "static", source_key: "" }
      },
      actions: {},
      svgConditions: [],
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
          console.error("[fetchQhmiVariables] Fehler beim Abrufen der QHMI-Variablen:", err);
          return reject(err);
        }
        const variables = {};
        if (rows && Array.isArray(rows)) {
             rows.forEach(row => {
               if (row && row.NAME) { // Sicherstellen, dass row und NAME existieren
                   variables[row.NAME] = row.VAR_VALUE;
               }
             });
        }
        resolve(variables);
      }
    );
  });
}

// Funktion zum Auflösen dynamischer Properties
async function resolvePropertyValue(sqliteDB, property) {
  if (!property || !property.source_type) {
      return property && property.value !== undefined ? property.value : null;
  }

  if (property.source_type === 'static') {
    return property.value;
  } else if (property.source_type === 'dynamic' && property.source_key) {
    return new Promise((resolve) => {
      sqliteDB.get(
        `SELECT VAR_VALUE FROM QHMI_VARIABLES WHERE NAME = ?`,
        [property.source_key],
        (err, row) => {
          const fallbackValue = property.value !== undefined ? property.value : null;
          resolve(err || !row ? fallbackValue : row.VAR_VALUE);
        }
      );
    });
  } else if (property.source_type === 'mqtt') {
    return property.value; // Gebe den zuletzt bekannten Wert zurück (oder Initialwert aus DB)
  }
  return property.value; // Fallback
}

// Funktion zum Auflösen des Labels
async function resolveLabelValue(sqliteDB, label) {
  if (typeof label !== 'object' || label === null || !label.source_type) {
      return label;
  }
  if (label.source_type === 'static') {
    return label.value;
  } else if (label.source_type === 'dynamic' && label.source_key) {
    return new Promise((resolve) => {
      sqliteDB.get(
        `SELECT VAR_VALUE FROM QHMI_VARIABLES WHERE NAME = ?`,
        [label.source_key],
        (err, row) => {
          const fallbackValue = label.value !== undefined ? label.value : '?';
          resolve(err || !row ? fallbackValue : row.VAR_VALUE);
        }
      );
    });
  } else if (label.source_type === 'mqtt') {
    return label.value; // Fallback/Initialwert
  }
  return label.value; // Fallback
}

// Funktion zum Abrufen der rohen Menüdaten aus der Datenbank (mit mehr Logging)
async function fetchMenuRawFromDB(sqliteDB) {
  console.log("[fetchMenuRawFromDB] Trying to fetch raw menu data..."); // Log Start
  return new Promise((resolve, reject) => {
    // Stelle sicher, dass die DB-Instanz gültig ist
    if (!sqliteDB || typeof sqliteDB.all !== 'function') {
        console.error("[fetchMenuRawFromDB] Ungültige sqliteDB Instanz übergeben.");
        return reject(new Error("Ungültige Datenbankinstanz."));
    }

    sqliteDB.all(
      `
      SELECT mi.*, mp.id AS prop_id, mp.key, mp.value, mp.source_type, mp.source_key,
             ma.id AS action_id, ma.action_name, ma.qhmi_variable_name,
             msc.id AS condition_id, msc.value AS condition_value, msc.svg AS condition_svg -- Alias für value hinzugefügt
      FROM menu_items mi
      LEFT JOIN menu_properties mp ON mi.id = mp.menu_item_id
      LEFT JOIN menu_actions ma ON mi.id = ma.menu_item_id
      LEFT JOIN menu_svg_conditions msc ON mi.id = msc.menu_item_id
      ORDER BY mi.id ASC, mi.sort_order ASC
      `,
      [],
      (err, rows) => {
        if (err) {
          console.error("[fetchMenuRawFromDB] Fehler beim Abrufen des rohen Menüs:", err);
          return reject(err);
        }

        console.log(`[fetchMenuRawFromDB] SQL query successful, received ${rows ? rows.length : 'null'} rows.`);

        const menuItems = [];
        const itemMap = new Map(); // Map zur Deduplizierung von menu_items

        if (rows && Array.isArray(rows)) {
          rows.forEach((row) => {
              if (!row || row.id == null) return;

              if (!itemMap.has(row.id)) {
                  let parsedLabel;
                  try {
                      parsedLabel = row.label && typeof row.label === 'string' ? JSON.parse(row.label) : row.label;
                  } catch (e) {
                      parsedLabel = row.label;
                  }

                  itemMap.set(row.id, {
                    id: row.id,
                    link: row.link,
                    label: parsedLabel,
                    svg: row.svg,
                    enable: row.enable === 1,
                    qhmiVariable: row.qhmiVariable,
                    svgConditions: [],
                    properties: {},
                    actions: {},
                    parent_id: row.parent_id,
                    sort_order: row.sort_order,
                    sub: undefined
                  });
              }
              const item = itemMap.get(row.id);

              // Properties hinzufügen
              if (row.prop_id != null && row.key && !item.properties[row.key]) {
                  item.properties[row.key] = {
                    value: row.value,
                    source_type: row.source_type,
                    source_key: row.source_key
                  };
              }

              // Actions hinzufügen
              if (row.action_id != null && row.action_name && row.qhmi_variable_name) {
                  if (!item.actions[row.action_name]) {
                    item.actions[row.action_name] = [];
                  }
                  if (!item.actions[row.action_name].includes(row.qhmi_variable_name)) {
                       item.actions[row.action_name].push(row.qhmi_variable_name);
                  }
              }

              // SVG Conditions hinzufügen
              if (row.condition_id != null && row.condition_value != null && row.condition_svg != null) {
                   const conditionExists = item.svgConditions.some(
                     cond => cond.value === row.condition_value && cond.svg === row.condition_svg
                   );
                   if (!conditionExists) {
                        item.svgConditions.push({ value: row.condition_value, svg: row.condition_svg });
                   }
              }
          });

          // Hierarchie aufbauen und sortieren
          itemMap.forEach((item) => {
            if (item.parent_id && itemMap.has(item.parent_id)) {
              const parent = itemMap.get(item.parent_id);
              if (!parent.sub) parent.sub = [];
              parent.sub.push(item);
            } else if (!item.parent_id) {
              if (!item.sub) item.sub = []; // Sicherstellen, dass Top-Level 'sub' hat
              menuItems.push(item);
            }
          });

           // Sortiere Top-Level und Sub-Level Items
            const sortBySortOrder = (a, b) => (a.sort_order || 0) - (b.sort_order || 0);
            menuItems.sort(sortBySortOrder);
            itemMap.forEach(item => {
                if (item.sub && Array.isArray(item.sub)) {
                    item.sub.sort(sortBySortOrder);
                }
            });

        } else {
             console.warn("[fetchMenuRawFromDB] Die Datenbankabfrage hat keine Zeilen zurückgegeben oder das Ergebnis war kein Array.");
        }

        console.log(`[fetchMenuRawFromDB] Resolving promise with ${menuItems.length} top-level menu items.`);
        resolve({ menuItems }); // Immer mit diesem Objekt auflösen
      }
    );
  });
}


// Rekursive Funktion zum Auflösen dynamischer Labels/Properties und Filtern deaktivierter Elemente
async function resolveMenuStructure(sqliteDB, items) {
  const resolvedItems = [];
  if (!Array.isArray(items)) return resolvedItems;

  for (const item of items) {
      if (!item) continue;

      let resolvedLabel = item.label;
      let resolvedEnable = item.enable;

      // Label auflösen und 'enable' anpassen
      if (typeof item.label === 'object' && item.label.source_type === 'dynamic' && item.label.source_key) {
          resolvedLabel = await resolveLabelValue(sqliteDB, item.label);
          try {
               const row = await new Promise((resolve, reject) => {
                  sqliteDB.get(`SELECT visible FROM QHMI_VARIABLES WHERE NAME = ?`, [item.label.source_key], (err, row) => (err ? reject(err) : resolve(row)));
               });
               if (row && row.visible !== undefined) {
                    resolvedEnable = row.visible === '1' || row.visible === true || row.visible === 1;
               }
          } catch (err) {
                console.error(`Fehler beim Abrufen von 'visible' für ${item.label.source_key}:`, err);
                resolvedEnable = item.enable; // Behalte ursprünglichen Wert
          }
      } else if (typeof item.label === 'object') {
         resolvedLabel = await resolveLabelValue(sqliteDB, item.label);
      }

      // Überspringe, wenn nicht aktiviert
      if (!resolvedEnable) continue;

      // Eigenschaften auflösen
      const properties = {};
      if (item.properties) {
          for (const [key, prop] of Object.entries(item.properties)) {
              properties[key] = await resolvePropertyValue(sqliteDB, prop);
          }
      }

      // Sub-Menü rekursiv auflösen
      let resolvedSub = [];
      if (item.sub && item.sub.length > 0) {
          resolvedSub = await resolveMenuStructure(sqliteDB, item.sub);
      }

      resolvedItems.push({
          ...item,
          label: resolvedLabel,
          enable: resolvedEnable,
          properties,
          sub: resolvedSub
      });
  }
  return resolvedItems;
}


// Menü für das Frontend vorbereiten (jetzt mit Filterung)
async function fetchMenuForFrontend(sqliteDB) {
  try {
      const rawMenu = await fetchMenuRawFromDB(sqliteDB);
      if (!rawMenu || !Array.isArray(rawMenu.menuItems)) {
           console.error("[fetchMenuForFrontend] Konnte keine rohen Menüdaten abrufen.");
           return defaultMenu;
      }

      const qhmiVariables = await fetchQhmiVariables(sqliteDB);

      // SVG-Auflösung
      const resolveSvg = (item) => {
          if (item && item.qhmiVariable && item.svgConditions && Array.isArray(item.svgConditions)) {
              const variableValue = String(qhmiVariables[item.qhmiVariable]); // Sicherstellen, dass es ein String ist
              const condition = item.svgConditions.find(cond => String(cond.value) === variableValue);
              if (condition && condition.svg) item.svg = condition.svg;
          }
          if (item && item.sub && Array.isArray(item.sub)) {
              item.sub.forEach(subItem => resolveSvg(subItem));
          }
      };
      rawMenu.menuItems.forEach(item => resolveSvg(item));

      // Labels/Properties auflösen UND Deaktivierte filtern
      const resolvedAndFilteredMenuItems = await resolveMenuStructure(sqliteDB, rawMenu.menuItems);

      return { menuItems: resolvedAndFilteredMenuItems };
  } catch (error) {
       console.error("[fetchMenuForFrontend] Fehler beim Aufbereiten des Menüs:", error);
       return defaultMenu;
  }
}


// Menüeinträge in die Datenbank einfügen (rekursiv)
async function insertMenuItemRecursive(sqliteDB, item, parentId = null, sortOrder = 0) {
    if (!item || typeof item !== 'object') {
        console.warn("[insertMenuItemRecursive] Ungültiges Item übersprungen:", item);
        return;
    }
    // Standardwerte und Validierung
    const labelValue = typeof item.label === 'object' ? JSON.stringify(item.label) : (item.label || 'Unbenannt');
    const linkValue = item.link || null;
    const svgValue = item.svg || 'default';
    const enableValue = item.enable !== undefined ? (item.enable ? 1 : 0) : 1;
    const qhmiVariableValue = item.qhmiVariable || null;

    // Einfügen des Haupteintrags
    const itemId = await new Promise((resolve, reject) => {
      sqliteDB.run(
        `INSERT INTO menu_items (label, link, svg, enable, parent_id, sort_order, qhmiVariable)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [labelValue, linkValue, svgValue, enableValue, parentId, sortOrder, qhmiVariableValue],
        function (err) { if (err) reject(err); else resolve(this.lastID); }
      );
    });

    // Hilfsfunktion für DB-Operationen
    const runDb = (sql, params) => new Promise((res, rej) => sqliteDB.run(sql, params, (err) => err ? rej(err) : res()));

    // Properties einfügen
    if (item.properties) {
      for (const [key, propData] of Object.entries(item.properties)) {
        if (propData && typeof propData === 'object') {
            await runDb(`INSERT INTO menu_properties (menu_item_id, key, value, source_type, source_key) VALUES (?, ?, ?, ?, ?)`,
                        [itemId, key, propData.value, propData.source_type || 'static', propData.source_key || null]);
        }
      }
    }

    // Actions einfügen
    if (item.actions) {
      for (const [actionName, qhmiVariableNames] of Object.entries(item.actions)) {
         if (Array.isArray(qhmiVariableNames)) {
             for (const qhmiVariableName of qhmiVariableNames) {
               await runDb(`INSERT INTO menu_actions (menu_item_id, action_name, qhmi_variable_name) VALUES (?, ?, ?)`,
                           [itemId, actionName, qhmiVariableName]);
             }
         }
      }
    }

    // SVG Conditions einfügen
    if (item.svgConditions && Array.isArray(item.svgConditions)) {
      for (const condition of item.svgConditions) {
         if (condition && condition.value !== undefined && condition.svg !== undefined) {
           await runDb(`INSERT INTO menu_svg_conditions (menu_item_id, value, svg) VALUES (?, ?, ?)`,
                       [itemId, condition.value, condition.svg]);
         }
      }
    }

    // Sub-Items rekursiv einfügen
    if (item.sub && Array.isArray(item.sub)) {
      for (let i = 0; i < item.sub.length; i++) {
        await insertMenuItemRecursive(sqliteDB, item.sub[i], itemId, i);
      }
    }
}

// Wrapper-Funktion für das Einfügen des gesamten Menüs
async function insertMenuItems(sqliteDB, items) {
    if (!Array.isArray(items)) throw new Error("Top-Level Menüstruktur muss ein Array sein.");
    for (let i = 0; i < items.length; i++) {
        await insertMenuItemRecursive(sqliteDB, items[i], null, i);
    }
}


// --- Menu Handler Setup ---
function setupMenuHandlers(io, sqliteDB, updateCachedMenuData, fetchMenuForFrontend, fetchMenuRawFromDB, insertMenuItems) {

  const loadInitialMenu = async () => { /* ... (wie vorher) ... */ };
  let currentMenuPromise = loadInitialMenu();

  io.on('connection', async (socket) => {
      console.log(`[MenuHandler] Client ${socket.id} verbunden, sende initiales Menü...`);
      try {
         const menuToSend = await currentMenuPromise;
         socket.emit('menu-update', menuToSend);
      } catch (err) {
           console.error(`[MenuHandler] Fehler beim Senden des initialen Menüs an ${socket.id}:`, err);
           socket.emit('menu-update', defaultMenu);
      }

    // Listener für Konfigurations-Updates vom Client
    socket.on('update-menu-config', async (newMenu) => {
      console.log("[MenuHandler update-menu-config] Empfangen:", newMenu ? 'Daten erhalten' : 'Keine Daten');
      if (!newMenu || !Array.isArray(newMenu.menuItems)) {
          console.error("[MenuHandler update-menu-config] Ungültiges Menüformat empfangen.");
          socket.emit('menu-config-error', { message: 'Ungültiges Menüformat gesendet.' });
          return;
      }
      try {
          // Transaktion für Löschen und Einfügen
          await new Promise((resolve, reject) => {
              sqliteDB.run('BEGIN TRANSACTION', async (beginErr) => {
                  if (beginErr) return reject(beginErr);
                  try {
                      await new Promise((res, rej) => sqliteDB.run(`DELETE FROM menu_properties`, (err) => err ? rej(err) : res()));
                      await new Promise((res, rej) => sqliteDB.run(`DELETE FROM menu_actions`, (err) => err ? rej(err) : res()));
                      await new Promise((res, rej) => sqliteDB.run(`DELETE FROM menu_svg_conditions`, (err) => err ? rej(err) : res()));
                      await new Promise((res, rej) => sqliteDB.run(`DELETE FROM menu_items`, (err) => err ? rej(err) : res()));
                      console.log("[MenuHandler update-menu-config] Alte Menüdaten gelöscht.");

                      await insertMenuItems(sqliteDB, newMenu.menuItems); // Neue Daten einfügen
                      console.log("[MenuHandler update-menu-config] Neue Menüdaten eingefügt.");

                      await new Promise((res, rej) => sqliteDB.run('COMMIT', (err) => err ? rej(err) : res()));
                      resolve();
                  } catch (processErr) {
                      console.error("[MenuHandler update-menu-config] Fehler während der Transaktion, führe Rollback aus:", processErr);
                      sqliteDB.run('ROLLBACK');
                      reject(processErr);
                  }
              });
          });

          console.log("[MenuHandler update-menu-config] Datenbank erfolgreich aktualisiert.");

          // Neues Menü laden und cachen
          const updatedMenuForFrontend = await fetchMenuForFrontend(sqliteDB);
          currentMenuPromise = Promise.resolve(updatedMenuForFrontend);

          // MQTT-Map aktualisieren
          await updateCachedMenuData(sqliteDB);

          // Erfolg an Client senden
          const rawMenuForClient = await fetchMenuRawFromDB(sqliteDB);
          socket.emit('menu-config-success', { message: 'Menü erfolgreich aktualisiert', menu: rawMenuForClient });

          // Update an alle Clients senden
          io.emit('menu-update', updatedMenuForFrontend);
          console.log('[MenuHandler update-menu-config] Menü erfolgreich aktualisiert und an alle Clients gesendet.');

      } catch (err) {
          console.error('[MenuHandler update-menu-config] Fehler beim Aktualisieren des Menüs:', err);
          socket.emit('menu-config-error', { message: 'Fehler beim Speichern des Menüs: ' + (err.message || 'Unbekannter Fehler') });
      }
    });

    // Listener für Konfigurations-Anfragen
    socket.on('request-menu-config', async () => { /* ... (wie vorher) ... */ });
  });

  return { fetchMenuForFrontend };
}

// Exporte
module.exports = {
  fetchMenuRawFromDB,
  fetchMenuForFrontend,
  insertMenuItems,
  setupMenuHandlers,
  defaultMenu
};