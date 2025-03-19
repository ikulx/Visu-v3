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

// Endpunkt zum Aktualisieren einzelner Properties eines Menüeintrags
app.post('/update-properties', (req, res) => {
  const update = req.body; // Beispiel: { "link": "/kreis", "properties": { "Status Venti": "2" } }

  if (!currentMenu.menuItems || !Array.isArray(currentMenu.menuItems)) {
    return res.status(500).send("Menu not initialized");
  }

  // Finde den Menüeintrag anhand des Links
  const index = currentMenu.menuItems.findIndex(item => item.link === update.link);
  if (index === -1) {
    return res.status(404).send("Menu item not found");
  }

  // Aktualisiere nur die Properties des gefundenen Eintrags
  currentMenu.menuItems[index].properties = {
    ...currentMenu.menuItems[index].properties,
    ...update.properties
  };

  console.log(`Properties für ${update.link} aktualisiert:`, currentMenu.menuItems[index].properties);

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
