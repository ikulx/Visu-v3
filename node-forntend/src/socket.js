// src/socket.js
import { io } from 'socket.io-client';

const SOCKET_SERVER_URL = `http://${window.location.hostname}:3001`;

// Erstelle und exportiere die Socket-Instanz
const socket = io(SOCKET_SERVER_URL, {
  // Hier kannst du weitere Optionen setzen, z. B. Reconnection-Optionen
  transports: ['websocket'], // z. B. zur Optimierung
});

export default socket;
