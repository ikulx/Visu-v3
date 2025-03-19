// src/App.js
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import io from 'socket.io-client';
import MainLayout from './MainLayout';
import Page from './Page';
import HomePage from './HomePage';
import 'antd/dist/reset.css'; // Für Ant Design v5

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

  return (
    <Router>
      <MainLayout menuItems={menuData.menuItems}>
        <Routes>
          {menuData.menuItems.map((item) => {
            // Wenn der Link "/" ist und "content" definiert ist, verwende HomePage
            if (item.link === "/" && item.content) {
              return (
                <Route
                  key={item.link}
                  path={item.link}
                  element={<HomePage text={item.content} />}
                />
              );
            } else {
              // Andernfalls verwende die Page-Komponente (für SVG-Seiten)
              return (
                <Route
                  key={item.link}
                  path={item.link}
                  element={<Page svg={item.svg} properties={item.properties} />}
                />
              );
            }
          })}
          <Route path="*" element={<div style={{ color: '#fff' }}>Bitte wähle eine Seite aus dem Menü</div>} />
        </Routes>
      </MainLayout>
    </Router>
  );
}

export default App;
