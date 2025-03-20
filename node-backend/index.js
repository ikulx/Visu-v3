const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');


const app = express();
const server = http.createServer(app);

// Socket.IO-Konfiguration mit CORS (passe ggf. die Origin an)
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware zum Parsen von JSON-Bodies
app.use(bodyParser.json());

// Globales Objekt, in dem das aktuelle Menü gespeichert wird
let currentMenu = { menuItems: [] };

// Endpunkt zum vollständigen Aktualisieren des Menüs
app.post('/update-menu', (req, res) => {
  currentMenu = req.body;
  console.log('Neues Menü empfangen:', currentMenu);
  // Sende das aktualisierte Menü an alle verbundenen Clients
  io.emit('menu-update', currentMenu);
  res.sendStatus(200);
});

// Rekursive Funktion, um einen Menüeintrag anhand des Links zu finden und seine Properties zu aktualisieren.
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
  const update = req.body; // Beispiel: { "link": "/kreis2", "properties": { "Status Venti": "2" } }

  if (!currentMenu.menuItems || !Array.isArray(currentMenu.menuItems)) {
    return res.status(500).send("Menu not initialized");
  }

  // Verwende die rekursive Funktion, um den Eintrag zu finden und zu aktualisieren
  const updated = updateMenuItemProperties(currentMenu.menuItems, update.link, update.properties);

  if (!updated) {
    return res.status(404).send("Menu item not found");
  }

  console.log(`Properties für ${update.link} aktualisiert:`, update.properties);

  // Sende das aktualisierte Menü an alle Clients
  io.emit('menu-update', currentMenu);
  res.sendStatus(200);
});

// Bei einer neuen Socket.IO-Verbindung wird der aktuelle Menü-Payload sofort gesendet
io.on('connection', (socket) => {
  console.log('Neuer Client verbunden:', socket.id);
  socket.emit('menu-update', currentMenu);

  socket.on('disconnect', () => {
    console.log('Client getrennt:', socket.id);
  });
});

// Starte den Server auf Port 3001
const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
