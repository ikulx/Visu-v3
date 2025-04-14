// src/dbRoutes.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path'); // <<< KORRIGIERTE ZEILE
const router = express.Router();
const { fetchMenuForFrontend } = require('./menuHandler');
const { checkAndSendMqttUpdates } = require('./mqttHandler');

// +++ NEU: CSV- und Upload-Abhängigkeiten +++
const Papa = require('papaparse'); // CSV Parser/Unparser
const multer = require('multer'); // Middleware für File Uploads

// +++ NEU: Multer-Konfiguration (speichert Datei im Speicher) +++
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // Limit 10MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/csv' || file.originalname.toLowerCase().endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('Nur CSV-Dateien sind erlaubt!'), false);
        }
    }
});
// ... (Rest der Datei bleibt unverändert) ...


const nodeRedUrl = 'http://192.168.10.31:1880/db/Changes';
const nodeRedFullUrl = 'http://192.168.10.31:1880/db/fullChanges';

const dbPath = path.join(__dirname, 'external', 'ycontroldata_settings.sqlite');
const sqliteDB = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Fehler beim Verbinden mit der SQLite-Datenbank:', err);
  else console.log('DBRoutes: Verbindung zur SQLite-Datenbank hergestellt.');
});

// Whitelist der erlaubten Spalten (wichtig für Sicherheit)
const allowedColumns = [
  "id", "NAME", "VAR_VALUE", "unit", "TYPE", "OPTI", "adresse", "faktor",
  "MIN", "MAX", "EDITOR", "sort", "visible", "HKL", "HKL_Feld",
  "updated_at", "created_at", "last_modified", "tag_top", "tag_sub",
  "benutzer", "beschreibung", "NAME_fr", "NAME_en", "NAME_it", "NAME_de",
  "OPTI_fr", "OPTI_en", "OPTI_it", "OPTI_de",
  "beschreibung_fr", "beschreibung_en", "beschreibung_it"
];
// Primärschlüssel für Upsert-Logik
const primaryKeyColumn = "NAME";

// Spalten, deren Änderung einen Settings-Broadcast auslöst (nicht mehr steuernd, nur Doku)
const settingsColumns = ['benutzer', 'visible', 'tag_top', 'tag_sub', 'TYPE', 'OPTI_de', 'OPTI_fr', 'OPTI_en', 'OPTI_it', 'MIN', 'MAX', 'unit', 'NAME_de', 'NAME_fr', 'NAME_en', 'NAME_it', 'beschreibung', 'beschreibung_fr', 'beschreibung_en', 'beschreibung_it'];
// Spalten, deren Änderung einen Menü-Broadcast auslöst (nicht mehr steuernd, nur Doku)
const menuRelevantColumns = ['VAR_VALUE', 'visible'];

