// src/App.js
import React, { Suspense, useState, useEffect, useMemo, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Spin, Modal, Button, message } from 'antd';
import { useTranslation } from 'react-i18next';
import socket from './socket';
import MainLayout from './Layout/MainLayout';
import 'antd/dist/reset.css';
import { produce } from 'immer';
import { UserProvider } from './UserContext';
// Importiere AlarmsPopup direkt, da es jetzt Props empfängt
import AlarmsPopup from './Layout/AlarmsPopup';

// Lazy Loading für Page
const LazyPage = React.lazy(() => import('./Page'));

// Hilfsfunktion zum Abflachen der Menüstruktur für Routing
const flattenMenuItems = (items) => {
  let flat = [];
  if (!Array.isArray(items)) return flat;
  items.forEach(item => {
    if (item && item.link) flat.push(item);
    if (item && item.sub && Array.isArray(item.sub)) {
      flat = flat.concat(flattenMenuItems(item.sub));
    }
  });
  return flat;
};

// Hilfsfunktion zum rekursiven Finden und Aktualisieren im State mit Immer
const updateMenuPropertyImmer = (items, link, propKey, value) => {
    if (!items) return false; // Abbruch, wenn items undefiniert ist
    let updated = false;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;

      if (item.link === link) {
          if (propKey === 'label') {
              // Unterscheidung, ob Label ein Objekt oder String ist
              if (typeof item.label === 'object' && item.label !== null) {
                  if (item.label.value !== value) { // Nur ändern, wenn Wert neu
                     item.label.value = value;
                     updated = true;
                  }
              } else if (item.label !== value) { // Nur ändern, wenn Wert neu
                  item.label = value;
                  updated = true;
              }
          } else if (item.properties) {
              // Nur aktualisieren, wenn sich der Wert tatsächlich ändert
              // oder wenn die Property noch nicht existiert
              if (!item.properties.hasOwnProperty(propKey) || item.properties[propKey] !== value) {
                   if (!item.properties) item.properties = {}; // Initialisieren falls nicht vorhanden
                   item.properties[propKey] = value;
                   updated = true;
              }
          }
      }

      // Rekursiv in Untermenüs suchen
      if (item.sub && updateMenuPropertyImmer(item.sub, link, propKey, value)) {
         updated = true;
      }
    }
    return updated; // Gibt zurück, ob etwas geändert wurde
};


