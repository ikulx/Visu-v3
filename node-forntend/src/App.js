// src/App.js
import React, { Suspense, useState, useEffect, useMemo } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Spin, Modal } from 'antd'; // Modal statt notification verwenden
import socket from './socket';
import MainLayout from './Layout/MainLayout';
import 'antd/dist/reset.css';

// Lazy-Load der Seiten
const LazyPage = React.lazy(() => import('./Page'));
const LazySettingsPage = React.lazy(() => import('./SettingsPage'));

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
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [connectionError, setConnectionError] = useState(null); // Fehlerstatus

  useEffect(() => {
    // Socket-Listener für Menü-Updates
    socket.on('menu-update', (data) => {
      console.log('Menu update received:', data);
      setMenuData(data);
    });

    // Listener für Verbindungsstatus mit Debugging
    const onConnect = () => {
      console.log('Socket connected');
      setIsConnected(true);
      setConnectionError(null); // Fehler zurücksetzen
    };

    const onDisconnect = () => {
      console.log('Socket disconnected');
      setIsConnected(false);
      setConnectionError('Verbindung zum Server unterbrochen');
    };

    const onConnectError = (error) => {
      console.log('Socket connect error:', error.message);
      setIsConnected(false);
      setConnectionError(`Verbindungsfehler: ${error.message || 'Unbekannter Fehler'}`);
    };

    const onReconnectError = (error) => {
      console.log('Socket reconnect error:', error.message);
      setIsConnected(false);
      setConnectionError(`Wiederverbindungsfehler: ${error.message || 'Unbekannter Fehler'}`);
    };

    // Socket-Listener hinzufügen
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('reconnect_error', onReconnectError);

    // Initialer Status prüfen
    console.log('Initial socket status:', socket.connected);
    if (!socket.connected) {
      setConnectionError('Keine Verbindung zum Server beim Start');
    }

    // Cleanup bei Unmount
    return () => {
      socket.off('menu-update');
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('reconnect_error', onReconnectError);
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
            <Route path="/settings" element={<LazySettingsPage />} />
            <Route
              path="*"
              element={<div style={{ color: '#fff' }}>Bitte wähle eine Seite aus dem Menü</div>}
            />
          </Routes>
        </Suspense>
      </MainLayout>

      {/* Vollbild-Benachrichtigung als Modal */}
      <Modal
        visible={!!connectionError} // Sichtbar, wenn connectionError gesetzt ist
        footer={null} // Keine Schaltflächen am unteren Rand
        closable={false} // Kein Schließen-Button
        maskClosable={false} // Nicht durch Klick auf Hintergrund schließbar
        width={'100%'}
        centered
        
        style={{ top: 0, padding: 0 }} // Oben ausgerichtet, kein Padding
        bodyStyle={{
          // height: '100vh',
          
          backgroundColor: 'rgba(255, 0, 0, 0.9)', // Roter Hintergrund mit Transparenz
          color: '#fff',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          fontSize: '24px',
          textAlign: 'center',
          padding: '20px'
        }}
      >
        <div>
          <h2>Verbindungsproblem</h2>
          <p>{connectionError}</p>
          <p>Versuche, die Verbindung wiederherzustellen...</p>
        </div>
      </Modal>
    </Router>
  );
}

export default App;