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
      return label; // Return original label if not a dynamic/resolvable object
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
  console.log("[fetchMenuRawFromDB] Trying to fetch raw menu data...");
  return new Promise((resolve, reject) => {
    if (!sqliteDB || typeof sqliteDB.all !== 'function') {
        console.error("[fetchMenuRawFromDB] Ungültige sqliteDB Instanz übergeben.");
        return reject(new Error("Ungültige Datenbankinstanz."));
    }

    sqliteDB.all(
      `
      SELECT
          mi.id, mi.label, mi.link, mi.svg, mi.enable, mi.parent_id, mi.sort_order, mi.qhmiVariable, mi.created_at, mi.updated_at,
          mp.id AS prop_id, mp.key AS prop_key, mp.value AS prop_value, mp.source_type AS prop_source_type, mp.source_key AS prop_source_key,
          ma.id AS action_id, ma.action_name, ma.qhmi_variable_name,
          msc.id AS condition_id, msc.value AS condition_value, msc.svg AS condition_svg
      FROM menu_items mi
      LEFT JOIN menu_properties mp ON mi.id = mp.menu_item_id
      LEFT JOIN menu_actions ma ON mi.id = ma.menu_item_id
      LEFT JOIN menu_svg_conditions msc ON mi.id = msc.menu_item_id
      ORDER BY mi.parent_id ASC, mi.sort_order ASC, mi.id ASC
      `,
      [],
      (err, rows) => {
        if (err) {
          console.error("[fetchMenuRawFromDB] Fehler beim Abrufen des rohen Menüs:", err);
          return reject(err);
        }

        console.log(`[fetchMenuRawFromDB] SQL query successful, received ${rows ? rows.length : 'null'} rows.`);

        const itemMap = new Map(); // Map zur Speicherung und Deduplizierung von menu_items

        if (rows && Array.isArray(rows)) {
          rows.forEach((row) => {
              if (!row || row.id == null) return; // Überspringe ungültige Zeilen

              // Initialisiere Item, falls noch nicht vorhanden
              if (!itemMap.has(row.id)) {
                  let parsedLabel;
                  // Versuche, das Label zu parsen, falls es ein JSON-String ist
                  try {
                      // Nur parsen, wenn es ein String ist und mit { beginnt (vereinfachte Prüfung)
                      if (typeof row.label === 'string' && row.label.trim().startsWith('{')) {
                          parsedLabel = JSON.parse(row.label);
                      } else {
                           // Behandle es als einfachen String oder behalte den Wert, wenn es bereits ein Objekt ist
                          parsedLabel = typeof row.label === 'string' ? { value: row.label, source_type: 'static', source_key: null } : row.label;
                      }
                      // Fallback, falls parsedLabel immer noch kein Objekt ist
                      if (typeof parsedLabel !== 'object' || parsedLabel === null) {
                           parsedLabel = { value: String(parsedLabel), source_type: 'static', source_key: null };
                      }
                  } catch (e) {
                       console.warn(`[fetchMenuRawFromDB] Fehler beim Parsen des Labels für Item ${row.id}. Verwende als String:`, row.label, e);
                       // Fallback auf einfachen String im Fehlerfall
                      parsedLabel = { value: String(row.label), source_type: 'static', source_key: null };
                  }

                  itemMap.set(row.id, {
                    id: row.id,
                    link: row.link,
                    label: parsedLabel, // Jetzt immer ein Objekt
                    svg: row.svg,
                    enable: row.enable === 1 || row.enable === true || row.enable === 'true', // Robustere Prüfung
                    qhmiVariable: row.qhmiVariable,
                    svgConditions: [],
                    properties: {},
                    actions: {},
                    parent_id: row.parent_id,
                    sort_order: row.sort_order,
                    sub: [] // Immer ein Array initialisieren
                  });
              }
              const item = itemMap.get(row.id);

              // Properties hinzufügen (dedupliziert)
              if (row.prop_id != null && row.prop_key && !item.properties[row.prop_key]) {
                  item.properties[row.prop_key] = {
                    value: row.prop_value,
                    source_type: row.prop_source_type || 'static', // Default zu static
                    source_key: row.prop_source_key
                  };
              }

              // Actions hinzufügen (dedupliziert)
              if (row.action_id != null && row.action_name && row.qhmi_variable_name) {
                  if (!item.actions[row.action_name]) {
                    item.actions[row.action_name] = [];
                  }
                  if (!item.actions[row.action_name].includes(row.qhmi_variable_name)) {
                       item.actions[row.action_name].push(row.qhmi_variable_name);
                  }
              }

              // SVG Conditions hinzufügen (dedupliziert)
              if (row.condition_id != null && row.condition_value != null && row.condition_svg != null) {
                   const conditionExists = item.svgConditions.some(
                     cond => cond.value === row.condition_value && cond.svg === row.condition_svg
                   );
                   if (!conditionExists) {
                        item.svgConditions.push({ value: row.condition_value, svg: row.condition_svg });
                   }
              }
          });

          // Hierarchie aufbauen
          const menuItems = [];
          itemMap.forEach((item) => {
            if (item.parent_id && itemMap.has(item.parent_id)) {
              const parent = itemMap.get(item.parent_id);
              // Sicherstellen, dass sub existiert (sollte durch Initialisierung der Fall sein)
              if (!parent.sub) parent.sub = [];
              parent.sub.push(item);
            } else if (item.parent_id == null) { // Nur Top-Level Items hinzufügen
              menuItems.push(item);
            }
          });

           // Sortiere Top-Level und Sub-Level Items nach sort_order
            const sortBySortOrder = (a, b) => (a.sort_order || 0) - (b.sort_order || 0);
            menuItems.sort(sortBySortOrder);
            itemMap.forEach(item => {
                if (item.sub && Array.isArray(item.sub)) {
                    item.sub.sort(sortBySortOrder);
                }
            });

          console.log(`[fetchMenuRawFromDB] Resolving promise with ${menuItems.length} top-level menu items.`);
          resolve({ menuItems }); // Immer mit diesem Objekt auflösen

        } else {
             console.warn("[fetchMenuRawFromDB] Die Datenbankabfrage hat keine Zeilen zurückgegeben.");
             resolve({ menuItems: [] }); // Leeres Menü zurückgeben
        }
      }
    );
  });
}