// --- Konsolidierte Update-Funktion ---
async function performVariableUpdate(key, search, target, value) {
  return new Promise((resolve, reject) => {
    if (!allowedColumns.includes(key) || !allowedColumns.includes(target)) {
      console.warn(`[performVariableUpdate] Ungültige Spaltenanfrage: key=${key}, target=${target}`);
      return reject(new Error("Ungültige Spaltenangabe."));
    }

    const sql = `UPDATE QHMI_VARIABLES SET ${target} = ? WHERE ${key} = ?`;

    sqliteDB.run(sql, [value, search], async function (err) { // Muss 'function' sein wegen 'this'
      if (err) {
        console.error(`[performVariableUpdate] Fehler beim DB-Update für ${target}=${value} bei ${key}=${search}:`, err);
        return reject(new Error("Fehler beim Aktualisieren der Datenbank."));
      }

      const changes = this.changes;
      console.log(`[performVariableUpdate] ${target} für ${key}=${search} auf ${value} gesetzt. Änderungen: ${changes}`);

      // Update an Node-RED senden (nur bei VAR_VALUE Änderung - behalten wir bei)
      if (target === "VAR_VALUE") {
        try {
          await sendNodeRedUpdate(search, value);
        } catch (nodeRedErr) {
          console.error(`[performVariableUpdate] Fehler beim Senden an Node-RED:`, nodeRedErr);
        }
      }

      // Broadcasts über Socket.IO nach JEDEM erfolgreichen Update
      let didBroadcastSettings = false;
      let didBroadcastMenu = false;

      if (global.io) {
        // 1. Sende IMMER die aktualisierten Settings an alle Clients
        try {
          // broadcastSettings() ohne Argumente sendet an alle (global.io).
          // Die Funktion holt die Daten frisch aus der DB.
          await broadcastSettings();
          didBroadcastSettings = true;
          console.log(`[performVariableUpdate] Settings-Broadcast nach Update von '${target}' getriggert.`);
        } catch (settingsErr) {
          console.error("[performVariableUpdate] Fehler beim Senden des Settings-Updates:", settingsErr);
        }

        // 2. Sende IMMER das aktualisierte Menü an alle Clients
        try {
          // fetchMenuForFrontend holt das Menü frisch und löst dynamische Werte auf
          const menu = await fetchMenuForFrontend(sqliteDB);
          global.io.emit("menu-update", menu);
          didBroadcastMenu = true;
          console.log(`[performVariableUpdate] Menü-Broadcast nach Update von '${target}' getriggert.`);
        } catch(menuErr) {
          console.error("[performVariableUpdate] Fehler beim Senden des Menü-Updates:", menuErr);
        }

        // 3. Sende das spezifische Update-Event (optional, für gezieltere Updates falls benötigt)
        global.io.emit('variable-updated', { name: search, column: target, value: value });
        // console.log(`[performVariableUpdate] Event 'variable-updated' gesendet.`);

      } else {
        console.warn("[performVariableUpdate] global.io ist nicht verfügbar für Broadcasts.");
      }

      // Ergebnisobjekt zurückgeben
      resolve({
          message: "Datenbank erfolgreich aktualisiert.",
          changes: changes,
          settingsBroadcasted: didBroadcastSettings, // Gibt an, ob der Versuch gestartet wurde
          menuBroadcasted: didBroadcastMenu,       // Gibt an, ob der Versuch gestartet wurde
          targetColumn: target
       });
    });
  });
}

// --- Hilfsfunktionen ---
async function sendNodeRedUpdate(name, var_value) {
  try {
      // Stelle sicher, dass node-fetch korrekt importiert wird
      const fetch = (await import('node-fetch')).default;
      const payload = { [name]: var_value };
      const response = await fetch(nodeRedUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
      });
      if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`Node-RED Update fehlgeschlagen (${response.status}): ${errorBody}`);
      }
      const data = await response.json();
      console.log("[sendNodeRedUpdate] Node-RED Update erfolgreich:", data);
      return data;
  } catch (error) {
       console.error("[sendNodeRedUpdate] Fehler:", error);
       // Fehler nicht weiterwerfen, um Hauptprozess nicht zu stören
  }
}


async function sendFullDbUpdate() {
  // Wird aktuell nicht automatisch aufgerufen, kann aber manuell getriggert werden
  try {
      const rows = await new Promise((resolve, reject) => {
          sqliteDB.all("SELECT * FROM QHMI_VARIABLES", [], (err, rows) => err ? reject(err) : resolve(rows));
      });
       const fetch = (await import('node-fetch')).default;
      const response = await fetch(nodeRedFullUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rows)
      });
      if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`Senden der vollen DB an Node-RED fehlgeschlagen (${response.status}): ${errorBody}`);
      }
      const data = await response.json();
      console.log("Gesamte DB-Änderung erfolgreich gesendet:", data);
  } catch(err) {
       console.error("Fehler beim Senden der kompletten DB-Änderung:", err);
  }
}

