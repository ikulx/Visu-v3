// src/index.js
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import App from './App';
import 'antd/dist/reset.css';
import './index.css';

const darkTheme = {
  token: {
    colorPrimary: '#ffb000',       // Primäre Farbe
    colorBgBase: '#000',           // Basis-Hintergrundfarbe
    colorTextBase: '#fff',         // Basis-Textfarbe
    colorBorder: '#434343',        // Rahmenfarbe
    colorBgContainer: '#141414',   // Hintergrund für Container
    colorTextSecondary: '#d9d9d9', // Sekundäre Textfarbe
    fontSize: 14,                  // Basis-Schriftgröße
    borderRadius: 4,               // Abgerundete Ecken
  },
  components: {
    Menu: {
      itemBg: '#383838',           // Hintergrund für Menüpunkte
      itemColor: '#fff',           // Textfarbe für Menüpunkte
      itemHoverBg: '#ecc97d',      // Hover-Hintergrund
      itemHoverColor: '#fff',      // Hover-Textfarbe
      itemSelectedBg: '#ffb000',   // Ausgewählter Hintergrund
      itemSelectedColor: '#fff',   // Ausgewählte Textfarbe
    },
    Button: {
      colorPrimary: '#177ddc',     // Primäre Button-Farbe
      colorPrimaryHover: '#40a9ff', // Hover-Farbe
    },
    Layout: {
      headerBg: '#383838',         // Header-Hintergrund
      footerBg: '#383838',         // Footer-Hintergrund
      bodyBg: '#000',              // Body-Hintergrund
    },
  },
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ConfigProvider theme={darkTheme}>
      <App />
    </ConfigProvider>
  </React.StrictMode>
);