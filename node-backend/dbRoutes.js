// src/dbRoutes.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const router = express.Router();
const { fetchMenuForFrontend } = require('./menuHandler'); // Benötigt für Menü-Broadcast

// Importiere checkAndSendMqttUpdates wieder, um es nach Batch aufzurufen
const { checkAndSendMqttUpdates } = require('./mqttHandler');

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
  "benutzer", "beschreibung", "NAME_fr", "NAME_en", "NAME_it", "NAME_de", // NAME_de hinzugefügt
  "OPTI_fr", "OPTI_en", "OPTI_it", "OPTI_de", // OPTI_de hinzugefügt
  "beschreibung_fr", "beschreibung_en", "beschreibung_it"
];
// Spalten, deren Änderung einen Settings-Broadcast auslöst
// HINWEIS: Diese Liste wird *nicht* mehr verwendet, um den Broadcast zu steuern,
// aber sie kann zur Dokumentation oder für zukünftige spezifische Logik nützlich sein.
const settingsColumns = ['benutzer', 'visible', 'tag_top', 'tag_sub', 'TYPE', 'OPTI_de', 'OPTI_fr', 'OPTI_en', 'OPTI_it', 'MIN', 'MAX', 'unit', 'NAME_de', 'NAME_fr', 'NAME_en', 'NAME_it', 'beschreibung', 'beschreibung_fr', 'beschreibung_en', 'beschreibung_it'];
// Spalten, deren Änderung einen Menü-Broadcast auslöst
// HINWEIS: Diese Liste wird *nicht* mehr verwendet, um den Broadcast zu steuern.
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


// --- Express Routen ---
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
module.exports.sendNodeRedUpdate = sendNodeRedUpdate;