async function broadcastSettings(socket = null, user = null, db = sqliteDB) { // db als Parameter hinzugefügt
  // Wähle die Spalten aus, die für die Settings relevant sind
  const relevantSettingColumns = [
      "NAME", "NAME_de", "NAME_fr", "NAME_en", "NAME_it", "VAR_VALUE",
      "benutzer", "visible", "tag_top", "tag_sub", "TYPE",
      "OPTI_de", "OPTI_fr", "OPTI_en", "OPTI_it",
      "MIN", "MAX", "unit", "beschreibung", // Beschreibung hinzugefügt
      "beschreibung_fr", "beschreibung_en", "beschreibung_it" // Fremdsprachige Beschreibungen
    ].join(", ");

  const sql = `SELECT ${relevantSettingColumns} FROM QHMI_VARIABLES`;

  try {
      const rows = await new Promise((resolve, reject) => {
          db.all(sql, [], (err, rows) => { // Verwende die übergebene DB-Instanz
              if (err) {
                  console.error("DB Error in broadcastSettings:", err);
                  reject(err);
              } else {
                  resolve(rows);
              }
          });
      });

      if (socket) { // Sende an spezifisches Socket (mit Filter)
          let filteredRows = rows;
          if (user) {
              console.log(`[broadcastSettings] Filtering settings for user: ${user}`);
              filteredRows = rows.filter(row => {
                  if (!row.benutzer) return false; // Wenn kein Benutzer zugewiesen, nicht anzeigen
                  const allowedUsers = row.benutzer.split(',').map(u => u.trim().toLowerCase());
                  // Zeige an, wenn Benutzer erlaubt ODER wenn 'all' erlaubt ist
                  return allowedUsers.includes(user.toLowerCase()) || allowedUsers.includes('all');
              });
              console.log(`[broadcastSettings] Found ${filteredRows.length} settings for user ${user}.`);
          } else {
               console.log(`[broadcastSettings] No user specified for socket ${socket.id}, sending all ${rows.length} settings.`);
               // Optional: Hier könnte man auch filtern, wenn kein Benutzer angegeben ist (z.B. nur 'all')
               filteredRows = rows.filter(row => {
                   if (!row.benutzer) return false;
                   const allowedUsers = row.benutzer.split(',').map(u => u.trim().toLowerCase());
                   return allowedUsers.includes('all'); // Beispiel: Nur 'all' senden, wenn kein User spezifisch
               });
                console.log(`[broadcastSettings] Sending ${filteredRows.length} 'all' settings to socket ${socket.id}.`);
          }
          socket.emit("settings-update", filteredRows);
          // console.log(`[broadcastSettings] Settings sent to socket ${socket.id}.`);

      } else if (global.io) { // Broadcast an alle verbundenen Clients
          console.log("[broadcastSettings] Broadcasting all settings to all clients.");
          // HINWEIS: Beim globalen Broadcast wird NICHT nach Benutzer gefiltert.
          // Jeder Client erhält ALLE Settings. Die Filterung muss client-seitig erfolgen
          // oder indem der Client nach Verbindung seinen Benutzer setzt und DANN
          // gefilterte Settings über `request-settings` anfordert.
          global.io.emit("settings-update", rows);
      } else {
          console.warn("[broadcastSettings] Neither socket nor global.io available.");
      }

  } catch (err) {
      console.error("Fehler beim Abrufen/Broadcasten der Settings:", err);
      // Optional: Fehler an Client senden, falls socket vorhanden
      if (socket) {
          socket.emit("settings-error", { message: "Fehler beim Laden der Einstellungen." });
      }
  }
}

// --- NEUE Routen für CSV Export/Import ---

/**
 * GET /db/export/variables.csv
 * Exportiert alle QHMI_VARIABLES als CSV-Datei.
 */
