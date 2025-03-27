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
  const [state, setState] = useState({
    menu: { menuItems: [] },
    qhmiVariables: [],
    footer: { temperature: '–' },
    connectionError: null,
    menuError: null,
  });

  useEffect(() => {
    socket.on('data-update', ({ type, data }) => {
      console.log(`[DEBUG] Eingehendes Event: ${type}`, data);
      if (type === 'menu-update-success') {
        setState(prev => ({ ...prev, menu: data }));
      } else if (type === 'menu-update-error') {
        setState(prev => ({ ...prev, menuError: data.message }));
      } else {
        setState(prev => ({ ...prev, [type]: data }));
      }
    });

    const onConnect = () => {
      setState(prev => ({ ...prev, connectionError: null }));
      socket.emit('request-data', 'menu');
      socket.emit('request-data', 'qhmi-variables');
    };

    const onDisconnect = () => setState(prev => ({ ...prev, connectionError: t('connectionLost') }));
    const onConnectError = (error) => setState(prev => ({ ...prev, connectionError: t('connectionError', { message: error.message || 'Unknown error' }) }));
    const onReconnectError = (error) => setState(prev => ({ ...prev, connectionError: t('reconnectError', { message: error.message || 'Unknown error' }) }));

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('reconnect_error', onReconnectError);

    if (!socket.connected) setState(prev => ({ ...prev, connectionError: t('initialConnectionError') }));

    return () => {
      socket.off('data-update');
      socket.off('connect');
      socket.off('disconnect');
      socket.off('connect_error');
      socket.off('reconnect_error');
    };
  }, [t]);

  const visibleMenuItems = useMemo(() => {
    const filterVisible = (items) => items
      .filter(item => !(item.labelSource === 'dynamic' && item.qhmi_variable_id && item.visible === 0))
      .map(item => ({ ...item, sub: filterVisible(item.sub || []) }));
    return filterVisible(state.menu.menuItems);
  }, [state.menu]);

  const flatMenuItems = flattenMenuItems(visibleMenuItems);
  const allSvgs = useMemo(() => Array.from(new Set(flatMenuItems.map(item => item.svg).filter(Boolean))), [flatMenuItems]);

  return (
    <Router>
      <MainLayout menuItems={visibleMenuItems}>
        <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#fff' }}><Spin size="large" tip="Lädt..." /></div>}>
          <Routes>
            {flatMenuItems.map(item => (
              <Route key={item.link} path={item.link} element={<LazyPage svg={item.svg} properties={item.properties} allSvgs={allSvgs} />} />
            ))}
            <Route path="/settings" element={<LazySettingsPage />} />
            <Route path="*" element={<div style={{ color: '#fff' }}>No menu loaded</div>} />
          </Routes>
        </Suspense>
      </MainLayout>

      <Modal
        visible={!!state.connectionError}
        footer={null}
        closable={false}
        maskClosable={false}
        width="100%"
        centered
        style={{ top: 0, padding: 0 }}
        styles={{ body: { height: '100%', backgroundColor: 'rgba(255, 0, 0, 0.9)', color: '#fff', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '24px', textAlign: 'center', padding: '0px' } }}
      >
        <div>
          <h2>{t('connectionLostTitle')}</h2>
          <p>{state.connectionError}</p>
          <p>{t('reconnecting')}</p>
        </div>
      </Modal>

      <Modal
        visible={!!state.menuError}
        footer={null}
        closable={false}
        maskClosable={false}
        width="100%"
        centered
        style={{ top: 0, padding: 0 }}
        styles={{ body: { height: '100%', backgroundColor: 'rgba(255, 165, 0, 0.9)', color: '#fff', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '24px', textAlign: 'center', padding: '20px' } }}
      >
        <div>
          <h2>Menü-Fehler</h2>
          <p>{state.menuError}</p>
        </div>
      </Modal>
    </Router>
  );
}

export default App;