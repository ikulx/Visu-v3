const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
const db = require('./db');
const dbRoutes = require('./dbRoutes');
const { router: menuRoutes, loadMenuWithProperties, updateMenu } = require('./menuRoutes');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use(bodyParser.json());

let currentFooter = { temperature: '–' };

async function sendNodeRedUpdate(name, var_value) {
  try {
    const { default: fetch } = await import('node-fetch');
    const payload = { [name]: var_value };
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

function broadcastSettings(socket = null, user = null) {
  const sql = `SELECT NAME, NAME_de, NAME_fr, NAME_en, NAME_it, VAR_VALUE, benutzer, visible, tag_top, tag_sub, TYPE, OPTI_de, OPTI_fr, OPTI_en, OPTI_it, MIN, MAX, unit FROM QHMI_VARIABLES`;
  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('Fehler beim Abrufen der Settings:', err);
      return;
    }
    if (user) {
      rows = rows.filter(row => row.benutzer?.split(',').map(u => u.trim().toLowerCase()).includes(user.toLowerCase()));
    }
    const eventData = { type: 'settings', data: rows };
    if (socket) {
      socket.emit('data-update', eventData);
    } else {
      io.emit('data-update', eventData);
    }
  });
}

io.on('connection', (socket) => {
  socket.emit('data-update', { type: 'footer', data: currentFooter });
  broadcastSettings(socket);

  socket.on('request-data', async (type) => {
    if (type === 'menu') {
      const menuData = await loadMenuWithProperties();
      socket.emit('data-update', { type: 'menu', data: menuData });
    } else if (type === 'qhmi-variables') {
      db.all('SELECT id, NAME FROM QHMI_VARIABLES', [], (err, rows) => {
        if (err) {
          socket.emit('data-update', { type: 'qhmi-variables-error', data: { message: 'Fehler beim Laden der Variablen' } });
        } else {
          socket.emit('data-update', { type: 'qhmi-variables', data: rows });
        }
      });
    }
  });

  socket.on('set-user', (data) => {
    socket.loggedInUser = data.user;
    console.log(`Socket ${socket.id} registriert Benutzer: ${data.user}`);
    broadcastSettings(socket, data.user);
  });

  socket.on('request-settings', (data) => {
    const user = data?.user || null;
    socket.loggedInUser = user;
    console.log(`Socket ${socket.id} fordert Settings für Benutzer: ${user}`);
    broadcastSettings(socket, user);
  });

  socket.on('update-variable', async (payload) => {
    if (!payload.key || !payload.search || !payload.target) {
      socket.emit('data-update', { type: 'update-error', data: { message: 'Ungültiger Payload' } });
      return;
    }

    const allowedColumns = [
      'NAME', 'VAR_VALUE', 'benutzer', 'visible', 'tag_top', 'tag_sub', 'TYPE',
      'OPTI_de', 'OPTI_fr', 'OPTI_en', 'OPTI_it', 'MIN', 'MAX', 'unit',
      'NAME_de', 'NAME_fr', 'NAME_en', 'NAME_it',
    ];
    if (!allowedColumns.includes(payload.target) || !allowedColumns.includes(payload.key)) {
      socket.emit('data-update', { type: 'update-error', data: { message: 'Ungültige Spaltenangabe.' } });
      return;
    }

    const sql = `UPDATE QHMI_VARIABLES SET ${payload.target} = ? WHERE ${payload.key} = ?`;
    db.run(sql, [payload.value, payload.search], async function (err) {
      if (err) {
        console.error('Fehler beim Aktualisieren der Datenbank:', err);
        socket.emit('data-update', { type: 'update-error', data: { message: 'Fehler beim Aktualisieren der Datenbank.' } });
        return;
      }

      if (payload.target === 'VAR_VALUE') {
        sendNodeRedUpdate(payload.search, payload.value);
      }

      sendFullDbUpdate();
      broadcastSettings();

      const isMenuRelevant = await new Promise((resolve) => {
        db.get(
          `SELECT COUNT(*) as count 
           FROM menu_items mi 
           LEFT JOIN menu_properties mp ON mi.id = mp.menu_id 
           WHERE mi.qhmi_variable_id = (SELECT id FROM QHMI_VARIABLES WHERE ${payload.key} = ?) 
              OR mp.qhmi_variable_id = (SELECT id FROM QHMI_VARIABLES WHERE ${payload.key} = ?)`,
          [payload.search, payload.search],
          (err, row) => resolve(err ? false : row.count > 0)
        );
      });

      if (isMenuRelevant) {
        const updatedMenu = await loadMenuWithProperties();
        io.emit('data-update', { type: 'menu', data: updatedMenu });
      }

      socket.emit('data-update', { type: 'update-success', data: { changes: this.changes } });
    });
  });

  socket.on('update-menu', async (newMenu) => {
    try {
      await updateMenu(newMenu);
      const updatedMenu = await loadMenuWithProperties();
      socket.emit('data-update', { type: 'menu-update-success', data: updatedMenu });
    } catch (err) {
      console.error('Fehler beim Menü-Update:', err.message);
      socket.emit('data-update', { type: 'menu-update-error', data: { message: 'Fehler beim Aktualisieren des Menüs' } });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client getrennt:', socket.id);
  });
});

app.post('/setFooter', (req, res) => {
  const footerUpdate = req.body;
  currentFooter = { ...currentFooter, ...footerUpdate };
  io.emit('data-update', { type: 'footer', data: currentFooter });
  res.sendStatus(200);
});

app.use('/db', dbRoutes);
app.use('/menu', menuRoutes);

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});