function App() {
  const { t } = useTranslation();
  const [menuData, setMenuData] = useState({ menuItems: [] });
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [connectionError, setConnectionError] = useState(null);
  const [isInitialMenuLoaded, setIsInitialMenuLoaded] = useState(false);
  const [loggablePages, setLoggablePages] = useState([]);
  // Zustand für MQTT Notification Status (jetzt hier global)
  const [mqttNotificationsEnabled, setMqttNotificationsEnabled] = useState(true); // Default-Annahme

  // Handler für MQTT Property Updates mit Immer
  const handleMqttPropertyUpdate = useCallback((updates) => {
    // console.log("Received mqtt-property-update:", updates); // Debug Log
    setMenuData(
      produce((draft) => {
        if (!draft || !draft.menuItems) {
           console.warn("Draft or draft.menuItems is undefined in handleMqttPropertyUpdate");
           return;
        }
        let changed = false;
        for (const [key, value] of Object.entries(updates)) {
          const dotIndex = key.lastIndexOf('.');
          if (dotIndex === -1) continue;
          const link = key.substring(0, dotIndex);
          const propKey = key.substring(dotIndex + 1);
          if (updateMenuPropertyImmer(draft.menuItems, link, propKey, value)) {
              changed = true;
          }
        }
        // Wenn keine Änderungen durch updateMenuPropertyImmer stattfanden,
        // gibt produce den originalen State zurück, was unnötige Re-Renders verhindert.
        // console.log("Menu update changed state:", changed); // Debug Log
      })
    );
  }, []); // Keine Abhängigkeiten nötig wegen Immer

  // Handle vollständige Menü-Updates
   const handleMenuUpdate = useCallback((data) => {
        console.log('Full menu update received:', data ? `(${data?.menuItems?.length} items)` : 'No data');
        if (data && Array.isArray(data.menuItems)) {
             setMenuData(data);
             if (!isInitialMenuLoaded) {
                setIsInitialMenuLoaded(true);
             }
        } else {
            console.warn("Ungültiges Menü-Update-Format empfangen.");
            setMenuData({ menuItems: [] });
            setIsInitialMenuLoaded(true); // Verhindere endloses Laden
        }
   }, [isInitialMenuLoaded]);

   // Handler zum Umschalten des MQTT Status (wird an Popup übergeben)
   const handleToggleMqttNotifications = useCallback(() => {
       const newState = !mqttNotificationsEnabled;
       // Lokalen State nicht mehr hier setzen, wird durch Backend-Antwort aktualisiert
       // setMqttNotificationsEnabled(newState);
       // Änderung an Backend senden
       socket.emit('set-mqtt-notification-status', { enabled: newState });
       // console.log(`[App] Emitted set-mqtt-notification-status: ${newState}`);
       // Feedback direkt geben (optional)
       // message.info(newState ? t('mqttNotificationsEnabled') : t('mqttNotificationsDisabled'), 2);
   }, [mqttNotificationsEnabled]); // Nur Abhängigkeit vom aktuellen Zustand

  // Effekt für Socket-Verbindung und Listener
  useEffect(() => {
    const onConnect = () => {
      console.log('Socket connected');
      setIsConnected(true);
      setConnectionError(null);
      console.log("Requesting initial states after connect...");
      socket.emit('request-loggable-pages');
      socket.emit('request-mqtt-notification-status'); // Initialen Status anfordern
    };

    const onDisconnect = (reason) => {
      console.log('Socket disconnected:', reason);
      setIsConnected(false);
      setConnectionError(t('connectionLost'));
      setIsInitialMenuLoaded(false);
      setLoggablePages([]);
      setMqttNotificationsEnabled(true); // Reset auf Default beim Trennen
    };

    const onConnectError = (error) => {
      console.log('Socket connect error:', error);
      setIsConnected(false);
      setConnectionError(t('connectionError', { message: error.message || 'Unknown error' }));
      setIsInitialMenuLoaded(false);
      setLoggablePages([]);
      setMqttNotificationsEnabled(true); // Reset auf Default bei Fehler
    };

     const onReconnectAttempt = (attempt) => {
       console.log(`Reconnect attempt ${attempt}...`);
       setConnectionError(t('reconnecting'));
     };

     const onReconnectError = (error) => {
        console.log('Socket reconnect error:', error);
        setConnectionError(t('reconnectError', { message: error.message || 'Unknown error' }));
     };

     const onReconnectFailed = () => {
        console.log('Socket reconnect failed');
        setConnectionError(t('reconnectFailed', 'Wiederverbindung fehlgeschlagen. Bitte laden Sie die Seite neu.'));
     };

     const handleLoggablePagesUpdate = (pagesArray) => {
         // console.log('Loggable pages update received:', pagesArray);
         if (Array.isArray(pagesArray)) {
             setLoggablePages(pagesArray);
         } else {
             setLoggablePages([]);
         }
     };

     // Handler für MQTT Notification Status Update (bleibt hier)
     const handleMqttNotificationStatusUpdate = (data) => {
         if (typeof data?.enabled === 'boolean') {
             // console.log(`[App] Received mqtt-notification-status-update: ${data.enabled}`);
             setMqttNotificationsEnabled(data.enabled);
         }
     };

    // Listener registrieren
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('reconnect_attempt', onReconnectAttempt);
    socket.on('reconnect_error', onReconnectError);
    socket.on('reconnect_failed', onReconnectFailed);
    socket.on('menu-update', handleMenuUpdate);
    socket.on('mqtt-property-update', handleMqttPropertyUpdate);
    socket.on('loggable-pages-update', handleLoggablePagesUpdate);
    socket.on('mqtt-notification-status-update', handleMqttNotificationStatusUpdate); // Listener für Status-Updates

    // Initialen Status prüfen
    if (socket.connected) { onConnect(); }
    else { setConnectionError(t('initialConnectionError')); setIsInitialMenuLoaded(false); setLoggablePages([]); setMqttNotificationsEnabled(true); }

    // Cleanup-Funktion
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('reconnect_attempt', onReconnectAttempt);
      socket.off('reconnect_error', onReconnectError);
      socket.off('reconnect_failed', onReconnectFailed);
      socket.off('menu-update', handleMenuUpdate);
      socket.off('mqtt-property-update', handleMqttPropertyUpdate);
      socket.off('loggable-pages-update', handleLoggablePagesUpdate);
      socket.off('mqtt-notification-status-update', handleMqttNotificationStatusUpdate); // Listener entfernen
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, handleMqttPropertyUpdate, handleMenuUpdate]); // Callbacks als Abhängigkeiten

  // Memoized Werte
  const flatMenuItems = useMemo(() => flattenMenuItems(menuData.menuItems), [menuData.menuItems]);
  const allSvgs = useMemo(() => Array.from(new Set(flatMenuItems.map(item => item.svg).filter(Boolean))), [flatMenuItems]);
  const firstValidLink = useMemo(() => {
       const homeItem = flatMenuItems.find(item => item.link === '/');
       if (homeItem) return '/';
       const firstItem = flatMenuItems.find(item => item.link && item.link !== '/settings');
       return firstItem ? firstItem.link : null;
  }, [flatMenuItems]);


  // State und Handler für AlarmsPopup Sichtbarkeit
  const [alarmsPopupVisible, setAlarmsPopupVisible] = useState(false);
  const showAlarmsPopup = useCallback(() => setAlarmsPopupVisible(true), []);
  const hideAlarmsPopup = useCallback(() => setAlarmsPopupVisible(false), []);

  // Rendern der Anwendung
  return (
    <UserProvider>
        <Router>
          {/* Props an MainLayout übergeben */}
          <MainLayout
            menuItems={menuData.menuItems}
            loggablePages={loggablePages}
            onAlarmButtonClick={showAlarmsPopup} // Funktion zum Öffnen übergeben
            mqttNotificationsEnabled={mqttNotificationsEnabled} // Zustand übergeben
          >
            <Suspense
              fallback={ <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}><Spin size="large" /></div> }
            >
             {!isInitialMenuLoaded && !connectionError && ( <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}><Spin size="large" tip={t('loadingMenu')} /></div> )}
              {(isInitialMenuLoaded || connectionError) && (
                 <Routes>
                   {flatMenuItems.map(item => ( item?.link ? ( <Route key={item.link} path={item.link} element={<LazyPage svg={item.svg} properties={item} allSvgs={allSvgs} />} /> ) : null ))}
                   <Route path="/" element={firstValidLink ? <Navigate to={firstValidLink} replace /> : <div style={{ color: '#fff', padding: '20px' }}>{t('noPageAvailable')}</div>} />
                   <Route path="*" element={<div style={{ color: '#fff', padding: '20px' }}>{t('pageNotFound')}</div>} />
                 </Routes>
               )}
            </Suspense>
          </MainLayout>

           {/* Fehler-Modal */}
           <Modal open={!!connectionError} footer={null} closable={false} maskClosable={false} centered styles={{ body: { backgroundColor: 'rgba(204, 0, 0, 0.9)', color: '#fff', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: '30px', borderRadius: '8px', minHeight: '150px'} }}>
             <div>
               <h2 style={{ marginBottom: '15px', fontSize: '24px' }}>{t('connectionLostTitle')}</h2>
               <p style={{ fontSize: '18px', marginBottom: '10px' }}>{connectionError}</p>
               {connectionError && connectionError !== t('reconnectFailed', 'Wiederverbindung fehlgeschlagen. Bitte laden Sie die Seite neu.') && !connectionError.startsWith(t('connectionError').split(':')[0]) && (
                  <p style={{ fontSize: '16px' }}>{t('reconnecting')}</p>
               )}
                {connectionError === t('reconnectFailed', 'Wiederverbindung fehlgeschlagen. Bitte laden Sie die Seite neu.') && (
                   <Button type="primary" onClick={() => window.location.reload()} style={{ marginTop: '20px' }}>
                      {t('reloadPage', 'Seite neu laden')}
                   </Button>
                )}
             </div>
           </Modal>

          {/* Alarms Popup bekommt jetzt Props von App.js */}
          <AlarmsPopup
              visible={alarmsPopupVisible}
              onClose={hideAlarmsPopup}
              mqttNotificationsEnabled={mqttNotificationsEnabled} // Zustand übergeben
              onToggleMqttNotifications={handleToggleMqttNotifications} // Handler übergeben
          />

        </Router>
    </UserProvider>
  );
}

export default App;