// Rekursive Funktion zum Auflösen dynamischer Labels/Properties und Filtern deaktivierter Elemente
async function resolveMenuStructure(sqliteDB, items) {
  const resolvedItems = [];
  if (!Array.isArray(items)) return resolvedItems;

  for (const item of items) {
      if (!item) continue; // Überspringe null/undefined Items

      let resolvedLabel = item.label; // Standard: Objekt oder String
      let resolvedEnable = item.enable; // Standard

       // Wenn Label ein Objekt ist, versuche es aufzulösen
      if (typeof item.label === 'object' && item.label !== null && item.label.source_type) {
           resolvedLabel = await resolveLabelValue(sqliteDB, item.label); // Gibt den aufgelösten String zurück

           // Prüfe 'visible' nur, wenn es eine dynamische Quelle gibt
          if (item.label.source_type === 'dynamic' && item.label.source_key) {
                try {
                    const row = await new Promise((resolve, reject) => {
                        sqliteDB.get(`SELECT visible FROM QHMI_VARIABLES WHERE NAME = ?`, [item.label.source_key], (err, row) => (err ? reject(err) : resolve(row)));
                    });
                    // Überschreibe 'enable' nur, wenn 'visible' explizit gefunden wurde
                    if (row && row.visible !== undefined && row.visible !== null) {
                        resolvedEnable = row.visible === '1' || row.visible === true || row.visible === 1;
                    }
                } catch (err) {
                    console.error(`Fehler beim Abrufen von 'visible' für ${item.label.source_key}:`, err);
                    // Behalte den ursprünglichen 'enable'-Wert bei Fehler
                }
          }
      } else if (typeof item.label === 'string') {
          // Wenn Label nur ein String ist, behalte ihn bei
          resolvedLabel = item.label;
      } else {
          // Fallback für unerwartete Label-Formate
          resolvedLabel = '?';
      }


      // Überspringe, wenn nicht aktiviert (basierend auf DB oder dynamischer Auflösung)
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
      if (item.sub && Array.isArray(item.sub) && item.sub.length > 0) {
          resolvedSub = await resolveMenuStructure(sqliteDB, item.sub);
      }

      resolvedItems.push({
          ...item,
          label: resolvedLabel, // Aufgelöstes Label (String)
          enable: resolvedEnable, // Aktualisierter Enable-Status
          properties,
          sub: resolvedSub
      });
  }
  return resolvedItems;
}


