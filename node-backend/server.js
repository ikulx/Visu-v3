const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Importiere die SQLite-Routen (falls noch benötigt)
const dbRoutes = require('./dbRoutes');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
global.io = io; // Damit auch andere Module (z.B. dbRoutes) auf Socket.IO zugreifen können

app.use(bodyParser.json());

// Laden des Menüs
const menuFilePath = path.join(__dirname, 'menu.json');
const defaultMenu = {
  menuItems: [
    {
      link: '/',
      label: 'Home',
      svg: 'home',
      properties: {
        "Anlagenamen": "Init",
        "Projektnummer": "x",
        "Schemanummer": "y"
      }
    }
  ]
};

let currentMenu;
try {
  const menuData = fs.readFileSync(menuFilePath, 'utf8');
  currentMenu = JSON.parse(menuData);
  console.log('Persistiertes Menü geladen.');
} catch (err) {
  console.warn('Kein persistiertes Menü gefunden – verwende Default-Menü.');
  currentMenu = defaultMenu;
}

let currentFooter = { temperature: '–' };

// Endpunkt zum Aktualisieren des Menüs
app.post('/update-menu', (req, res) => {
  currentMenu = req.body;
  try {
    fs.writeFileSync(menuFilePath, JSON.stringify(currentMenu), 'utf8');
  } catch (err) {
    console.error('Fehler beim Speichern des Menüs:', err);
  }
  io.emit('menu-update', currentMenu);
  res.sendStatus(200);
});

// Endpunkt zum Aktualisieren einzelner Menü-Properties
app.post('/update-properties', (req, res) => {
  const update = req.body; // z.B. { "link": "/kreis2", "properties": { "Status Venti": "2" } }
  if (!currentMenu.menuItems || !Array.isArray(currentMenu.menuItems)) {
    return res.status(500).send("Menu not initialized");
  }
  const updateMenuItemProperties = (items, link, newProperties) => {
    for (let item of items) {
      if (item.link === link) {
        item.properties = {
          ...item.properties,
          ...newProperties
        };
        return true;
      }
      if (item.sub && Array.isArray(item.sub)) {
        if (updateMenuItemProperties(item.sub, link, newProperties)) {
          return true;
        }
      }
    }
    return false;
  };

  const updated = updateMenuItemProperties(currentMenu.menuItems, update.link, update.properties);
  if (!updated) {
    return res.status(404).send("Menu item not found");
  }
  try {
    fs.writeFileSync(menuFilePath, JSON.stringify(currentMenu), 'utf8');
  } catch (err) {
    console.error('Fehler beim Speichern des aktualisierten Menüs:', err);
  }
  io.emit('menu-update', currentMenu);
  res.sendStatus(200);
});

// Endpunkt zum Setzen der Footer-Daten
app.post('/setFooter', (req, res) => {
  const footerUpdate = req.body; // z.B. { "temperature": "22°C" }
  currentFooter = {
    ...currentFooter,
    ...footerUpdate
  };
  io.emit('footer-update', currentFooter);
  res.sendStatus(200);
});

// Erstelle die SQLite-Datenbank-Verbindung (hier im globalen Scope)
const dbPath = path.join(__dirname, 'external', 'ycontroldata_settings.db');
const sqliteDB = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Fehler beim Verbinden mit der SQLite-Datenbank:', err);
  } else {
    console.log('Verbindung zur SQLite-Datenbank hergestellt.');
  }
});

// Funktion zum Senden eines Node-RED-Updates
async function sendNodeRedUpdate(name, var_value) {
  try {
    const { default: fetch } = await import('node-fetch');
    const payload = {};
    payload[name] = var_value;
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
function broadcastSettings(socket = null, user = null) {
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
    if (user) {
      rows = rows.filter(row => {
        if (!row.benutzer) return false;
        const allowedUsers = row.benutzer.split(',').map(u => u.trim().toLowerCase());
        return allowedUsers.includes(user.toLowerCase());
      });
    }
    if (socket) {
      socket.emit("settings-update", rows);
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

// Socket.IO-Verbindungen
io.on('connection', (socket) => {
  console.log('Neuer Client verbunden:', socket.id);
  socket.emit('menu-update', currentMenu);
  socket.emit('footer-update', currentFooter);
  broadcastSettings(socket);

  // Benutzer setzen
  socket.on('set-user', (data) => {
    socket.loggedInUser = data.user;
    console.log(`Socket ${socket.id} registriert Benutzer: ${data.user}`);
    broadcastSettings(socket, data.user);
  });

  // Settings anfordern
  socket.on('request-settings', (data) => {
    const user = data && data.user ? data.user : null;
    socket.loggedInUser = user;
    console.log(`Socket ${socket.id} fordert Settings für Benutzer: ${user}`);
    broadcastSettings(socket, user);
  });

  // Update-Variable via Socket (statt HTTP)
  socket.on('update-variable', (payload) => {
    if (!payload.key || !payload.search || !payload.target) {
      socket.emit("update-error", { message: "Ungültiger Payload" });
      return;
    }

    // Whitelist check for allowed columns
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
      socket.emit("update-success", { changes: this.changes });
    });
  });

  socket.on('disconnect', () => {
    console.log('Client getrennt:', socket.id);
  });
});

// Verwende die SQLite-Endpunkte aus dbRoutes.js (falls benötigt)
app.use('/db', dbRoutes);

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});