const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

// Importiere die SQLite-Routen
const dbRoutes = require('./dbRoutes');

const app = express();
const server = http.createServer(app);

// Socket.IO-Konfiguration mit CORS
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware zum Parsen von JSON-Bodies
app.use(bodyParser.json());

// Menü-Dateipfad und Default-Menü
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
    // weitere Standard-Menüeinträge können hier ergänzt werden
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

// Globales Objekt für den Footer
let currentFooter = { temperature: '–' };

// Endpunkt zum vollständigen Aktualisieren des Menüs
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

// Rekursive Funktion zum Aktualisieren einzelner Menüeinträge
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

// Endpunkt zum Aktualisieren einzelner Properties eines Menüeintrags
app.post('/update-properties', (req, res) => {
  const update = req.body; // z. B. { "link": "/kreis2", "properties": { "Status Venti": "2" } }

  if (!currentMenu.menuItems || !Array.isArray(currentMenu.menuItems)) {
    return res.status(500).send("Menu not initialized");
  }

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
  const footerUpdate = req.body; // z. B. { "temperature": "22°C" }
  currentFooter = {
    ...currentFooter,
    ...footerUpdate
  };
  io.emit('footer-update', currentFooter);
  res.sendStatus(200);
});

// Bei einer neuen Socket.IO-Verbindung werden aktuelle Menü- und Footer-Daten gesendet
io.on('connection', (socket) => {
  console.log('Neuer Client verbunden:', socket.id);
  socket.emit('menu-update', currentMenu);
  socket.emit('footer-update', currentFooter);

  socket.on('disconnect', () => {
    console.log('Client getrennt:', socket.id);
  });
});

// Verwende die SQLite-Endpunkte aus der separaten Datei
app.use('/db', dbRoutes);

// Starte den Server auf Port 3001
const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
