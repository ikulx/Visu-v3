import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import { UserProvider } from './UserContext';
import App from './App';
import 'antd/dist/reset.css';
import './index.css';
import './i18n';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <UserProvider>
      <ConfigProvider
        theme={{
          algorithm: theme.darkAlgorithm, // Aktiviert das dunkle Theme von Ant Design
          "token": {
    "colorPrimary": "#ffb000",
    "colorInfo": "#ffb000"
  },
  "components": {

    "Button": {
      "algorithm": true,
      "defaultActiveBorderColor": "rgb(255,176,0)",
      "defaultActiveColor": "rgb(255,176,0)",
      "defaultHoverBorderColor": "rgba(64,150,255,0)",
      "defaultHoverColor": "rgba(64,150,255,0)",
      "groupBorderColor": "rgb(255,176,0)"
    },
    Menu: {
      itemBg: '#383838',           // Hintergrund für Menüpunkte
      itemColor: '#fff',           // Textfarbe für Menüpunkte
      itemHoverBg: 'none',         // Hover-Hintergrund
      itemHoverColor: '#fff',      // Hover-Textfarbe
      itemSelectedBg: '#ffb000',   // Ausgewählter Hintergrund
      itemSelectedColor: '#fff',   // Ausgewählte Textfarbe
    },
    Layout: {
      "algorithm": true,
      headerBg: '#383838',         // Header-Hintergrund
      footerBg: '#383838',         // Footer-Hintergrund
      bodyBg: '#000',              // Body-Hintergrund
    },
    
  },
        }}
      >
        <App />
      </ConfigProvider>
    </UserProvider>
  </React.StrictMode>
);