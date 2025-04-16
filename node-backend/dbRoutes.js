// src/dbRoutes.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const router = express.Router();
const { fetchMenuForFrontend } = require('./menuHandler'); // Benötigt für Broadcast
const { checkAndSendMqttUpdates } = require('./mqttHandler'); // Benötigt für Broadcast nach Import
const Papa = require('papaparse');
const multer = require('multer');
const MQTT_TOPICS = require('./mqttConfig'); // Import der zentralen Topics

// Multer-Konfiguration
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

const dbPath = path.join(__dirname, 'external', 'ycontroldata_settings.sqlite');
const sqliteDB = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Fehler beim Verbinden mit der SQLite-Datenbank:', err);
  else console.log('DBRoutes: Verbindung zur SQLite-Datenbank hergestellt.');
});

// Whitelist der erlaubten Spalten
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

// Spalten, deren Änderung einen Settings-Broadcast auslöst (Dokumentation)
const settingsColumns = ['benutzer', 'visible', 'tag_top', 'tag_sub', 'TYPE', 'OPTI_de', 'OPTI_fr', 'OPTI_en', 'OPTI_it', 'MIN', 'MAX', 'unit', 'NAME_de', 'NAME_fr', 'NAME_en', 'NAME_it', 'beschreibung', 'beschreibung_fr', 'beschreibung_en', 'beschreibung_it'];
// Spalten, deren Änderung einen Menü-Broadcast auslöst (Dokumentation)
const menuRelevantColumns = ['VAR_VALUE', 'visible'];

// --- MQTT Publish Funktion ---
async function publishMqttUpdate(name, var_value) {
  const topic = MQTT_TOPICS.OUTGOING_VARIABLE_UPDATE; // Topic aus zentraler Konfig
  const payload = JSON.stringify({ name: name, value: var_value }); // Sende als Objekt

  // Prüfe, ob der globale MQTT-Client existiert und verbunden ist
  if (global.mqttClient && global.mqttClient.connected) {
      global.mqttClient.publish(topic, payload, { qos: 0, retain: false }, (error) => {
          if (error) {
              console.error(`[MQTT Publish] Fehler beim Senden an ${topic} (${name}=${var_value}):`, error);
          } else {
              // Log für erfolgreiches Senden (optional, kann bei vielen Updates verbose werden)
              // console.log(`[MQTT Publish] Update erfolgreich an ${topic} gesendet: ${name}=${var_value}`);
          }
      });
  } else {
      console.warn(`[MQTT Publish] MQTT-Client nicht verbunden. Update für ${name} kann nicht gesendet werden.`);
  }
}
// --- ENDE MQTT Publish ---

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

      // Update per MQTT senden (nur bei VAR_VALUE Änderung)
      if (target === "VAR_VALUE") {
        await publishMqttUpdate(search, value);
      }

      // Broadcasts über Socket.IO nach JEDEM erfolgreichen Update
      let didBroadcastSettings = false;
      let didBroadcastMenu = false;

      if (global.io) {
        // 1. Sende IMMER die aktualisierten Settings an alle Clients
        try {
          // broadcastSettings() holt die Daten frisch aus der DB.
          await broadcastSettings(); // Ohne Argumente => Broadcast an alle
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

        // 3. Sende das spezifische Update-Event (optional)
        global.io.emit('variable-updated', { name: search, column: target, value: value });

      } else {
        console.warn("[performVariableUpdate] global.io ist nicht verfügbar für Broadcasts.");
      }

      // Ergebnisobjekt zurückgeben
      resolve({
          message: "Datenbank erfolgreich aktualisiert.",
          changes: changes,
          settingsBroadcasted: didBroadcastSettings,
          menuBroadcasted: didBroadcastMenu,
          targetColumn: target
       });
    });
  });
}

// --- Hilfsfunktionen ---

