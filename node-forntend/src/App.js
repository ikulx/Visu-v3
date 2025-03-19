// src/App.js
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import io from 'socket.io-client';
import Page from './Page';

const host = window.location.hostname;
const port = 3001; // Port, auf dem dein Node.js-Backend läuft
const socket = io(`http://${host}:${port}`);

function Menu({ menuItems }) {
  return (
    <nav>
      <ul>
        {menuItems.map((item, index) => (
          <li key={index}>
            <Link to={item.link}>{item.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

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
      <div className="App">
        <h1>Meine React App</h1>
        <Menu menuItems={menuData.menuItems} />
        <Routes>
          {menuData.menuItems.map((item) => (
            <Route
              key={item.link}
              path={item.link}
              element={<Page svg={item.svg} properties={item.properties} />}
            />
          ))}
          <Route path="*" element={<div>Bitte wähle eine Seite aus dem Menü</div>} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
