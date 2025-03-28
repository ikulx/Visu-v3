// server.js (vollständige Datei mit Anpassung)
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const dbRoutes = require('./dbRoutes');
const { setupMqtt } = require('./mqttHandler');

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
const dbPath = path.join(__dirname, 'external', 'ycontroldata_settings.db');
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
  }
});

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

async function resolvePropertyValue(property) {
  if (property.source_type === 'static') {
    return property.value;
  } else if (property.source_type === 'dynamic') {
    return new Promise((resolve) => {
      sqliteDB.get(
        `SELECT VAR_VALUE FROM QHMI_VARIABLES WHERE NAME = ?`,
        [property.source_key],
        (err, row) => {
          resolve(err || !row ? null : row.VAR_VALUE);
        }
      );
    });
  } else if (property.source_type === 'mqtt') {
    return null; // Für mqtt wird der Wert später dynamisch eingefügt
  }
  return null;
}

async function fetchMenuFromDB() {
  return new Promise((resolve, reject) => {
    sqliteDB.all(`
      SELECT mi.*, mp.id AS prop_id, mp.key, mp.value, mp.source_type, mp.source_key
      FROM menu_items mi
      LEFT JOIN menu_properties mp ON mi.id = mp.menu_item_id
      ORDER BY mi.sort_order ASC
    `, [], async (err, rows) => {
      if (err) {
        console.error("Fehler beim Abrufen des Menüs:", err);
        return reject(err);
      }

      const menuItems = [];
      const itemMap = new Map();

      rows.forEach(row => {
        if (!itemMap.has(row.id)) {
          itemMap.set(row.id, {
            link: row.link,
            label: row.label,
            svg: row.svg,
            enable: row.enable === 1,
            properties: {},
            sub: row.parent_id ? undefined : []
          });
        }
        const item = itemMap.get(row.id);
        if (row.key) {
          item.properties[row.key] = {
            value: row.value,
            source_type: row.source_type,
            source_key: row.source_key
          };
        }
      });

      itemMap.forEach((item, id) => {
        const row = rows.find(r => r.id === id);
        if (row.parent_id && itemMap.has(row.parent_id)) {
          itemMap.get(row.parent_id).sub.push(item);
        } else if (!row.parent_id) {
          menuItems.push(item);
        }
      });

      for (const item of itemMap.values()) {
        for (const key of Object.keys(item.properties)) {
          const property = item.properties[key];
          if (property.source_type !== 'mqtt') { // mqtt wird später aktualisiert
            item.properties[key] = await resolvePropertyValue(property);
          } else {
            item.properties[key] = null; // Initial NULL für mqtt
          }
        }
        if (item.sub) {
          for (const subItem of item.sub) {
            for (const key of Object.keys(subItem.properties)) {
              const property = subItem.properties[key];
              if (property.source_type !== 'mqtt') {
                subItem.properties[key] = await resolvePropertyValue(property);
              } else {
                subItem.properties[key] = null;
              }
            }
          }
        }
      }

      resolve({ menuItems });
    });
  });
}

let currentMenu;
(async () => {
  try {
    currentMenu = await fetchMenuFromDB();
    console.log('Menü aus Datenbank geladen.');
  } catch (err) {
    console.warn('Fehler beim Laden des Menüs – verwende Default-Menü.');
    currentMenu = defaultMenu;
  }
})();

let currentFooter = { temperature: '–' };

app.post('/update-menu', async (req, res) => {
  const newMenu = req.body;
  try {
    await new Promise((resolve, reject) => {
      sqliteDB.run(`DELETE FROM menu_properties`, [], (err) => {
        if (err) reject(err);
        sqliteDB.run(`DELETE FROM menu_items`, [], (err) => (err ? reject(err) : resolve()));
      });
    });

    await insertMenuItems(newMenu.menuItems, null, 0);
    currentMenu = await fetchMenuFromDB();
    io.emit('menu-update', currentMenu);
    res.sendStatus(200);
  } catch (err) {
    console.error('Fehler beim Aktualisieren des Menüs:', err);
    res.status(500).send('Fehler beim Aktualisieren des Menüs');
  }
});

async function insertMenuItems(items, parentId, sortOrderStart) {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const sortOrder = sortOrderStart + i;

    const itemId = await new Promise((resolve, reject) => {
      sqliteDB.run(
        `INSERT INTO menu_items (label, link, svg, enable, parent_id, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
        [item.label, item.link, item.svg, item.enable ? 1 : 0, parentId, sortOrder],
        function (err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });

    if (item.properties) {
      for (const [key, propData] of Object.entries(item.properties)) {
        const { value, source_type, source_key } = typeof propData === 'object' && propData !== null
          ? propData
          : { value: propData, source_type: 'static', source_key: null };

        // Für mqtt immer NULL, für static den Wert, für dynamic auch NULL
        const insertValue = source_type === 'static' ? value : null;

        await sqliteDB.run(
          `INSERT INTO menu_properties (menu_item_id, key, value, source_type, source_key) VALUES (?, ?, ?, ?, ?)`,
          [itemId, key, insertValue, source_type || 'static', source_key || null]
        );
      }
    }

    if (item.sub && Array.isArray(item.sub)) {
      await insertMenuItems(item.sub, itemId, 0);
    }
  }
}

app.post('/update-properties', async (req, res) => {
  const { link, properties } = req.body;
  try {
    const menuItem = await new Promise((resolve, reject) => {
      sqliteDB.get(`SELECT id FROM menu_items WHERE link = ?`, [link], (err, row) => {
        if (err) reject(err);
        else if (!row) reject(new Error('Menu item not found'));
        else resolve(row);
      });
    });

    for (const [key, value] of Object.entries(properties)) {
      await sqliteDB.run(
        `UPDATE menu_properties SET value = ?, updated_at = strftime('%Y-%m-%dT%H:%M','now', 'localtime')
         WHERE menu_item_id = ? AND key = ?`,
        [value, menuItem.id, key]
      );
    }

    currentMenu = await fetchMenuFromDB();
    io.emit('menu-update', currentMenu);
    res.sendStatus(200);
  } catch (err) {
    console.error('Fehler beim Aktualisieren der Properties:', err);
    res.status(404).send('Menu item or property not found');
  }
});

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
      socket.emit("update-success", { changes: this.changes });
    });
  });

  socket.on('update-menu-config', async (newMenu) => {
    try {
      await new Promise((resolve, reject) => {
        sqliteDB.run(`DELETE FROM menu_properties`, [], (err) => {
          if (err) reject(err);
          sqliteDB.run(`DELETE FROM menu_items`, [], (err) => (err ? reject(err) : resolve()));
        });
      });

      await insertMenuItems(newMenu.menuItems, null, 0);
      currentMenu = await fetchMenuFromDB();

      console.log('Updated menu before sending:', JSON.stringify(currentMenu, null, 2));
      socket.emit('menu-config-success', { message: 'Menü erfolgreich aktualisiert', menu: currentMenu });
      socket.broadcast.emit('menu-update', currentMenu);
    } catch (err) {
      console.error('Fehler beim Aktualisieren des Menüs:', err);
      socket.emit('menu-config-error', { message: 'Fehler beim Speichern des Menüs' });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client getrennt:', socket.id);
  });
});

app.use('/db', dbRoutes);

setupMqtt(io, sqliteDB, fetchMenuFromDB);

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});