// broadcastSettings (unverändert)
async function broadcastSettings(socket = null, user = null, db = sqliteDB) {
  const relevantSettingColumns = [
      "NAME", "NAME_de", "NAME_fr", "NAME_en", "NAME_it", "VAR_VALUE",
      "benutzer", "visible", "tag_top", "tag_sub", "TYPE",
      "OPTI_de", "OPTI_fr", "OPTI_en", "OPTI_it",
      "MIN", "MAX", "unit", "beschreibung",
      "beschreibung_fr", "beschreibung_en", "beschreibung_it"
    ].join(", ");
  const sql = `SELECT ${relevantSettingColumns} FROM QHMI_VARIABLES`;
  try {
      const rows = await new Promise((resolve, reject) => {
          db.all(sql, [], (err, rows) => err ? reject(err) : resolve(rows || []));
      });
      if (socket) {
          let filteredRows = rows;
          if (user) {
              filteredRows = rows.filter(row => {
                  const allowedUsers = (row.benutzer || '').split(',').map(u => u.trim().toLowerCase());
                  return allowedUsers.includes(user.toLowerCase()) || allowedUsers.includes('all');
              });
          } else {
              filteredRows = rows.filter(row => (row.benutzer || '').split(',').map(u => u.trim().toLowerCase()).includes('all'));
          }
          socket.emit("settings-update", filteredRows);
      } else if (global.io) {
          global.io.emit("settings-update", rows); // Broadcast an alle
      }
  } catch (err) {
      console.error("Fehler beim Abrufen/Broadcasten der Settings:", err);
      if (socket) socket.emit("settings-error", { message: "Fehler beim Laden der Einstellungen." });
  }
}

// --- Routen ---

/**
 * GET /db/export/variables.csv
 * Exportiert alle QHMI_VARIABLES als CSV-Datei.
 */