// Menü für das Frontend vorbereiten (jetzt mit Filterung und SVG-Auflösung)
async function fetchMenuForFrontend(sqliteDB) {
  try {
      const rawMenu = await fetchMenuRawFromDB(sqliteDB);
      if (!rawMenu || !Array.isArray(rawMenu.menuItems)) {
           console.error("[fetchMenuForFrontend] Konnte keine rohen Menüdaten abrufen oder menuItems ist kein Array.");
           return defaultMenu; // Fallback auf Default
      }

       // Hole zuerst alle benötigten Variablen auf einmal
      const qhmiVariables = await fetchQhmiVariables(sqliteDB);

      // Funktion zur SVG-Auflösung (jetzt mit Zugriff auf globale Variablen)
      const resolveSvg = (item) => {
          if (item && item.qhmiVariable && item.svgConditions && Array.isArray(item.svgConditions)) {
              const variableValue = String(qhmiVariables[item.qhmiVariable]); // Wert aus dem Cache holen
              const condition = item.svgConditions.find(cond => String(cond.value) === variableValue);
              if (condition && condition.svg) {
                  item.svg = condition.svg; // SVG im Item-Objekt direkt ändern
              }
          }
          if (item && item.sub && Array.isArray(item.sub)) {
              item.sub.forEach(subItem => resolveSvg(subItem)); // Rekursiv für Sub-Items
          }
      };

      // Wende SVG-Auflösung auf die *rohen* Daten an, bevor sie weiterverarbeitet werden
      rawMenu.menuItems.forEach(item => resolveSvg(item));


      // Labels/Properties auflösen UND Deaktivierte filtern
      const resolvedAndFilteredMenuItems = await resolveMenuStructure(sqliteDB, rawMenu.menuItems);

      return { menuItems: resolvedAndFilteredMenuItems };
  } catch (error) {
       console.error("[fetchMenuForFrontend] Fehler beim Aufbereiten des Menüs:", error);
       return defaultMenu; // Fallback auf Default bei Fehlern
  }
}


