// src/dbRoutes.js
const express = require('express');
const path = require('path');
const router = express.Router();
const db = require('./db'); // Import der Singleton-Datenbankverbindung

// Node-RED-Endpoint
const nodeRedUrl = 'http://192.168.10.31:1880/db/Changes';

// Erlaubte Spaltennamen (Whitelist)
const allowedColumns = [
  'id', 'NAME', 'VAR_VALUE', 'unit', 'TYPE', 'OPTI', 'adresse', 'faktor',
  'MIN', 'MAX', 'EDITOR', 'sort', 'visible', 'HKL', 'HKL_Feld',
  'updated_at', 'created_at', 'last_modified', 'tag_top', 'tag_sub',
  'benutzer', 'beschreibung', 'NAME_fr', 'NAME_en', 'NAME_it',
  'OPTI_fr', 'OPTI_en', 'OPTI_it', 'beschreibung_fr', 'beschreibung_en', 'beschreibung_it',
];

async function sendNodeRedUpdate(name, var_value) {
  try {
    const { default: fetch } = await import('node-fetch');
    const payload = {};
    payload[name] = var_value;
    const response = await fetch(nodeRedUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    console.log('Node-RED update successful:', data);
  } catch (error) {
    console.error('Error updating Node-RED:', error);
  }
}

async function sendFullDbUpdate() {
  db.all('SELECT * FROM QHMI_VARIABLES', [], async (err, rows) => {
    if (err) {
      console.error('Fehler beim Abrufen der kompletten Datenbank:', err);
      return;
    }
    try {
      const { default: fetch } = await import('node-fetch');
      const response = await fetch('http://192.168.10.31:1880/db/fullChanges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rows),
      });
      const data = await response.json();
      console.log('Gesamte DB-Änderung erfolgreich gesendet:', data);
    } catch (error) {
      console.error('Fehler beim Senden der kompletten DB-Änderung:', error);
    }
  });
}

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
  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('Fehler beim Abrufen der Settings:', err);
      return;
    }
    global.io.emit('settings-update', rows);
  });
}

router.post('/update-variable', (req, res) => {
  const { key, search, target, value } = req.body;

  if (!allowedColumns.includes(key) || !allowedColumns.includes(target)) {
    return res.status(400).json({ error: 'Ungültige Spaltenangabe.' });
  }

  const sql = `UPDATE QHMI_VARIABLES SET ${target} = ? WHERE ${key} = ?`;

  db.run(sql, [value, search], function (err) {
    if (err) {
      console.error('Fehler beim Aktualisieren der Datenbank:', err);
      return res.status(500).json({ error: 'Fehler beim Aktualisieren der Datenbank.' });
    }

    if (target === 'VAR_VALUE') {
      sendNodeRedUpdate(search, value);
    }

    sendFullDbUpdate();
    broadcastSettings();

    res.json({ message: 'Datenbank erfolgreich aktualisiert.', changes: this.changes });
  });
});

router.get('/getAllValue', (req, res) => {
  const sql = `SELECT NAME, VAR_VALUE FROM QHMI_VARIABLES`;
  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('Fehler bei der Datenbankabfrage:', err);
      return res.status(500).json({ error: 'Fehler beim Abfragen der Datenbank.' });
    }
    res.json(rows);
  });
});

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
      errors.push({ index, error: 'Ungültiges Update-Objekt' });
      checkFinish();
      return;
    }
    db.run(updateObj.sql, updateObj.params, function (err) {
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
      if (errors.length > 0) {
        res.status(500).json({ message: 'Einige Updates konnten nicht ausgeführt werden.', errors });
      } else {
        res.json({ message: 'Alle Updates wurden erfolgreich ausgeführt.', count: executed });
      }
    }
  }
});

module.exports = router;