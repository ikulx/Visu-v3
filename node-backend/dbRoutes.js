// src/dbRoutes.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const router = express.Router();

// Node-RED-Endpoint (anpassen, falls erforderlich)
const nodeRedUrl = 'http://192.168.10.31:1880/db/Changes';

// Verbindung zur SQLite-Datenbank herstellen
const dbPath = path.join(__dirname, 'external', 'ycontroldata_settings.sqlite');
const sqliteDB = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Fehler beim Verbinden mit der SQLite-Datenbank:', err);
  } else {
    console.log('Verbindung zur SQLite-Datenbank hergestellt.');
  }
});

// Importiere Funktionen aus menuHandler.js und mqttHandler.js
const { fetchMenuForFrontend } = require('./menuHandler');
const { updateCachedMenuData, checkAndSendMqttUpdates } = require('./mqttHandler');

// Erlaubte Spaltennamen (Whitelist) aus dem Schema der Tabelle QHMI_VARIABLES
const allowedColumns = [
  "id", "NAME", "VAR_VALUE", "unit", "TYPE", "OPTI", "adresse", "faktor",
  "MIN", "MAX", "EDITOR", "sort", "visible", "HKL", "HKL_Feld",
  "updated_at", "created_at", "last_modified", "tag_top", "tag_sub",
  "benutzer", "beschreibung", "NAME_fr", "NAME_en", "NAME_it",
  "OPTI_fr", "OPTI_en", "OPTI_it", "beschreibung_fr", "beschreibung_en", "beschreibung_it"
];

async function sendNodeRedUpdate(name, var_value) {
  try {
    const { default: fetch } = await import('node-fetch');
    const payload = {};
    payload[name] = var_value;
    const response = await fetch(nodeRedUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    console.log("Node-RED update successful:", data);
  } catch (error) {
    console.error("Error updating Node-RED:", error);
  }
}

// Funktion zum Senden der kompletten DB an Node-RED
async function sendFullDbUpdate() {
  sqliteDB.all("SELECT * FROM QHMI_VARIABLES", [], async (err, rows) => {
    if (err) {
      console.error("Fehler beim Abrufen der kompletten Datenbank:", err);
      return;
    }
    try {
      const { default: fetch } = await import('node-fetch');
      const response = await fetch('http://192.168.10.31:1880/db/fullChanges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rows)
      });
      const data = await response.json();
      console.log("Gesamte DB-Änderung erfolgreich gesendet:", data);
    } catch (error) {
      console.error("Fehler beim Senden der kompletten DB-Änderung:", error);
    }
  });
}

// Funktion zum Broadcasten der Settings über Socket.IO
function broadcastSettings() {
  const sql = `SELECT 
                 NAME, 
                 NAME_de, 
                 NAME_fr, 
                 NAME_en, 
                 NAME_it, 
                 VAR_VALUE, 
                 benutzer, 
                 visible, 
                 tag_top, 
                 tag_sub,
                 TYPE,
                 OPTI_de,
                 OPTI_fr,
                 OPTI_en,
                 OPTI_it,
                 MIN,
                 MAX,
                 unit
               FROM QHMI_VARIABLES`;
  sqliteDB.all(sql, [], (err, rows) => {
    if (err) {
      console.error("Fehler beim Abrufen der Settings:", err);
      return;
    }
    // Nutze die globale Socket.IO-Instanz, die in server.js gesetzt wurde
    global.io.emit("settings-update", rows);
  });
}

// Endpunkt zum Aktualisieren von Werten in der SQLite-Datenbank
router.post('/update-variable', (req, res) => {
  const { key, search, target, value } = req.body;
  
  if (!allowedColumns.includes(key) || !allowedColumns.includes(target)) {
    return res.status(400).json({ error: "Ungültige Spaltenangabe." });
  }
  
  const sql = `UPDATE QHMI_VARIABLES SET ${target} = ? WHERE ${key} = ?`;
  
  sqliteDB.run(sql, [value, search], function(err) {
    if (err) {
      console.error("Fehler beim Aktualisieren der Datenbank:", err);
      return res.status(500).json({ error: "Fehler beim Aktualisieren der Datenbank." });
    }
    
    if (target === "VAR_VALUE") {
      sendNodeRedUpdate(search, value);
    }
    
    sendFullDbUpdate();
    broadcastSettings();
    fetchMenuForFrontend(sqliteDB)
      .then((menu) => {
        global.io.emit("menu-update", menu);
      })
      .catch(err => console.error("Fehler beim Aktualisieren des Menüs:", err));
    
    res.json({ message: "Datenbank erfolgreich aktualisiert.", changes: this.changes });
  });
});

// Endpunkt zum Abrufen aller VAR_VALUE-Werte
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

// Endpunkt für Batch-Updates
router.post('/update-batch', (req, res) => {
  const { updates } = req.body;
  if (!Array.isArray(updates)) {
    return res.status(400).json({ error: "Das Feld 'updates' muss ein Array sein." });
  }

  let errors = [];
  let executed = 0;
  const total = updates.length;

  updates.forEach((updateObj, index) => {
    if (!updateObj.sql || !updateObj.params) {
      errors.push({ index, error: "Ungültiges Update-Objekt" });
      checkFinish();
      return;
    }
    sqliteDB.run(updateObj.sql, updateObj.params, function(err) {
      if (err) {
        errors.push({ index, error: err.message });
      }
      checkFinish();
    });
  });

  function checkFinish() {
    executed++;
    if (executed === total) {
      broadcastSettings();
      // Nach Abschluss der Batch-Updates: Menü neu auflösen und an Clients senden
      fetchMenuForFrontend(sqliteDB)
        .then((menu) => {
          global.io.emit("menu-update", menu);
          // Neu: Überprüfe, ob MQTT-Propertys gesendet werden sollen (z. B. wenn sich Konfigurationen geändert haben)
          checkAndSendMqttUpdates(global.io, sqliteDB);
          if (errors.length > 0) {
            res.status(500).json({ message: "Einige Updates konnten nicht ausgeführt werden.", errors });
          } else {
            res.json({ message: "Alle Updates wurden erfolgreich ausgeführt.", count: executed });
          }
        })
        .catch(err => {
          console.error("Fehler beim Aktualisieren des Menüs:", err);
          if (errors.length > 0) {
            res.status(500).json({ message: "Einige Updates konnten nicht ausgeführt werden.", errors });
          } else {
            res.status(500).json({ message: "Fehler beim Aktualisieren des Menüs." });
          }
        });
    }
  }
});

module.exports = router;
