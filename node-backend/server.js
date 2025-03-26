// src/server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
const db = require('./db');
const dbRoutes = require('./dbRoutes');
const { router: menuRoutes, initializeMenuSocket, getCurrentMenu, loadMenuFromDb } = require('./menuRoutes'); // Import korrigiert

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});
global.io = io;

app.use(bodyParser.json());

// Initiales Footer-Objekt
let currentFooter = { temperature: '–' };

// Funktion zum Senden eines Node-RED-Updates
async function sendNodeRedUpdate(name, var_value) {
  try {
    const { default: fetch } = await import('node-fetch');
    const payload = {};
    payload[name] = var_value;
    const response = await fetch('http://192.168.10.31:1880/db/Changes', {
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

// Funktion zum Senden der kompletten DB an Node-RED
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
  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('Fehler beim Abrufen der Settings:', err);
      return;
    }
    if (user) {
      rows = rows.filter((row) => {
        if (!row.benutzer) return false;
        const allowedUsers = row.benutzer.split(',').map((u) => u.trim().toLowerCase());
        return allowedUsers.includes(user.toLowerCase());
      });
    }
    if (socket) {
      socket.emit('settings-update', rows);
    } else {
      for (const [id, s] of io.sockets.sockets) {
        const usr = s.loggedInUser;
        let filtered = rows;
        if (usr) {
          filtered = rows.filter((row) => {
            if (!row.benutzer) return false;
            const allowedUsers = row.benutzer.split(',').map((u) => u.trim().toLowerCase());
            return allowedUsers.includes(usr.toLowerCase());
          });
        }
        s.emit('settings-update', filtered);
      }
    }
  });
}

// Socket.IO-Verbindungen
io.on('connection', (socket) => {
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

  socket.on('update-variable', async (payload) => {
    if (!payload.key || !payload.search || !payload.target) {
      socket.emit('update-error', { message: 'Ungültiger Payload' });
      return;
    }

    const allowedColumns = [
      'NAME', 'VAR_VALUE', 'benutzer', 'visible', 'tag_top', 'tag_sub', 'TYPE',
      'OPTI_de', 'OPTI_fr', 'OPTI_en', 'OPTI_it', 'MIN', 'MAX', 'unit',
      'NAME_de', 'NAME_fr', 'NAME_en', 'NAME_it',
    ];
    if (!allowedColumns.includes(payload.target) || !allowedColumns.includes(payload.key)) {
      socket.emit('update-error', { message: 'Ungültige Spaltenangabe.' });
      return;
    }

    const sql = `UPDATE QHMI_VARIABLES SET ${payload.target} = ? WHERE ${payload.key} = ?`;
    db.run(sql, [payload.value, payload.search], async function (err) {
      if (err) {
        console.error('Fehler beim Aktualisieren der Datenbank:', err);
        socket.emit('update-error', { message: 'Fehler beim Aktualisieren der Datenbank.' });
        return;
      }

      if (payload.target === 'VAR_VALUE') {
        sendNodeRedUpdate(payload.search, payload.value);
      }

      sendFullDbUpdate();
      broadcastSettings();

      // Menü aktualisieren
      const updatedMenu = await loadMenuFromDb(); // Jetzt korrekt verfügbar
      io.emit('menu-update', updatedMenu);

      socket.emit('update-success', { changes: this.changes });
    });
  });

  socket.on('disconnect', () => {
    console.log('Client getrennt:', socket.id);
  });
});

// Menü-Socket-Initialisierung
initializeMenuSocket(io);

// Endpunkt zum Setzen der Footer-Daten
app.post('/setFooter', (req, res) => {
  const footerUpdate = req.body;
  currentFooter = {
    ...currentFooter,
    ...footerUpdate,
  };
  io.emit('footer-update', currentFooter);
  res.sendStatus(200);
});

// Verwende die SQLite-Endpunkte aus dbRoutes.js
app.use('/db', dbRoutes);

// Verwende die Menü-Endpunkte aus menuRoutes.js
app.use('/menu', menuRoutes);

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});