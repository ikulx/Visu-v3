// src/index.js
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import { UserProvider } from './UserContext';
import App from './App';
import 'antd/dist/reset.css';
import './index.css';
import './i18n';

const darkTheme = {
  token: {
    colorPrimary: '#ffb000', 
    controlItemBgActive: '#383838',        // Primäre Farbe
    colorBgBase: '#000',           // Basis-Hintergrundfarbe
    colorTextBase: '#fff',         // Basis-Textfarbe
    colorBorder: '#434343',        // Rahmenfarbe
    colorBgContainer: '#141414',   // Hintergrund für Container
    colorTextSecondary: '#d9d9d9', // Sekundäre Textfarbe
    fontSize: 14,                  // Basis-Schriftgröße
    borderRadius: 4,               // Abgerundete Ecken
    itemSelectedBg: '#383838', 
  },
  components: {
    Menu: {
      itemBg: '#383838',           // Hintergrund für Menüpunkte
      itemColor: '#fff',           // Textfarbe für Menüpunkte
      itemHoverBg: 'none',      // Hover-Hintergrund
      itemHoverColor: '#fff',      // Hover-Textfarbe
      itemSelectedBg: '#ffb000',   // Ausgewählter Hintergrund
      itemSelectedColor: '#fff',   // Ausgewählte Textfarbe
    },
    Button: {
      colorPrimary: '#ffb000',     // Primäre Button-Farbe
      colorPrimaryHover: 'none', // Hover-Farbe
      border: 'none',
    },
    
    Layout: {
      headerBg: '#383838',         // Header-Hintergrund
      footerBg: '#383838',         // Footer-Hintergrund
      bodyBg: '#000',              // Body-Hintergrund
    },
    Tree: {
      nodeSelectedBg: '#383838',
    }        
  },
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <UserProvider>
    <ConfigProvider theme={darkTheme}>
      <App />
    </ConfigProvider>
    </UserProvider>
  </React.StrictMode>
);