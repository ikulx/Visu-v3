// src/server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Importiere die SQLite-Routen
const dbRoutes = require('./dbRoutes');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
global.io = io; // Damit auch dbRoutes auf die Socket.IO-Instanz zugreifen können

app.use(bodyParser.json());

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
  const update = req.body; // { "link": "/kreis2", "properties": { "Status Venti": "2" } }
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
  const footerUpdate = req.body; // z. B. { "temperature": "22°C" }
  currentFooter = {
    ...currentFooter,
    ...footerUpdate
  };
  io.emit('footer-update', currentFooter);
  res.sendStatus(200);
});

/**
 * Funktion zum Abrufen und Senden der Settings-Daten aus der SQLite-Datenbank.
 * Es werden nun auch die Spalten visible, tag_top und tag_sub abgefragt.
 * Falls ein Socket und ein Benutzer (user) angegeben werden, werden die Daten anhand der Spalte "benutzer" gefiltert.
 * Es wird angenommen, dass in "benutzer" mehrere Benutzernamen als durch Komma getrennte Zeichenfolge stehen.
 */
function broadcastSettings(socket = null, user = null) {
  const dbPath = path.join(__dirname, 'external', 'ycontroldata_settings.db');
  const sqliteDB = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('Fehler beim Verbinden mit der SQLite-Datenbank:', err);
      return;
    }
  });
  const sql = `SELECT NAME, NAME_de, NAME_fr, NAME_en, NAME_it, VAR_VALUE, benutzer, visible, tag_top, tag_sub 
               FROM QHMI_VARIABLES`;
  sqliteDB.all(sql, [], (err, rows) => {
    if (err) {
      console.error("Fehler beim Abrufen der Settings:", err);
      return;
    }
    // Filtere anhand des Benutzers, falls vorhanden.
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
    sqliteDB.close();
  });
}

// Socket.IO-Verbindungen
io.on('connection', (socket) => {
  console.log('Neuer Client verbunden:', socket.id);
  socket.emit('menu-update', currentMenu);
  socket.emit('footer-update', currentFooter);
  // Sende initial Settings-Daten; wenn kein Benutzer gesetzt ist, werden alle Daten gesendet.
  broadcastSettings(socket);
  
  // Ermögliche es dem Client, seinen eingeloggten Benutzer zu registrieren
  socket.on('set-user', (data) => {
    socket.loggedInUser = data.user;
    console.log(`Socket ${socket.id} registriert Benutzer: ${data.user}`);
    broadcastSettings(socket, data.user);
  });
  
  // Auf Anforderung: Settings anfordern – prüfe, ob Daten mitgegeben wurden
  socket.on('request-settings', (data) => {
    const user = data && data.user ? data.user : null;
    socket.loggedInUser = user;
    console.log(`Socket ${socket.id} fordert Settings für Benutzer: ${user}`);
    broadcastSettings(socket, user);
  });
  
  socket.on('disconnect', () => {
    console.log('Client getrennt:', socket.id);
  });
});

// Verwende die SQLite-Endpunkte aus dbRoutes.js
app.use('/db', dbRoutes);

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
