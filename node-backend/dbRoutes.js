const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
// node-fetch wird hier nicht über require eingebunden, da es in Version 3 ESM-only ist

const router = express.Router();

// Node-RED-Endpoint (anpassen, falls erforderlich)
const nodeRedUrl = 'http://192.168.10.31:1880/db/Changes';

// Verbindung zur SQLite-Datenbank herstellen
const dbPath = path.join(__dirname, 'external', 'ycontroldata_settings.db');
const sqliteDB = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Fehler beim Verbinden mit der SQLite-Datenbank:', err);
  } else {
    console.log('Verbindung zur SQLite-Datenbank hergestellt.');
  }
});

// Erlaubte Spaltennamen (Whitelist) aus dem Schema der Tabelle QHMI_VARIABLES
const allowedColumns = [
  "id", "NAME", "VAR_VALUE", "unit", "TYPE", "OPTI", "adresse", "faktor",
  "MIN", "MAX", "EDITOR", "sort", "visible", "HKL", "HKL_Feld",
  "updated_at", "created_at", "last_modified", "tag_top", "tag_sub",
  "benutzer", "beschreibung", "NAME_fr", "NAME_en", "NAME_it",
  "OPTI_fr", "OPTI_en", "OPTI_it", "beschreibung_fr", "beschreibung_en", "beschreibung_it"
];

// Funktion, um bei einer Änderung der Spalte VAR_VALUE ein Update an Node-RED zu senden
async function sendNodeRedUpdate(name, var_value) {
  try {
    // Dynamischer Import von node-fetch, um den ESM-Only Fehler zu vermeiden
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

// Endpunkt zum Aktualisieren von Werten in der SQLite-Datenbank
// Beispiel-JSON: { "key": "NAME", "search": "Name 1", "target": "VAR_VALUE", "value": "Name neu" }
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
    
    // Falls die geänderte Spalte VAR_VALUE ist, sende Update an Node-RED
    if (target === "VAR_VALUE") {
      sendNodeRedUpdate(search, value);
    }
    
    // Sende zusätzlich die komplette DB an den neuen Endpoint
    sendFullDbUpdate();
    
    res.json({ message: "Datenbank erfolgreich aktualisiert.", changes: this.changes });
  });
});


// Endpunkt zum Abrufen aller VAR_VALUE-Werte als Array von JSON-Objekten
router.get('/getAllValue', (req, res) => {
  const sql = `SELECT NAME, VAR_VALUE FROM QHMI_VARIABLES`;
  sqliteDB.all(sql, [], (err, rows) => {
    if (err) {
      console.error("Fehler bei der Datenbankabfrage:", err);
      return res.status(500).json({ error: "Fehler beim Abfragen der Datenbank." });
    }
    // rows ist ein Array von Objekten, z. B.:
    // [ { NAME: "Name 1", VAR_VALUE: "Wert 1" }, { NAME: "Name 2", VAR_VALUE: "Wert 2" } ]
    res.json(rows);
  });
});

// Neuer Endpunkt zum Ausführen mehrerer Updates
router.post('/update-batch', (req, res) => {
  const { updates } = req.body;
  if (!Array.isArray(updates)) {
    return res.status(400).json({ error: "Das Feld 'updates' muss ein Array sein." });
  }

  let errors = [];
  let executed = 0;
  const total = updates.length;

  // Abarbeiten der Updates
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
      if (errors.length > 0) {
        res.status(500).json({ message: "Einige Updates konnten nicht ausgeführt werden.", errors });
      } else {
        res.json({ message: "Alle Updates wurden erfolgreich ausgeführt.", count: executed });
      }
    }
  }
});

// Neuer Node-RED-Endpoint für die komplette DB
const nodeRedFullDbUrl = 'http://192.168.10.31:1880/db/fullChanges';

// Funktion, um die gesamte DB an Node-RED zu senden
async function sendFullDbUpdate() {
  sqliteDB.all("SELECT * FROM QHMI_VARIABLES", [], async (err, rows) => {
    if (err) {
      console.error("Fehler beim Abrufen der kompletten Datenbank:", err);
      return;
    }
    try {
      const { default: fetch } = await import('node-fetch');
      const response = await fetch(nodeRedFullDbUrl, {
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


module.exports = router;