router.get('/export/variables.csv', async (req, res) => {
    console.log('[Export] Anfrage zum Exportieren von Variablen als CSV empfangen.');
    try {
        const rows = await new Promise((resolve, reject) => {
            // Alle Spalten für den Export holen, sortiert nach NAME
            sqliteDB.all(`SELECT * FROM QHMI_VARIABLES ORDER BY ${primaryKeyColumn} ASC`, [], (err, rows) => {
                if (err) {
                    console.error("[Export] Fehler beim Abrufen der Variablen aus der DB:", err);
                    reject(new Error("Datenbankfehler beim Export."));
                } else {
                    resolve(rows);
                }
            });
        });

        if (!rows || rows.length === 0) {
            console.log("[Export] Keine Variablen zum Exportieren gefunden.");
            // Optional: Leere CSV senden oder Fehler? Senden wir eine leere CSV mit Header.
            // const csvHeaders = Papa.unparse([{}], { header: true }); // Erzeugt nur Header
             // Erzeuge CSV-String mit Header
             const csvData = Papa.unparse(rows, {
                 header: true,
                 quotes: true, // Werte bei Bedarf in Anführungszeichen setzen
                 skipEmptyLines: true
             });
             const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
             const filename = `ycontrol_variables_${timestamp}.csv`;

             res.setHeader('Content-Type', 'text/csv; charset=utf-8');
             res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
             res.status(200).send(Buffer.from(csvData, 'utf-8')); // UTF-8 erzwingen
             console.log(`[Export] ${rows.length} Variablen erfolgreich als ${filename} exportiert.`);


        } else {
             // Erzeuge CSV-String mit Header
            const csvData = Papa.unparse(rows, {
                header: true,
                quotes: true, // Werte bei Bedarf in Anführungszeichen setzen
                skipEmptyLines: true
            });

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `ycontrol_variables_${timestamp}.csv`;

            res.setHeader('Content-Type', 'text/csv; charset=utf-8'); // UTF-8 sicherstellen
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.status(200).send(Buffer.from(csvData, 'utf-8')); // Als Buffer senden mit UTF-8 Encoding
            console.log(`[Export] ${rows.length} Variablen erfolgreich als ${filename} exportiert.`);
        }

    } catch (error) {
        console.error("[Export] Unerwarteter Fehler beim Export:", error);
        res.status(500).json({ error: 'Fehler beim Erstellen der Exportdatei.', details: error.message });
    }
});

/**
 * POST /db/import/variables
 * Importiert QHMI_VARIABLES aus einer hochgeladenen CSV-Datei.
 * Verwendet eine Upsert-Strategie (Update oder Insert).
 */
