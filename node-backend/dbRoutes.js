// src/dbRoutes.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
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

// Erlaubte Spaltennamen (Whitelist)
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

// HTTP-Endpunkt zum Aktualisieren von Werten in der SQLite-Datenbank (außer "benutzer")
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
      if (errors.length > 0) {
        res.status(500).json({ message: "Einige Updates konnten nicht ausgeführt werden.", errors });
      } else {
        res.json({ message: "Alle Updates wurden erfolgreich ausgeführt.", count: executed });
      }
    }
  }
});

// Neuer Socket-Endpunkt für differenzielle Aktualisierung der Spalte "benutzer"
// Erwartet Payload: { key, search, newUsers } wobei newUsers ein kommagetrennter String ist.
function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log('Neuer Client verbunden:', socket.id);
    
    socket.on('update-users-diff', (data, callback) => {
      const { key, search, newUsers } = data;
      
      if (!allowedColumns.includes(key) || !allowedColumns.includes("benutzer")) {
        if (callback) callback({ error: "Ungültige Spaltenangabe." });
        return;
      }
      
      const selectSql = `SELECT benutzer FROM QHMI_VARIABLES WHERE ${key} = ?`;
      sqliteDB.get(selectSql, [search], (err, row) => {
        if (err) {
          console.error("Fehler beim Abrufen der aktuellen Benutzer:", err);
          if (callback) callback({ error: "Fehler beim Abrufen der aktuellen Benutzer." });
          return;
        }
        const currentUsers = row && row.benutzer 
          ? row.benutzer.split(',').map(u => u.trim()).filter(u => u)
          : [];
        // newUsers vom Frontend als kommagetrennter String in ein Array umwandeln;
        // falls newUsers undefined ist, wird ein leerer String genutzt.
        const desiredUsers = (typeof newUsers === 'string' ? newUsers : '')
          .split(',').map(u => u.trim()).filter(u => u);
        
        console.log("Current Users:", currentUsers);
        console.log("Desired Users:", desiredUsers);
        
        // Falls keine Änderung vorliegt, Rückmeldung senden.
        if (JSON.stringify(currentUsers.sort()) === JSON.stringify(desiredUsers.sort())) {
          if (callback) callback({ message: "Keine Änderung." });
          return;
        }
        
        const newBenutzer = desiredUsers.join(', ');
        const updateSql = `UPDATE QHMI_VARIABLES SET benutzer = ? WHERE ${key} = ?`;
        sqliteDB.run(updateSql, [newBenutzer, search], function(err) {
          if (err) {
            console.error("Fehler beim Aktualisieren der Benutzer:", err);
            if (callback) callback({ error: "Fehler beim Aktualisieren der Benutzer." });
            return;
          }
          sendFullDbUpdate();
          broadcastSettings();
          if (callback) callback({ message: "Benutzer erfolgreich aktualisiert.", changes: this.changes, updatedUsers: desiredUsers });
        });
      });
    });
    
    // Vorhandene Socket-Events
    socket.on('update-variable', (payload) => {
      if (!payload.key || !payload.search || !payload.target) {
        socket.emit("update-error", { message: "Ungültiger Payload" });
        return;
      }
      const sql = `UPDATE QHMI_VARIABLES SET ${payload.target} = ? WHERE ${payload.key} = ?`;
      sqliteDB.run(sql, [payload.value, payload.search], function(err) {
        if (err) {
          console.error("Fehler beim Aktualisieren der Datenbank:", err);
          socket.emit("update-error", { message: "Fehler beim Aktualisieren der Datenbank." });
          return;
        }
        if (payload.target === "VAR_VALUE") {
          sendNodeRedUpdate(payload.search, payload.value);
        }
        sendFullDbUpdate();
        broadcastSettings();
        socket.emit("update-success", { changes: this.changes });
      });
    });
    
    socket.on('set-user', (data) => {
      socket.loggedInUser = data.user;
      console.log(`Socket ${socket.id} registriert Benutzer: ${data.user}`);
      broadcastSettings();
    });
    
    socket.on('request-settings', (data) => {
      const user = data && data.user ? data.user : null;
      socket.loggedInUser = user;
      broadcastSettings();
    });
    
    socket.on('disconnect', () => {
      console.log('Client getrennt:', socket.id);
    });
  });
}

module.exports = { router, registerSocketHandlers };
