// src/server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
const db = require('./db');
const dbRoutes = require('./dbRoutes');

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

// Funktion zum Laden des Menüs aus der Datenbank
async function loadMenuFromDb() {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT id, link, label, svg, parent_id
      FROM menu_items
    `, [], (err, rows) => {
      if (err) {
        console.error('Fehler beim Laden des Menüs aus der Datenbank:', err.message);
        return reject(err);
      }

      const buildMenuTree = (items, parentId = null) => {
        return items
          .filter(item => item.parent_id === parentId)
          .map(item => ({
            id: item.id,
            link: item.link,
            label: item.label,
            svg: item.svg,
            properties: currentMenu.menuItems.find(m => m.link === item.link)?.properties || {}, // Properties aus Speicher übernehmen
            sub: buildMenuTree(items, item.id),
          }));
      };

      const menuItems = buildMenuTree(rows);
      resolve({ menuItems });
    });
  });
}

// Initiales Laden des Menüs
let currentMenu = { menuItems: [] };
let currentFooter = { temperature: '–' };

(async () => {
  try {
    currentMenu = await loadMenuFromDb();
    console.log('Menü aus der Datenbank geladen.');
  } catch (err) {
    console.warn('Fehler beim initialen Laden des Menüs, verwende leeres Menü.');
    currentMenu = { menuItems: [] };
  }
})();

// Endpunkt zum Aktualisieren des gesamten Menüs
app.post('/update-menu', async (req, res) => {
  const newMenu = req.body;

  if (!newMenu.menuItems || !Array.isArray(newMenu.menuItems)) {
    return res.status(400).send('Ungültiges Menüformat: menuItems muss ein Array sein');
  }

  // Validierung: Sicherstellen, dass jedes Element ein label hat
  const validateMenuItems = (items) => {
    for (const item of items) {
      if (!item.label || typeof item.label !== 'string') {
        item.label = 'Unnamed'; // Standardwert setzen
      }
      if (item.sub && Array.isArray(item.sub)) {
        validateMenuItems(item.sub);
      }
    }
  };
  validateMenuItems(newMenu.menuItems);

  try {
    // Lösche vorhandene Menüeinträge
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM menu_items', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Rekursive Funktion zum Einfügen von Menüeinträgen (ohne properties)
    const insertMenuItems = async (items, parentId = null) => {
      for (const item of items) {
        const id = await new Promise((resolve, reject) => {
          db.run(`
            INSERT INTO menu_items (link, label, svg, parent_id)
            VALUES (?, ?, ?, ?)
          `, [item.link, item.label, item.svg, parentId], function (err) {
            if (err) reject(err);
            else resolve(this.lastID);
          });
        });
        if (item.sub && Array.isArray(item.sub)) {
          await insertMenuItems(item.sub, id);
        }
      }
    };

    await insertMenuItems(newMenu.menuItems);

    // Properties aus dem Request in currentMenu übernehmen
    const updatePropertiesInMemory = (sourceItems, targetItems) => {
      for (const source of sourceItems) {
        const target = targetItems.find(t => t.link === source.link);
        if (target) {
          target.properties = source.properties || {};
        }
        if (source.sub && target.sub) {
          updatePropertiesInMemory(source.sub, target.sub);
        }
      }
    };
    currentMenu = await loadMenuFromDb();
    updatePropertiesInMemory(newMenu.menuItems, currentMenu.menuItems);

    io.emit('menu-update', currentMenu);
    res.sendStatus(200);
  } catch (err) {
    console.error('Fehler beim Aktualisieren des Menüs:', err.message);
    res.status(500).send(`Fehler beim Aktualisieren des Menüs: ${err.message}`);
  }
});

// Endpunkt zum Aktualisieren einzelner Menü-Properties (nur im Speicher)
app.post('/update-properties', async (req, res) => {
  const { link, properties } = req.body;

  if (!link || !properties) {
    return res.status(400).send('Link und Properties erforderlich');
  }

  // Properties im Speicher aktualisieren
  const updateItemProperties = (items) => {
    for (const item of items) {
      if (item.link === link) {
        item.properties = properties;
        return true;
      }
      if (item.sub && Array.isArray(item.sub)) {
        if (updateItemProperties(item.sub)) return true;
      }
    }
    return false;
  };

  const updated = updateItemProperties(currentMenu.menuItems);
  if (!updated) {
    return res.status(404).send('Menüeintrag nicht gefunden');
  }

  io.emit('menu-update', currentMenu);
  res.sendStatus(200);
});

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
  console.log('Neuer Client verbunden:', socket.id);
  socket.emit('menu-update', currentMenu);
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
    db.run(sql, [payload.value, payload.search], function (err) {
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
      socket.emit('update-success', { changes: this.changes });
    });
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