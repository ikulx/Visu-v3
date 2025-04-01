// src/server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const dbRoutes = require('./dbRoutes');
const { setupMqtt, updateCachedMenuData } = require('./mqttHandler');
const {
  fetchMenuForFrontend,
  setupMenuHandlers,
  updateMenuHandler,
  updatePropertiesHandler,
  defaultMenu
} = require('./menuHandler');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
global.io = io;

app.use(bodyParser.json());

// SQLite database connection
const dbPath = path.join(__dirname, 'external', 'ycontroldata_settings.sqlite');
const sqliteDB = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Fehler beim Verbinden mit der SQLite-Datenbank:', err);
  } else {
    console.log('Verbindung zur SQLite-Datenbank hergestellt.');
    sqliteDB.run(`
      CREATE TABLE IF NOT EXISTS "menu_items" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "label" VARCHAR,
        "link" VARCHAR,
        "svg" VARCHAR,
        "enable" BOOLEAN DEFAULT 1,
        "parent_id" INTEGER,
        "sort_order" INTEGER,
        "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M','now', 'localtime')),
        "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M','now', 'localtime')),
        FOREIGN KEY ("parent_id") REFERENCES "menu_items" ("id") ON DELETE CASCADE
      )
    `);
    sqliteDB.run(`
      CREATE TABLE IF NOT EXISTS "menu_properties" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "menu_item_id" INTEGER,
        "key" VARCHAR,
        "value" VARCHAR,
        "source_type" VARCHAR CHECK(source_type IN ('static', 'dynamic', 'mqtt')),
        "source_key" VARCHAR,
        "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M','now', 'localtime')),
        "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M','now', 'localtime')),
        FOREIGN KEY ("menu_item_id") REFERENCES "menu_items" ("id") ON DELETE CASCADE
      )
    `);
    sqliteDB.run(`
      CREATE TABLE IF NOT EXISTS "menu_actions" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "menu_item_id" INTEGER,
        "action_name" VARCHAR,
        "qhmi_variable_name" VARCHAR,
        "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M','now', 'localtime')),
        "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M','now', 'localtime')),
        FOREIGN KEY ("menu_item_id") REFERENCES "menu_items" ("id") ON DELETE CASCADE
      )
    `);
  }
});

let currentFooter = { temperature: '–' };

// Menü-Handler initialisieren
const { currentMenu } = setupMenuHandlers(io, sqliteDB, updateCachedMenuData, fetchMenuForFrontend);

// API-Endpunkte
app.post('/update-menu', (req, res) => updateMenuHandler(req, res, sqliteDB, fetchMenuForFrontend));
app.post('/update-properties', (req, res) => updatePropertiesHandler(req, res, sqliteDB, fetchMenuForFrontend));

app.post('/setFooter', (req, res) => {
  const footerUpdate = req.body;
  currentFooter = { ...currentFooter, ...footerUpdate };
  io.emit('footer-update', currentFooter);
  res.sendStatus(200);
});

async function sendNodeRedUpdate(name, var_value) {
  try {
    const { default: fetch } = await import('node-fetch');
    const payload = { [name]: var_value };
    const response = await fetch('http://192.168.10.31:1880/db/Changes', {
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

function broadcastSettings(socket = null, user = null) {
  const sql = `SELECT 
                 NAME, NAME_de, NAME_fr, NAME_en, NAME_it, 
                 VAR_VALUE, benutzer, visible, tag_top, tag_sub,
                 TYPE, OPTI_de, OPTI_fr, OPTI_en, OPTI_it, 
                 MIN, MAX, unit
               FROM QHMI_VARIABLES`;
  sqliteDB.all(sql, [], (err, rows) => {
    if (err) {
      console.error("Fehler beim Abrufen der Settings:", err);
      return;
    }
    let filteredRows = rows;
    if (user) {
      filteredRows = rows.filter(row => {
        if (!row.benutzer) return false;
        const allowedUsers = row.benutzer.split(',').map(u => u.trim().toLowerCase());
        return allowedUsers.includes(user.toLowerCase());
      });
    }
    if (socket) {
      socket.emit("settings-update", filteredRows);
    } else {
      for (const [id, s] of io.sockets.sockets) {
        const usr = s.loggedInUser;
        let filtered = rows;
        if (usr) {
          filtered = rows.filter(row => {
            if (!row.benutzer) return false;
            const allowedUsers = row.benutzer.split(',').map(u => u.trim().toLowerCase());
            return allowedUsers.includes(usr.toLowerCase());
          });
        }
        s.emit("settings-update", filtered);
      }
    }
  });
}

io.on('connection', (socket) => {
  console.log('Neuer Client verbunden:', socket.id);
  socket.emit('footer-update', currentFooter);
  broadcastSettings(socket);

  socket.on('set-user', (data) => {
    socket.loggedInUser = data.user;
    console.log(`Socket ${socket.id} registriert Benutzer: ${data.user}`);
    broadcastSettings(socket, data.user);
  });

  socket.on('request-settings', (data) => {
    const user = data && data.user ? data.user : null;
    socket.loggedInUser = user;
    console.log(`Socket ${socket.id} fordert Settings für Benutzer: ${user}`);
    broadcastSettings(socket, user);
  });

  socket.on('update-variable', (payload) => {
    if (!payload.key || !payload.search || !payload.target) {
      socket.emit("update-error", { message: "Ungültiger Payload" });
      return;
    }

    const allowedColumns = [
      "NAME", "VAR_VALUE", "benutzer", "visible", "tag_top", "tag_sub", "TYPE",
      "OPTI_de", "OPTI_fr", "OPTI_en", "OPTI_it", "MIN", "MAX", "unit",
      "NAME_de", "NAME_fr", "NAME_en", "NAME_it"
    ];
    if (!allowedColumns.includes(payload.target) || !allowedColumns.includes(payload.key)) {
      socket.emit("update-error", { message: "Ungültige Spaltenangabe." });
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
      // Neu: Nach Settings-Update auch das Menü neu laden und an alle Clients senden
      fetchMenuForFrontend(sqliteDB)
        .then((menu) => {
          io.emit("menu-update", menu);
        })
        .catch(err => console.error("Fehler beim Aktualisieren des Menüs:", err));

      socket.emit("update-success", { changes: this.changes });
    });
  });

  socket.on('disconnect', () => {
    console.log('Client getrennt:', socket.id);
  });
});

app.use('/db', dbRoutes);

setupMqtt(io, sqliteDB, fetchMenuForFrontend);

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
