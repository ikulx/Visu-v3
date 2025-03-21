// src/App.js
import React, { Suspense, useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import io from 'socket.io-client';
import MainLayout from './MainLayout';
import 'antd/dist/reset.css';

const LazyPage = React.lazy(() => import('./Page'));

// Rekursive Funktion, um die Menüstruktur zu „flatten“
const flattenMenuItems = (items) => {
  let flat = [];
  items.forEach(item => {
    if (item.link) {
      flat.push(item);
    }
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

  const flatMenuItems = flattenMenuItems(menuData.menuItems);

  return (
    <Router>
      <MainLayout menuItems={menuData.menuItems}>
        <Suspense fallback={<div style={{ color: '#fff' }}>Lädt...</div>}>
          <Routes>
            {flatMenuItems.map(item => (
              <Route
                key={item.link}
                path={item.link}
                element={<LazyPage svg={item.svg} properties={item.properties} />}
              />
            ))}
            <Route path="*" element={<div style={{ color: '#fff' }}>Bitte wähle eine Seite aus dem Menü</div>} />
          </Routes>
        </Suspense>
      </MainLayout>
    </Router>
  );
}

export default App;