router.post('/import/variables', upload.single('csvfile'), async (req, res) => {
    console.log('[Import] Anfrage zum Importieren von Variablen aus CSV empfangen.');
    if (!req.file) {
        console.log('[Import] Keine Datei hochgeladen.');
        return res.status(400).json({ error: 'Keine CSV-Datei hochgeladen.' });
    }

    const csvString = req.file.buffer.toString('utf-8');
    let importCounter = { inserted: 0, updated: 0, skipped: 0 };
    const errors = [];

    try {
        console.log('[Import] Parse CSV-Datei...');
        const parseResult = Papa.parse(csvString, {
            header: true,       // Erste Zeile als Header verwenden
            skipEmptyLines: true, // Leere Zeilen überspringen
            dynamicTyping: false, // Alle Werte als String behandeln, DB kümmert sich um Typen
            transformHeader: header => header.trim() // Header-Leerzeichen entfernen
        });

        if (parseResult.errors.length > 0) {
            console.error('[Import] Fehler beim Parsen der CSV:', parseResult.errors);
            return res.status(400).json({
                error: 'Fehler beim Parsen der CSV-Datei.',
                details: parseResult.errors.map(e => `Zeile ${e.row}: ${e.message}`).join('; ')
            });
        }

        const data = parseResult.data;
        if (!data || data.length === 0) {
            console.log('[Import] CSV-Datei ist leer oder enthält keine Datenzeilen.');
            return res.status(400).json({ error: 'Die CSV-Datei enthält keine Daten.' });
        }
        console.log(`[Import] ${data.length} Zeilen aus CSV geparst.`);

        // Validierung der Spaltennamen gegen allowedColumns (Header der CSV)
        const csvHeaders = parseResult.meta.fields;
        const invalidHeaders = csvHeaders.filter(h => !allowedColumns.includes(h));
        if (invalidHeaders.length > 0) {
             console.warn(`[Import] Ungültige Spalten in CSV gefunden: ${invalidHeaders.join(', ')}. Diese werden ignoriert.`);
             // Optional: Import abbrechen, wenn ungültige Spalten kritisch sind
             // return res.status(400).json({ error: 'CSV enthält ungültige Spalten.', details: invalidHeaders });
        }
        // Nur gültige Spalten für die DB-Operationen verwenden
        const validDbColumns = csvHeaders.filter(h => allowedColumns.includes(h) && h !== 'id'); // id ausschließen, da auto-increment
        const primaryKeyIndex = validDbColumns.indexOf(primaryKeyColumn);
        if(primaryKeyIndex === -1 && !validDbColumns.includes(primaryKeyColumn)) { // Sicherstellen, dass PK da ist
            validDbColumns.push(primaryKeyColumn); // PK hinzufügen, falls nicht explizit dabei, aber für Upsert nötig
             console.warn(`[Import] Primärschlüssel '${primaryKeyColumn}' nicht in validen CSV-Spalten gefunden, wird für Upsert benötigt.`);
        }
        if (!validDbColumns.includes(primaryKeyColumn)) {
             console.error(`[Import] Primärschlüssel '${primaryKeyColumn}' fehlt in den CSV-Daten oder ist keine erlaubte Spalte.`);
             return res.status(400).json({ error: `Primärschlüssel '${primaryKeyColumn}' fehlt in den CSV-Daten.` });
        }


        console.log('[Import] Starte Datenbank-Transaktion...');
        // Upsert-Logik innerhalb einer Transaktion
        await new Promise((resolve, reject) => {
            sqliteDB.serialize(() => {
                sqliteDB.run('BEGIN TRANSACTION', (beginErr) => {
                    if (beginErr) return reject(new Error(`DB Transaktion Startfehler: ${beginErr.message}`));

                    // Prepare Statements für Insert und Update
                    const placeholders = validDbColumns.map(() => '?').join(',');
                    const insertSql = `INSERT INTO QHMI_VARIABLES (${validDbColumns.join(',')}) VALUES (${placeholders})`;
                    const updatePlaceholders = validDbColumns.filter(col => col !== primaryKeyColumn).map(col => `${col} = ?`).join(', ');
                    const updateSql = `UPDATE QHMI_VARIABLES SET ${updatePlaceholders} WHERE ${primaryKeyColumn} = ?`;

                    try {
                        const insertStmt = sqliteDB.prepare(insertSql);
                        const updateStmt = sqliteDB.prepare(updateSql);
                        let rowNum = 0; // Für Fehlermeldungen

                        const processRow = async (row) => {
                             rowNum++;
                            const primaryKeyValue = row[primaryKeyColumn];
                            if (primaryKeyValue === undefined || primaryKeyValue === null || String(primaryKeyValue).trim() === '') {
                                errors.push(`Zeile ${rowNum}: Primärschlüssel '${primaryKeyColumn}' fehlt oder ist leer.`);
                                importCounter.skipped++;
                                return; // Nächste Zeile
                            }

                             // Bereite Werte für Insert/Update vor (nur gültige Spalten)
                             const valuesForInsert = validDbColumns.map(col => row[col] !== undefined ? String(row[col]) : null); // Alle als String, null wenn nicht vorhanden
                             const valuesForUpdate = validDbColumns.filter(col => col !== primaryKeyColumn).map(col => row[col] !== undefined ? String(row[col]) : null);
                             valuesForUpdate.push(primaryKeyValue); // PK ans Ende für WHERE-Klausel

                            // Prüfen, ob Eintrag existiert
                            const exists = await new Promise((res, rej) => {
                                sqliteDB.get(`SELECT 1 FROM QHMI_VARIABLES WHERE ${primaryKeyColumn} = ?`, [primaryKeyValue], (err, result) => {
                                    if (err) rej(new Error(`DB Fehler bei Existenzprüfung für '${primaryKeyValue}': ${err.message}`));
                                    else res(!!result);
                                });
                            });

                            if (exists) {
                                // Update
                                await new Promise((res, rej) => {
                                    updateStmt.run(valuesForUpdate, function(updateErr) {
                                        if (updateErr) rej(new Error(`DB Update Fehler für '${primaryKeyValue}' (Zeile ${rowNum}): ${updateErr.message}`));
                                        else { importCounter.updated += this.changes > 0 ? 1 : 0; res(); } // Zähle nur wenn wirklich geändert
                                    });
                                });
                            } else {
                                // Insert
                                await new Promise((res, rej) => {
                                    insertStmt.run(valuesForInsert, function(insertErr) {
                                        if (insertErr) rej(new Error(`DB Insert Fehler für '${primaryKeyValue}' (Zeile ${rowNum}): ${insertErr.message}`));
                                        else { importCounter.inserted++; res(); }
                                    });
                                });
                            }
                        }; // Ende processRow

                         // Alle Zeilen sequentiell verarbeiten
                         data.reduce((promiseChain, row) => {
                              return promiseChain.then(() => processRow(row));
                         }, Promise.resolve())
                         .then(() => {
                              // Finalize statements after all rows processed
                              Promise.all([
                                  new Promise((res, rej) => insertStmt.finalize(err => err ? rej(err) : res())),
                                  new Promise((res, rej) => updateStmt.finalize(err => err ? rej(err) : res()))
                              ]).then(() => {
                                   // Commit transaction
                                   sqliteDB.run('COMMIT', (commitErr) => {
                                        if (commitErr) {
                                             reject(new Error(`DB Commit Fehler: ${commitErr.message}`));
                                        } else {
                                             console.log('[Import] Transaktion erfolgreich commited.');
                                             resolve(); // Gesamte Transaktion erfolgreich
                                        }
                                   });
                              }).catch(finalizeErr => reject(new Error(`DB Finalize Fehler: ${finalizeErr.message}`)));
                         })
                         .catch(rowProcessingErr => {
                             // Fehler während der Zeilenverarbeitung -> Rollback
                             reject(rowProcessingErr); // Wird im äußeren Catch behandelt
                         });

                    } catch (stmtErr) {
                        // Fehler beim Vorbereiten der Statements
                        reject(new Error(`DB Statement Fehler: ${stmtErr.message}`));
                    }
                }); // Ende BEGIN TRANSACTION Callback
            }); // Ende Serialize
        }); // Ende await new Promise

        console.log('[Import] Datenbank-Operationen abgeschlossen.');
        console.log('[Import] Ergebnis:', importCounter);
        if (errors.length > 0) {
             console.warn('[Import] Fehler während des Imports aufgetreten:', errors);
        }

        // ---- Broadcast Updates NACH erfolgreichem Import ----
        if (global.io) {
            console.log("[Import] Sende Updates an Clients nach Import...");
            try {
                await broadcastSettings(); // Sendet aktualisierte Settings an alle
                 const menu = await fetchMenuForFrontend(sqliteDB); // Holt aktualisiertes Menü
                 global.io.emit("menu-update", menu); // Sendet aktualisiertes Menü an alle
                console.log("[Import] Settings- und Menü-Updates gesendet.");

                 // MQTT Check nur wenn tatsächlich Daten importiert wurden
                 if (importCounter.inserted > 0 || importCounter.updated > 0) {
                      console.log("[Import] Trigger MQTT Check nach Import.");
                      await checkAndSendMqttUpdates(global.io, sqliteDB);
                 }

            } catch (broadcastError) {
                console.error("[Import] Fehler beim Senden der Updates nach Import:", broadcastError);
                // Fehler dem Client melden? Optional.
                 errors.push(`Fehler beim Senden der Live-Updates: ${broadcastError.message}`);
            }
        }
        // ---- Ende Broadcast ----

        // Finale Antwort an Client
        if (errors.length > 0) {
            res.status(207).json({ // Multi-Status
                message: `Import abgeschlossen mit ${errors.length} Fehlern.`,
                inserted: importCounter.inserted,
                updated: importCounter.updated,
                skipped: importCounter.skipped,
                errors: errors
            });
        } else {
            res.status(200).json({
                message: 'Variablen erfolgreich importiert.',
                inserted: importCounter.inserted,
                updated: importCounter.updated,
                skipped: importCounter.skipped
            });
        }

    } catch (error) {
        console.error("[Import] Unerwarteter Fehler beim Import:", error);
        // Versuche Rollback bei unerwartetem Fehler
        sqliteDB.run('ROLLBACK', (rollbackErr) => {
            if (rollbackErr) console.error("[Import] Rollback nach Fehler fehlgeschlagen:", rollbackErr);
        });
        res.status(500).json({ error: 'Fehler beim Verarbeiten der CSV-Datei.', details: error.message });
    }
});


