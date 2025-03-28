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

  useEffect(() => {
    socket.on('menu-update', (data) => {
      console.log('Menu update received:', JSON.stringify(data, null, 2));
      setMenuData(data);
    });

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

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('reconnect_error', onReconnectError);

    if (!socket.connected) {
      setConnectionError(t('initialConnectionError'));
    }

    return () => {
      socket.off('menu-update');
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('reconnect_error', onReconnectError);
    };
  }, [t]);

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
        visible={!!connectionError}
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