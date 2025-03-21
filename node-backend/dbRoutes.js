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
  
  // Überprüfen, ob die Spaltennamen in der Whitelist enthalten sind
  if (!allowedColumns.includes(key) || !allowedColumns.includes(target)) {
    return res.status(400).json({ error: "Ungültige Spaltenangabe." });
  }
  
  // Dynamisches Update-Statement; Spaltennamen sind sicher, da geprüft
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


module.exports = router;
