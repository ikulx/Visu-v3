import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import io from 'socket.io-client';
import MainLayout from './MainLayout';
import Page from './Page';
import HomePage from './HomePage';
import 'antd/dist/reset.css'; // Ant Design CSS-Import

// Verbindung zum Backend auf Port 3001
const host = window.location.hostname;
const port = 3001;
const socket = io(`http://${host}:${port}`);

function App() {
  // Zustand für die Menüdaten
  const [menuData, setMenuData] = useState({ menuItems: [] });

  // Socket.IO-Listener für Menü-Updates
  useEffect(() => {
    socket.on('menu-update', (data) => {
      console.log('Empfangenes Menü:', data);
      setMenuData(data);
    });
    // Cleanup: Listener entfernen, wenn die Komponente unmountet
    return () => {
      socket.off('menu-update');
    };
  }, []);

  // Daten für die Homepage extrahieren (Menüeintrag mit link "/")
  const homeData = menuData.menuItems.find(item => item.link === '/') || {};

  return (
    <Router>
      <MainLayout menuItems={menuData.menuItems}>
        <Routes>
          {/* Homepage-Route */}
          <Route
            path="/"
            element={<HomePage text={homeData.text} />}
          />
          {/* Dynamische Routen für Menüeinträge */}
          {menuData.menuItems.map((item) => (
            <Route
              key={item.link}
              path={item.link}
              element={<Page svg={item.svg} properties={item.properties} />}
            />
          ))}
          {/* Fallback-Route für ungültige Pfade */}
          <Route path="*" element={<div style={{ color: '#fff' }}>Bitte wähle eine Seite aus dem Menü</div>} />
        </Routes>
      </MainLayout>
    </Router>
  );
}

export default App;