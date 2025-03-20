// src/App.js
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import io from 'socket.io-client';
import MainLayout from './MainLayout';
import Page from './Page';
import 'antd/dist/reset.css';

// Hilfsfunktion: Rekursives "Flatten" der Menüstruktur
const flattenMenuItems = (items) => {
  let flat = [];
  items.forEach(item => {
    // Wenn ein Item einen Link hat, fügen wir es hinzu
    if (item.link) {
      flat.push(item);
    }
    // Falls es Untermenüpunkte gibt, verarbeiten wir diese ebenfalls
    if (item.sub && Array.isArray(item.sub)) {
      flat = flat.concat(flattenMenuItems(item.sub));
    }
  });
  return flat;
};

const host = window.location.hostname;
const port = 3001;
const socket = io(`http://${host}:${port}`);

function App() {
  const [menuData, setMenuData] = useState({ menuItems: [] });

  useEffect(() => {
    socket.on('menu-update', (data) => {
      console.log('Empfangenes Menü:', data);
      setMenuData(data);
    });
    return () => {
      socket.off('menu-update');
    };
  }, []);

  // Erzeuge eine flache Liste aller Items, damit auch Untermenüpunkte als eigene Routen verarbeitet werden.
  const flatMenuItems = flattenMenuItems(menuData.menuItems);

  return (
    <Router>
      <MainLayout menuItems={menuData.menuItems}>
        <Routes>
          {flatMenuItems.map(item => (
            <Route
              key={item.link}
              path={item.link}
              element={<Page svg={item.svg} properties={item.properties} />}
            />
          ))}
          <Route path="*" element={<div style={{ color: '#fff' }}>Bitte wähle eine Seite aus dem Menü</div>} />
        </Routes>
      </MainLayout>
    </Router>
  );
}

export default App;
