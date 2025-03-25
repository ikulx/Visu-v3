const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

// Importiere den Router und die Funktion zur Registrierung der Socket-Handler
const { router: dbRoutes, registerSocketHandlers } = require('./dbRoutes');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
global.io = io; // Global verfügbar machen

app.use(bodyParser.json());

// Den dbRoutes-Router unter /db einbinden
app.use('/db', dbRoutes);

// Registriere die Socket-Handler aus dbRoutes
registerSocketHandlers(io);

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

app.post('/update-properties', (req, res) => {
  const update = req.body; // z. B. { "link": "/kreis2", "properties": { "Status Venti": "2" } }
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

app.post('/setFooter', (req, res) => {
  const footerUpdate = req.body; // z. B. { "temperature": "22°C" }
  currentFooter = {
    ...currentFooter,
    ...footerUpdate
  };
  io.emit('footer-update', currentFooter);
  res.sendStatus(200);
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