// --- Bestehende Express Routen (/update-variable, /getAllValue, /update-batch) ---

router.post('/update-variable', async (req, res) => {
  const { key, search, target, value } = req.body;
  try {
    const result = await performVariableUpdate(key, search, target, value);
    // Entscheide hier, ob checkAndSendMqttUpdates nötig ist
     if (result.menuBroadcasted || result.targetColumn === 'VAR_VALUE') {
        console.log(`[Route /update-variable] Trigger checkAndSendMqttUpdates nach Änderung von '${result.targetColumn}'.`);
        // Stelle sicher, dass global.io und sqliteDB hier verfügbar sind oder übergeben werden
        if (global.io && typeof checkAndSendMqttUpdates === 'function') {
             await checkAndSendMqttUpdates(global.io, sqliteDB);
        } else {
             console.warn('[Route /update-variable] Cannot trigger MQTT check: io or function unavailable.');
        }
     }
    res.json(result);
  } catch (error) {
    console.error("Fehler in /update-variable Route:", error);
    res.status(error.message === "Ungültige Spaltenangabe." ? 400 : 500).json({ error: error.message });
  }
});

router.get('/getAllValue', (req, res) => {
  const sql = `SELECT NAME, VAR_VALUE FROM QHMI_VARIABLES`;
  sqliteDB.all(sql, [], (err, rows) => {
    if (err) {
      console.error("Fehler bei der Datenbankabfrage:", err);
      return res.status(500).json({ error: "Fehler beim Abfragen der Datenbank." });
    }
    res.json(rows);
  });
});

