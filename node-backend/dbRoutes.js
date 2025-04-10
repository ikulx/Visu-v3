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
const settingsColumns = ['benutzer', 'visible', 'tag_top', 'tag_sub', 'TYPE', 'OPTI_de', 'OPTI_fr', 'OPTI_en', 'OPTI_it', 'MIN', 'MAX', 'unit', 'NAME_de', 'NAME_fr', 'NAME_en', 'NAME_it', 'beschreibung', 'beschreibung_fr', 'beschreibung_en', 'beschreibung_it'];
// Spalten, deren Änderung einen Menü-Broadcast auslöst
const menuRelevantColumns = ['VAR_VALUE', 'visible'];

// --- Konsolidierte Update-Funktion ---
async function performVariableUpdate(key, search, target, value) {
  return new Promise((resolve, reject) => {
    if (!allowedColumns.includes(key) || !allowedColumns.includes(target)) {
      console.warn(`[performVariableUpdate] Ungültige Spaltenanfrage: key=${key}, target=${target}`);
      return reject(new Error("Ungültige Spaltenangabe."));
    }

    const sql = `UPDATE QHMI_VARIABLES SET ${target} = ? WHERE ${key} = ?`;

    sqliteDB.run(sql, [value, search], async function (err) {
      if (err) {
        console.error(`[performVariableUpdate] Fehler beim DB-Update für ${target}=${value} bei ${key}=${search}:`, err);
        return reject(new Error("Fehler beim Aktualisieren der Datenbank."));
      }

      const changes = this.changes;
      console.log(`[performVariableUpdate] ${target} für ${key}=${search} auf ${value} gesetzt. Änderungen: ${changes}`);

      // Update an Node-RED senden (nur bei VAR_VALUE Änderung)
      if (target === "VAR_VALUE") {
        try {
          await sendNodeRedUpdate(search, value);
        } catch (nodeRedErr) {
          console.error(`[performVariableUpdate] Fehler beim Senden an Node-RED:`, nodeRedErr);
        }
      }

      // Broadcasts über Socket.IO
      let didBroadcastSettings = false;
      let didBroadcastMenu = false;
      if (global.io) {
        global.io.emit('variable-updated', { name: search, column: target, value: value });
        // console.log(`[performVariableUpdate] Event 'variable-updated' gesendet.`); // Optional: Weniger Logging

        if (settingsColumns.includes(target)) {
          await broadcastSettings(); // Sendet alle Settings an alle Clients
          didBroadcastSettings = true;
          console.log(`[performVariableUpdate] Settings-Broadcast getriggert durch Änderung an '${target}'.`);
        }

        if (menuRelevantColumns.includes(target)) {
            try {
                 const menu = await fetchMenuForFrontend(sqliteDB);
                 global.io.emit("menu-update", menu); // Sendet das gesamte, neu aufgelöste Menü
                 didBroadcastMenu = true;
                 console.log(`[performVariableUpdate] Menü-Broadcast getriggert durch Änderung an '${target}'.`);
            } catch(menuErr) {
                console.error("[performVariableUpdate] Fehler beim Senden des Menü-Updates:", menuErr);
            }
        }
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
async function sendNodeRedUpdate(name, var_value) {
  try {
      const { default: fetch } = await import('node-fetch');
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
      const { default: fetch } = await import('node-fetch');
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

async function broadcastSettings(socket = null, user = null) {
  const sql = `SELECT NAME, NAME_de, NAME_fr, NAME_en, NAME_it, VAR_VALUE, benutzer, visible, tag_top, tag_sub, TYPE, OPTI_de, OPTI_fr, OPTI_en, OPTI_it, MIN, MAX, unit FROM QHMI_VARIABLES`;
  try {
      const rows = await new Promise((resolve, reject) => {
          sqliteDB.all(sql, [], (err, rows) => err ? reject(err) : resolve(rows));
      });

      if (socket) { // Sende an spezifisches Socket (mit Filter)
          let filteredRows = rows;
          if (user) {
              filteredRows = rows.filter(row => {
                  if (!row.benutzer) return false;
                  const allowedUsers = row.benutzer.split(',').map(u => u.trim().toLowerCase());
                  return allowedUsers.includes(user.toLowerCase());
              });
          }
          socket.emit("settings-update", filteredRows);
          // console.log(`[broadcastSettings] Settings an Socket ${socket.id} gesendet (User: ${user}, ${filteredRows.length} Einträge).`);
      } else if (global.io) { // Broadcast an alle
          console.log("[broadcastSettings] Broadcasting all settings to all clients.");
          global.io.emit("settings-update", rows);
      }

  } catch (err) {
      console.error("Fehler beim Abrufen/Broadcasten der Settings:", err);
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
        await checkAndSendMqttUpdates(global.io, sqliteDB);
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

    for (const [index, updateObj] of updates.entries()) {
        if (!updateObj.target || !updateObj.value || !updateObj.key || !updateObj.search || !allowedColumns.includes(updateObj.key) || !allowedColumns.includes(updateObj.target)) {
            errors.push({ index, error: "Ungültiges Update-Objekt", data: updateObj });
            continue;
        }

        try {
            const sql = `UPDATE QHMI_VARIABLES SET ${updateObj.target} = ? WHERE ${updateObj.key} = ?`;
            const changes = await runDbUpdate(sql, [updateObj.value, updateObj.search]);
            results.push({ index, changes });

            if (settingsColumns.includes(updateObj.target)) settingsChanged = true;
            if (menuRelevantColumns.includes(updateObj.target)) menuChanged = true;
            if(updateObj.target === "VAR_VALUE") checkMqttAfterBatch = true;

            if (updateObj.target === "VAR_VALUE") {
                await sendNodeRedUpdate(updateObj.search, updateObj.value);
            }
        } catch (err) {
            console.error(`[update-batch] Fehler bei Index ${index}:`, err);
            errors.push({ index, error: err.message, data: updateObj });
        }
    }

    // Finale Aktionen
    if (global.io) {
        if (settingsChanged) await broadcastSettings();
        if (menuChanged) {
             try {
                  const menu = await fetchMenuForFrontend(sqliteDB);
                  global.io.emit("menu-update", menu);
                  if (checkMqttAfterBatch) {
                     console.log("[update-batch] Trigger checkAndSendMqttUpdates nach Batch.");
                     await checkAndSendMqttUpdates(global.io, sqliteDB);
                  }
             } catch(menuErr) {
                 console.error("[update-batch] Fehler beim Senden des Menü-Updates:", menuErr);
             }
        }
        global.io.emit('batch-update-complete', { success: errors.length === 0, errors });
    }

    if (errors.length > 0) {
        res.status(500).json({ message: "Einige Batch-Updates konnten nicht ausgeführt werden.", errors, successes: results });
    } else {
        res.json({ message: "Alle Batch-Updates wurden erfolgreich ausgeführt.", count: results.length });
    }
});


// Exportiere Router und die benötigten Funktionen
module.exports = router; // Router als Default Export
module.exports.performVariableUpdate = performVariableUpdate;
module.exports.broadcastSettings = broadcastSettings;
module.exports.sendNodeRedUpdate = sendNodeRedUpdate;