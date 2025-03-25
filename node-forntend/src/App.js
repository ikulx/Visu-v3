// src/App.js
import React, { Suspense, useState, useEffect, useMemo } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Spin } from 'antd';
import socket from './socket';
import MainLayout from './Layout/MainLayout';
import 'antd/dist/reset.css';

// Lazy-Load der Seiten
const LazyPage = React.lazy(() => import('./Page'));
const LazySettingsPage = React.lazy(() => import('./SettingsPage')); // neue Settings-Seite

// Hilfsfunktion zum flachen Auslesen der Menüeinträge
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

function App() {
  const [menuData, setMenuData] = useState({ menuItems: [] });

  useEffect(() => {
    socket.on('menu-update', (data) => {
      console.log('Menu update received:', data);
      setMenuData(data);
    });
    return () => {
      socket.off('menu-update');
    };
  }, []);

  const flatMenuItems = flattenMenuItems(menuData.menuItems);

  const allSvgs = useMemo(() => {
    const svgNames = flatMenuItems.map(item => item.svg).filter(Boolean);
    return Array.from(new Set(svgNames));
  }, [flatMenuItems]);

  return (
    <Router>
      <MainLayout menuItems={menuData.menuItems}>
        <Suspense
          fallback={
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100%',
                color: '#fff'
              }}
            >
              <Spin size="large" tip="Lädt..." />
            </div>
          }
        >
          <Routes>
            {flatMenuItems.map(item => (
              <Route
                key={item.link}
                path={item.link}
                element={
                  <LazyPage
                    svg={item.svg}
                    properties={item.properties}
                    allSvgs={allSvgs}
                  />
                }
              />
            ))}
            {/* Neue Route für die Settings-Seite */}
            <Route path="/settings" element={<LazySettingsPage />} />
            <Route
              path="*"
              element={<div style={{ color: '#fff' }}>Bitte wähle eine Seite aus dem Menü</div>}
            />
          </Routes>
        </Suspense>
      </MainLayout>
    </Router>
  );
}

export default App;