// Die Route /update-batch bleibt wie zuvor, da sie ihre eigene Broadcast-Logik am Ende hat
router.post('/update-batch', async (req, res) => {
    const { updates } = req.body;
    if (!Array.isArray(updates)) {
        return res.status(400).json({ error: "Das Feld 'updates' muss ein Array sein." });
    }

    const results = [];
    const errors = [];
    let settingsChanged = false;
    let menuChanged = false;
    let checkMqttAfterBatch = false;

    const runDbUpdate = (sql, params) => new Promise((resolve, reject) => {
         sqliteDB.run(sql, params, function(err) { err ? reject(err) : resolve(this.changes); });
    });

    // *** WICHTIG: Batch Updates innerhalb einer Transaktion ***
    sqliteDB.serialize(() => {
        sqliteDB.run('BEGIN TRANSACTION', async (beginErr) => {
            if (beginErr) {
                console.error("[update-batch] Begin Transaction Error:", beginErr);
                return res.status(500).json({ error: "Datenbankfehler (Begin Transaction)", details: beginErr.message });
            }

            try {
                for (const [index, updateObj] of updates.entries()) {
                    if (!updateObj.target || updateObj.value === undefined || !updateObj.key || !updateObj.search || !allowedColumns.includes(updateObj.key) || !allowedColumns.includes(updateObj.target)) {
                        errors.push({ index, error: "Ungültiges Update-Objekt", data: updateObj });
                        continue; // Überspringe dieses ungültige Update
                    }

                    try {
                        const sql = `UPDATE QHMI_VARIABLES SET ${updateObj.target} = ? WHERE ${updateObj.key} = ?`;
                        const changes = await runDbUpdate(sql, [updateObj.value, updateObj.search]);
                        results.push({ index, changes });

                        // Flags setzen für finale Aktionen
                        if (settingsColumns.includes(updateObj.target)) settingsChanged = true;
                        if (menuRelevantColumns.includes(updateObj.target)) menuChanged = true;
                        if(updateObj.target === "VAR_VALUE") checkMqttAfterBatch = true;

                        // Node-RED Update für VAR_VALUE
                        if (updateObj.target === "VAR_VALUE") {
                            // Senden nach jedem Update ODER gesammelt am Ende? Aktuell: nach jedem.
                            await sendNodeRedUpdate(updateObj.search, updateObj.value);
                        }
                    } catch (err) {
                        console.error(`[update-batch] DB Update Fehler bei Index ${index}:`, err);
                        errors.push({ index, error: err.message, data: updateObj });
                        // Bei Fehler in einem Update: Ganze Transaktion abbrechen? Oder nur dieses überspringen?
                        // Aktuell: Überspringen, weitermachen. Für Rollback: `throw err;` hier.
                    }
                } // Ende der for-Schleife

                // Wenn wir hier sind, wurden alle (gültigen) Updates versucht.
                // Transaktion abschließen (Commit oder Rollback basierend auf Fehlern?)
                // Aktuell: Immer Commit, Fehler werden nur gemeldet.
                sqliteDB.run('COMMIT', async (commitErr) => {
                    if (commitErr) {
                        console.error("[update-batch] Commit Error:", commitErr);
                        // Rollback versuchen? Meistens bei Commit-Fehler zu spät.
                        errors.push({ index: -1, error: "Commit fehlgeschlagen", details: commitErr.message });
                         return res.status(500).json({ message: "Fehler beim Abschließen der Batch-Updates.", errors, successes: results });
                    }

                    console.log(`[update-batch] Transaction committed. ${results.length} successful updates, ${errors.length} errors.`);

                    // Finale Aktionen NACH erfolgreichem Commit
                    if (global.io) {
                        // Broadcast Settings, wenn nötig
                        if (settingsChanged || menuChanged) { // Broadcast Settings auch wenn Menü geändert wurde? Ja, sicherheitshalber.
                            console.log("[update-batch] Broadcasting settings...");
                            await broadcastSettings();
                        }
                        // Broadcast Menu, wenn nötig
                        if (menuChanged) {
                            console.log("[update-batch] Broadcasting menu...");
                            try {
                                const menu = await fetchMenuForFrontend(sqliteDB);
                                global.io.emit("menu-update", menu);

                                // MQTT Check auslösen, wenn VAR_VALUE geändert wurde
                                if (checkMqttAfterBatch) {
                                    console.log("[update-batch] Trigger checkAndSendMqttUpdates nach Batch.");
                                     if (typeof checkAndSendMqttUpdates === 'function') {
                                          await checkAndSendMqttUpdates(global.io, sqliteDB);
                                     } else {
                                         console.warn('[update-batch] checkAndSendMqttUpdates function not available.');
                                     }
                                }
                            } catch(menuErr) {
                                console.error("[update-batch] Fehler beim Senden des Menü-Updates:", menuErr);
                                // Fehler zum Frontend hinzufügen?
                                errors.push({ index: -1, error: "Menü-Broadcast fehlgeschlagen", details: menuErr.message });
                            }
                        }
                        // Event senden, dass Batch fertig ist
                        global.io.emit('batch-update-complete', { success: errors.length === 0, errors, count: results.length });
                    }

                    // Response senden
                    if (errors.length > 0) {
                        res.status(207).json({ // 207 Multi-Status
                           message: "Batch-Updates mit Fehlern abgeschlossen.",
                           errors,
                           successes: results
                        });
                    } else {
                        res.json({
                           message: "Alle Batch-Updates wurden erfolgreich ausgeführt.",
                           count: results.length
                        });
                    }
                }); // Ende Commit Callback

            } catch (transactionError) {
                // Fehler innerhalb der Transaktionslogik (z.B. durch geworfenen Fehler bei Rollback-Wunsch)
                console.error("[update-batch] Error during transaction, rolling back:", transactionError);
                sqliteDB.run('ROLLBACK', (rollbackErr) => {
                    if (rollbackErr) console.error("[update-batch] Rollback Error:", rollbackErr);
                });
                // Fehler ans Frontend melden
                res.status(500).json({
                    message: "Fehler während der Batch-Verarbeitung, Änderungen zurückgerollt.",
                    error: transactionError.message,
                    errors, // Bisherige Fehler auch melden
                    successes: results // Bisherige Erfolge melden (obwohl zurückgerollt)
                });
            }
        }); // Ende Begin Transaction Callback
    }); // Ende Serialize
});


// Exportiere Router und die benötigten Funktionen
module.exports = router; // Router als Default Export
module.exports.performVariableUpdate = performVariableUpdate;
module.exports.broadcastSettings = broadcastSettings;
module.exports.sendNodeRedUpdate = sendNodeRedUpdate; // Bleibt exportiert, falls extern benötigt