// Menüeinträge in die Datenbank einfügen (rekursiv)
async function insertMenuItemRecursive(sqliteDB, item, parentId = null, sortOrder = 0) {
    if (!item || typeof item !== 'object') {
        console.warn("[insertMenuItemRecursive] Ungültiges Item übersprungen:", item);
        return;
    }

    // Label-Behandlung: Speichere das Objekt als JSON-String oder nur den String-Wert
    let labelToSave;
    if (typeof item.label === 'object' && item.label !== null) {
        // Stelle sicher, dass source_type und source_key existieren, wenn nötig
        if (!item.label.source_type) item.label.source_type = 'static';
        if (!item.label.source_key) item.label.source_key = null;
        labelToSave = JSON.stringify(item.label);
    } else {
         // Wenn es nur ein String ist, speichere ihn direkt (oder konvertiere zu Objekt-Struktur)
        // Option A: Nur String speichern (DB-Spalte muss TEXT sein)
        // labelToSave = String(item.label || 'Unbenannt');
        // Option B: Immer als Objekt speichern für Konsistenz
         labelToSave = JSON.stringify({ value: String(item.label || 'Unbenannt'), source_type: 'static', source_key: null });
    }


    const linkValue = item.link || null;
    const svgValue = item.svg || 'default';
    const enableValue = item.enable === true || item.enable === 'true' || item.enable === 1 ? 1 : 0; // Robuster Check
    const qhmiVariableValue = item.qhmiVariable || null;

    // Einfügen des Haupteintrags
    const itemId = await new Promise((resolve, reject) => {
      sqliteDB.run(
        `INSERT INTO menu_items (label, link, svg, enable, parent_id, sort_order, qhmiVariable)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [labelToSave, linkValue, svgValue, enableValue, parentId, sortOrder, qhmiVariableValue],
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
        } else {
            // Fallback falls 'properties' einfache Key-Value-Paare enthält
             await runDb(`INSERT INTO menu_properties (menu_item_id, key, value, source_type, source_key) VALUES (?, ?, ?, ?, ?)`,
                         [itemId, key, propData, 'static', null]);
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
         } else if (typeof qhmiVariableNames === 'string') { // Einzelner String erlaubt?
              await runDb(`INSERT INTO menu_actions (menu_item_id, action_name, qhmi_variable_name) VALUES (?, ?, ?)`,
                          [itemId, actionName, qhmiVariableNames]);
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

  io.on('connection', async (socket) => {
      console.log(`[MenuHandler] Client ${socket.id} verbunden.`);
      // Sende initiales, aufbereitetes Menü (wird meist von server.js getriggert)
      // ... (Der Code dafür ist typischerweise in server.js unter io.on('connection'))

      // Listener für Konfigurations-Anfragen (um den Baum im Modal zu füllen)
      socket.on('request-menu-config', async () => {
          console.log(`[MenuHandler] Client ${socket.id} fordert rohe Menü-Konfiguration an.`);
          try {
              const rawMenuData = await fetchMenuRawFromDB(sqliteDB);
              console.log(`[MenuHandler] Sende rohe Menü-Konfiguration an ${socket.id}.`);
              socket.emit('menu-config-update', rawMenuData); // Event, auf das das Modal lauscht
          } catch (err) {
              console.error(`[MenuHandler] Fehler beim Abrufen der rohen Menü-Konfiguration für ${socket.id}:`, err);
              socket.emit('menu-config-error', { message: 'Fehler beim Laden der Menü-Konfiguration.' });
          }
      });

      // Listener für Konfigurations-Updates vom Client (Speichern)
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
                          // Alte Daten löschen (Reihenfolge beachten wegen Foreign Keys)
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
                          sqliteDB.run('ROLLBACK', rollbackErr => {
                              if(rollbackErr) console.error("Rollback Error:", rollbackErr);
                          });
                          reject(processErr);
                      }
                  });
              });

              console.log("[MenuHandler update-menu-config] Datenbank erfolgreich aktualisiert.");

              // Neues aufbereitetes Menü laden für Live-Update an alle Clients
              const updatedMenuForFrontend = await fetchMenuForFrontend(sqliteDB);

              // MQTT-Map aktualisieren (wichtig nach Menüänderung)
              if (updateCachedMenuData) {
                  await updateCachedMenuData(sqliteDB);
              } else {
                  console.warn("[MenuHandler] updateCachedMenuData Funktion nicht verfügbar zum Aktualisieren der MQTT Map.");
              }


              // Erfolg und die NEUEN ROHEN Daten an den anfragenden Client senden
              const rawMenuForClient = await fetchMenuRawFromDB(sqliteDB);
              socket.emit('menu-config-success', { message: 'Menü erfolgreich aktualisiert', menu: rawMenuForClient });

              // Update des aufbereiteten Menüs an alle Clients senden
              io.emit('menu-update', updatedMenuForFrontend);
              console.log('[MenuHandler update-menu-config] Menü erfolgreich aktualisiert und an alle Clients gesendet.');

          } catch (err) {
              console.error('[MenuHandler update-menu-config] Fehler beim Aktualisieren des Menüs:', err);
              socket.emit('menu-config-error', { message: 'Fehler beim Speichern des Menüs: ' + (err.message || 'Unbekannter Fehler') });
          }
        });

    }); // Ende io.on('connection')

    // Gib die benötigten Funktionen zurück
    return { fetchMenuForFrontend, fetchMenuRawFromDB, insertMenuItems };
} // Ende setupMenuHandlers

// --- Exporte ---
module.exports = {
  fetchMenuRawFromDB,
  fetchMenuForFrontend,
  insertMenuItems,
  setupMenuHandlers,
  defaultMenu,
  resolveLabelValue, // Exportieren, falls von extern benötigt
  resolvePropertyValue // Exportieren, falls von extern benötigt
};