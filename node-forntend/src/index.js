// src/index.js
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import App from './App';
import 'antd/dist/reset.css'; // Für Ant Design v5
import './index.css';

const darkTheme = {
  token: {
    colorPrimary: '#177ddc',    // primäre Farbe (kann weiter angepasst werden)
    colorBgBase: '#000',         // Basis-Hintergrundfarbe
    colorTextBase: '#fff',       // Basis-Textfarbe
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