router.get('/export/variables.csv', async (req, res) => {
    console.log('[Export] Anfrage zum Exportieren von Variablen als CSV empfangen.');
    try {
        const rows = await new Promise((resolve, reject) => {
            sqliteDB.all(`SELECT * FROM QHMI_VARIABLES ORDER BY ${primaryKeyColumn} ASC`, [], (err, rows) => {
                if (err) {
                    console.error("[Export] Fehler beim Abrufen der Variablen aus der DB:", err);
                    reject(new Error("Datenbankfehler beim Export."));
                } else {
                    resolve(rows || []); // Stelle sicher, dass immer ein Array zurückgegeben wird
                }
            });
        });

        // Erzeuge CSV-String mit Header
        const csvData = Papa.unparse(rows, {
            header: true,
            quotes: true,
            skipEmptyLines: true
        });

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `ycontrol_variables_${timestamp}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.status(200).send(Buffer.from(csvData, 'utf-8')); // Als Buffer senden mit UTF-8 Encoding
        console.log(`[Export] ${rows.length} Variablen erfolgreich als ${filename} exportiert.`);

    } catch (error) {
        console.error("[Export] Unerwarteter Fehler beim Export:", error);
        res.status(500).json({ error: 'Fehler beim Erstellen der Exportdatei.', details: error.message });
    }
});

/**
 * POST /db/import/variables
 * Importiert QHMI_VARIABLES aus einer hochgeladenen CSV-Datei.
 * Sendet Status per MQTT nach Abschluss.
 */
router.post('/import/variables', upload.single('csvfile'), async (req, res) => {
    console.log('[Import] Anfrage zum Importieren von Variablen aus CSV empfangen.');
    if (!req.file) {
        return res.status(400).json({ error: 'Keine CSV-Datei hochgeladen.' });
    }

    const csvString = req.file.buffer.toString('utf-8');
    let importCounter = { inserted: 0, updated: 0, skipped: 0 };
    const errors = [];
    let statusMessage = 'Import gestartet.';
    let statusCode = 500; // Default to error

    try {
        console.log('[Import] Parse CSV-Datei...');
        const parseResult = Papa.parse(csvString, {
            header: true,
            skipEmptyLines: true,
            dynamicTyping: false, // Alle Werte als String behandeln
            transformHeader: header => header.trim()
        });

        if (parseResult.errors.length > 0) {
            throw new Error(`CSV Parse Fehler: ${parseResult.errors.map(e => `Zeile ${e.row}: ${e.message}`).join('; ')}`);
        }

        const data = parseResult.data;
        if (!data || data.length === 0) {
            throw new Error('Die CSV-Datei enthält keine Daten.');
        }
        console.log(`[Import] ${data.length} Zeilen aus CSV geparst.`);

        // Validierung der Spaltennamen
        const csvHeaders = parseResult.meta.fields;
        const invalidHeaders = csvHeaders.filter(h => !allowedColumns.includes(h));
        if (invalidHeaders.length > 0) {
             console.warn(`[Import] Ignoriere ungültige Spalten in CSV: ${invalidHeaders.join(', ')}.`);
        }
        const validDbColumns = csvHeaders.filter(h => allowedColumns.includes(h) && h !== 'id');
        if (!validDbColumns.includes(primaryKeyColumn)) {
             throw new Error(`Primärschlüssel '${primaryKeyColumn}' fehlt in den CSV-Daten.`);
        }

        console.log('[Import] Starte Datenbank-Transaktion...');
        // Upsert-Logik innerhalb einer Transaktion
        await new Promise((resolve, reject) => {
            sqliteDB.serialize(() => {
                sqliteDB.run('BEGIN TRANSACTION', async (beginErr) => {
                    if (beginErr) return reject(new Error(`DB Transaktion Startfehler: ${beginErr.message}`));

                    // Prepare Statements für Insert und Update
                    const placeholders = validDbColumns.map(() => '?').join(',');
                    const insertSql = `INSERT INTO QHMI_VARIABLES (${validDbColumns.join(',')}) VALUES (${placeholders})`;
                    const updatePlaceholders = validDbColumns.filter(col => col !== primaryKeyColumn).map(col => `${col} = ?`).join(', ');
                    const updateSql = `UPDATE QHMI_VARIABLES SET ${updatePlaceholders} WHERE ${primaryKeyColumn} = ?`;

                    try {
                        const insertStmt = sqliteDB.prepare(insertSql);
                        const updateStmt = sqliteDB.prepare(updateSql);
                        let rowNum = 0;

                        for (const row of data) {
                            rowNum++;
                            const primaryKeyValue = row[primaryKeyColumn];
                            if (primaryKeyValue === undefined || primaryKeyValue === null || String(primaryKeyValue).trim() === '') {
                                errors.push(`Zeile ${rowNum}: Primärschlüssel '${primaryKeyColumn}' fehlt oder ist leer.`);
                                importCounter.skipped++;
                                continue; // Nächste Zeile
                            }

                             // Bereite Werte für Insert/Update vor
                             const valuesForInsert = validDbColumns.map(col => row[col] !== undefined ? String(row[col]) : null);
                             const valuesForUpdate = validDbColumns.filter(col => col !== primaryKeyColumn).map(col => row[col] !== undefined ? String(row[col]) : null);
                             valuesForUpdate.push(primaryKeyValue); // PK ans Ende für WHERE

                            // Prüfen, ob Eintrag existiert
                            const exists = await new Promise((res, rej) => {
                                sqliteDB.get(`SELECT 1 FROM QHMI_VARIABLES WHERE ${primaryKeyColumn} = ?`, [primaryKeyValue], (err, result) => {
                                    if (err) rej(new Error(`DB Fehler (Existenzprüfung): ${err.message}`)); else res(!!result);
                                });
                            });

                            if (exists) {
                                // Update
                                await new Promise((res, rej) => {
                                    updateStmt.run(valuesForUpdate, function(err) { if(err) rej(err); else { importCounter.updated += this.changes > 0 ? 1 : 0; res();} });
                                });
                            } else {
                                // Insert
                                await new Promise((res, rej) => {
                                    insertStmt.run(valuesForInsert, function(err) { if(err) rej(err); else { importCounter.inserted++; res();} });
                                });
                            }
                        } // Ende for-Schleife

                         // Finalize statements
                         await Promise.all([
                              new Promise((res, rej) => insertStmt.finalize(err => err ? rej(err) : res())),
                              new Promise((res, rej) => updateStmt.finalize(err => err ? rej(err) : res()))
                         ]);

                         // Commit transaction
                         sqliteDB.run('COMMIT', (commitErr) => {
                              if (commitErr) reject(new Error(`DB Commit Fehler: ${commitErr.message}`));
                              else resolve(); // Gesamte Transaktion erfolgreich
                         });

                    } catch (processErr) {
                        // Fehler während der Zeilenverarbeitung oder Finalize -> Rollback
                        console.error("[Import] Fehler während DB-Operation, Rollback:", processErr);
                        sqliteDB.run('ROLLBACK', (rollbackErr) => { if (rollbackErr) console.error("[Import] Rollback Error:", rollbackErr); });
                        reject(processErr);
                    }
                }); // Ende BEGIN TRANSACTION Callback
            }); // Ende Serialize
        }); // Ende await new Promise

        console.log('[Import] Datenbank-Operationen abgeschlossen.');
        console.log('[Import] Ergebnis:', importCounter);
        if (errors.length > 0) {
             console.warn('[Import] Fehler während des Imports aufgetreten:', errors);
        }

        // Status und Code für Response setzen
        statusMessage = errors.length > 0 ? `Import abgeschlossen mit ${errors.length} Fehlern.` : 'Variablen erfolgreich importiert.';
        statusCode = errors.length > 0 ? 207 : 200; // 207 Multi-Status bei Fehlern

    } catch (error) {
        console.error("[Import] Unerwarteter Fehler beim Import:", error);
        statusMessage = `Fehler beim Verarbeiten der CSV-Datei: ${error.message}`;
        statusCode = 500;
        // Versuche Rollback bei unerwartetem Fehler
        sqliteDB.run('ROLLBACK', () => {});
    } finally {
        // Sende Status per MQTT
        if (global.mqttClient && global.mqttClient.connected) {
             const topic = MQTT_TOPICS.OUTGOING_IMPORT_STATUS; // Topic aus zentraler Konfig
             const mqttPayload = JSON.stringify({
                 status: statusCode === 200 || statusCode === 207 ? 'success' : 'error',
                 message: statusMessage,
                 details: importCounter,
                 errors: errors
             });
             global.mqttClient.publish(topic, mqttPayload, { qos: 1, retain: false }, (err) => { // QoS 1 für garantierte Zustellung?
                 if (err) console.error(`[MQTT Import Status] Fehler beim Senden an ${topic}:`, err);
                 else console.log(`[MQTT Import Status] Status an ${topic} gesendet.`);
             });
        }

        // Broadcast Updates an Frontend via Socket.IO (nur bei Erfolg/Teilerfolg)
        if ((statusCode === 200 || statusCode === 207) && global.io) {
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
                // Fehler hier nicht mehr an Client response anhängen, da MQTT schon gesendet wurde
            }
        }

        // Finale HTTP-Antwort an Client
        res.status(statusCode).json({
            message: statusMessage,
            inserted: importCounter.inserted,
            updated: importCounter.updated,
            skipped: importCounter.skipped,
            errors: errors
        });
    }
});


/**
 * POST /db/update-variable
 * Endpunkt für externe Systeme, um eine Variable zu aktualisieren.
 * Interne Logik wird über performVariableUpdate abgewickelt.
 */
router.post('/update-variable', async (req, res) => {
  const { key, search, target, value } = req.body;
  console.log(`[Route /update-variable] HTTP POST Empfangen: ${key}=${search}, ${target}=${value}`);
  try {
    // Direkter Aufruf der Hauptfunktion, die DB-Update und MQTT-Publish handhabt
    const result = await performVariableUpdate(key, search, target, value);
    res.json(result); // Ergebnis zurücksenden
  } catch (error) {
    console.error("Fehler in /update-variable Route:", error);
    res.status(error.message === "Ungültige Spaltenangabe." ? 400 : 500).json({ error: error.message });
  }
});

/**
 * GET /db/getAllValue
 * Gibt alle aktuellen NAME und VAR_VALUE Paare zurück.
 */
router.get('/getAllValue', (req, res) => {
  const sql = `SELECT NAME, VAR_VALUE FROM QHMI_VARIABLES`;
  sqliteDB.all(sql, [], (err, rows) => {
    if (err) {
      console.error("Fehler bei der Datenbankabfrage:", err);
      return res.status(500).json({ error: "Fehler beim Abfragen der Datenbank." });
    }
    res.json(rows || []); // Leeres Array statt null zurückgeben
  });
});

/**
 * POST /db/update-batch
 * Endpunkt für externe Systeme, um mehrere Variablen zu aktualisieren.
 */
router.post('/update-batch', async (req, res) => {
    const { updates } = req.body;
    if (!Array.isArray(updates)) {
        return res.status(400).json({ error: "Das Feld 'updates' muss ein Array sein." });
    }
    console.log(`[Route /update-batch] HTTP POST Empfangen mit ${updates.length} Updates.`);

    const results = [];
    const errors = [];
    let settingsChanged = false;
    let menuChanged = false;
    let checkMqttAfterBatch = false; // Flag, ob MQTT Property Check nötig ist

    const runDbUpdate = (sql, params) => new Promise((resolve, reject) => {
         sqliteDB.run(sql, params, function(err) { err ? reject(err) : resolve(this.changes); });
    });

    // Batch Updates innerhalb einer Transaktion
    sqliteDB.serialize(() => {
        sqliteDB.run('BEGIN TRANSACTION', async (beginErr) => {
            if (beginErr) {
                console.error("[update-batch] Begin Transaction Error:", beginErr);
                return res.status(500).json({ error: "Datenbankfehler (Begin Transaction)", details: beginErr.message });
            }

            try {
                for (const [index, updateObj] of updates.entries()) {
                    // Validierung des Update-Objekts
                    if (!updateObj.target || updateObj.value === undefined || !updateObj.key || !updateObj.search || !allowedColumns.includes(updateObj.key) || !allowedColumns.includes(updateObj.target)) {
                        errors.push({ index, error: "Ungültiges Update-Objekt", data: updateObj });
                        continue; // Überspringe dieses ungültige Update
                    }

                    try {
                        // DB-Update durchführen
                        const sql = `UPDATE QHMI_VARIABLES SET ${updateObj.target} = ? WHERE ${updateObj.key} = ?`;
                        const changes = await runDbUpdate(sql, [updateObj.value, updateObj.search]);
                        results.push({ index, changes });

                        // Flags für finale Aktionen setzen
                        if (settingsColumns.includes(updateObj.target)) settingsChanged = true;
                        if (menuRelevantColumns.includes(updateObj.target)) menuChanged = true;

                        // MQTT senden, wenn VAR_VALUE geändert wurde
                        if (updateObj.target === "VAR_VALUE") {
                            await publishMqttUpdate(updateObj.search, updateObj.value);
                            checkMqttAfterBatch = true; // Markiere, dass ein MQTT Check nach dem Batch sinnvoll ist
                        }
                    } catch (err) {
                        console.error(`[update-batch] DB Update Fehler bei Index ${index}:`, err);
                        errors.push({ index, error: err.message, data: updateObj });
                        // Optional: throw err; // Um bei Fehler die Transaktion abzubrechen
                    }
                } // Ende der for-Schleife

                // Transaktion abschließen
                sqliteDB.run('COMMIT', async (commitErr) => {
                    if (commitErr) {
                        console.error("[update-batch] Commit Error:", commitErr);
                        errors.push({ index: -1, error: "Commit fehlgeschlagen", details: commitErr.message });
                         return res.status(500).json({ message: "Fehler beim Abschließen der Batch-Updates.", errors, successes: results });
                    }

                    console.log(`[update-batch] Transaction committed. ${results.length} successful updates, ${errors.length} errors.`);

                    // Finale Aktionen NACH erfolgreichem Commit (Socket.IO Broadcasts)
                    if (global.io) {
                        if (settingsChanged || menuChanged) { // Immer Settings senden, wenn etwas relevantes geändert wurde
                            console.log("[update-batch] Broadcasting settings...");
                            await broadcastSettings();
                        }
                        if (menuChanged) {
                            console.log("[update-batch] Broadcasting menu...");
                            try {
                                const menu = await fetchMenuForFrontend(sqliteDB);
                                global.io.emit("menu-update", menu);
                                // MQTT Check für Menü-Properties auslösen, wenn nötig
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
                                errors.push({ index: -1, error: "Menü-Broadcast fehlgeschlagen", details: menuErr.message });
                            }
                        }
                        // Event senden, dass Batch fertig ist
                        global.io.emit('batch-update-complete', { success: errors.length === 0, errors, count: results.length });
                    }

                    // HTTP Response senden
                    res.status(errors.length > 0 ? 207 : 200).json({ // 207 Multi-Status
                       message: errors.length > 0 ? "Batch-Updates mit Fehlern abgeschlossen." : "Alle Batch-Updates wurden erfolgreich ausgeführt.",
                       errors,
                       successes: results
                    });
                }); // Ende Commit Callback

            } catch (transactionError) {
                // Fehler innerhalb der Transaktionslogik
                console.error("[update-batch] Error during transaction, rolling back:", transactionError);
                sqliteDB.run('ROLLBACK', (rollbackErr) => { if (rollbackErr) console.error("[update-batch] Rollback Error:", rollbackErr); });
                res.status(500).json({ message: "Fehler während der Batch-Verarbeitung, Änderungen zurückgerollt.", error: transactionError.message, errors, successes: results });
            }
        }); // Ende Begin Transaction Callback
    }); // Ende Serialize
});

// Exportiere Router und die benötigten Funktionen für server.js
module.exports = router;
module.exports.performVariableUpdate = performVariableUpdate;
module.exports.broadcastSettings = broadcastSettings;