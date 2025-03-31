// src/App.js
import React, { Suspense, useState, useEffect, useMemo } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Spin, Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import socket from './socket';
import MainLayout from './Layout/MainLayout';
import 'antd/dist/reset.css';

const LazyPage = React.lazy(() => import('./Page'));
const LazySettingsPage = React.lazy(() => import('./SettingsPage'));

const flattenMenuItems = (items) => {
  let flat = [];
  items.forEach(item => {
    if (item.link) flat.push(item);
    if (item.sub && Array.isArray(item.sub)) flat = flat.concat(flattenMenuItems(item.sub));
  });
  return flat;
};

function App() {
  const { t } = useTranslation();
  const [menuData, setMenuData] = useState({ menuItems: [] });
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [connectionError, setConnectionError] = useState(null);

  // Stabilisierte menuItems für die Übergabe an Komponenten
  const stabilizedMenuItems = useMemo(() => {
    return JSON.parse(JSON.stringify(menuData.menuItems)); // Tiefe Kopie für Stabilität
  }, [menuData.menuItems]);

  useEffect(() => {
    const handleMenuUpdate = (data) => {
      console.log('Menu update received in App.js:', JSON.stringify(data, null, 2));
      setMenuData(data);
    };

    const handleMqttPropertyUpdate = (updates) => {
      console.log('MQTT property update received in App.js:', JSON.stringify(updates, null, 2));
      setMenuData(prevData => {
        const newMenuItems = JSON.parse(JSON.stringify(prevData.menuItems)); // Tiefe Kopie
        for (const [key, value] of Object.entries(updates)) {
          const [link, propKey] = key.split('.');
          const updateItem = (items) => {
            for (const item of items) {
              if (item.link === link) {
                item.properties[propKey] = value;
              }
              if (item.sub) {
                updateItem(item.sub);
              }
            }
          };
          updateItem(newMenuItems);
        }
        return { menuItems: newMenuItems };
      });
    };

    const onConnect = () => {
      console.log('Socket connected');
      setIsConnected(true);
      setConnectionError(null);
    };

    const onDisconnect = () => {
      console.log('Socket disconnected');
      setIsConnected(false);
      setConnectionError(t('connectionLost'));
    };

    const onConnectError = (error) => {
      console.log('Socket connect error:', error.message);
      setIsConnected(false);
      setConnectionError(t('connectionError', { message: error.message || 'Unknown error' }));
    };

    const onReconnectError = (error) => {
      console.log('Socket reconnect error:', error.message);
      setIsConnected(false);
      setConnectionError(t('reconnectError', { message: error.message || 'Unknown error' }));
    };

    socket.on('menu-update', handleMenuUpdate);
    socket.on('mqtt-property-update', handleMqttPropertyUpdate);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('reconnect_error', onReconnectError);

    if (!socket.connected) {
      setConnectionError(t('initialConnectionError'));
    }

    return () => {
      socket.off('menu-update', handleMenuUpdate);
      socket.off('mqtt-property-update', handleMqttPropertyUpdate);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('reconnect_error', onReconnectError);
    };
  }, [t]);

  const flatMenuItems = useMemo(() => flattenMenuItems(stabilizedMenuItems), [stabilizedMenuItems]);
  const allSvgs = useMemo(() => {
    const svgNames = flatMenuItems.map(item => item.svg).filter(Boolean);
    return Array.from(new Set(svgNames));
  }, [flatMenuItems]);

  // console.log('Stabilized MenuItems passed to MainLayout:', JSON.stringify(stabilizedMenuItems, null, 2));

  return (
    <Router>
      <MainLayout menuItems={stabilizedMenuItems}>
        <Suspense
          fallback={
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#fff' }}>
              <Spin size="large" tip="Lädt..." />
            </div>
          }
        >
          <Routes>
            {flatMenuItems.map(item => (
              <Route
                key={item.link}
                path={item.link}
                element={<LazyPage svg={item.svg} properties={item.properties} allSvgs={allSvgs} />}
              />
            ))}
            <Route path="/settings" element={<LazySettingsPage />} />
            <Route path="*" element={<div style={{ color: '#fff' }}>{t('selectPage')}</div>} />
          </Routes>
        </Suspense>
      </MainLayout>

      <Modal
        open={!!connectionError}
        footer={null}
        closable={false}
        maskClosable={false}
        width="100%"
        centered
        style={{ top: 0, padding: 0 }}
        styles={{
          body: {
            height: '100%',
            backgroundColor: 'rgba(255, 0, 0, 0.9)',
            color: '#fff',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            fontSize: '24px',
            textAlign: 'center',
            padding: '20px'
          }
        }}
      >
        <div>
          <h2>{t('connectionLostTitle')}</h2>
          <p>{connectionError}</p>
          <p>{t('reconnecting')}</p>
        </div>
      </Modal>
    </Router>
  );
}

export default App;