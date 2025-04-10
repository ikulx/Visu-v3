import React, { Suspense, useState, useEffect, useMemo, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'; // Navigate hinzugefügt
import { Spin, Modal, Button } from 'antd'; // Button hinzugefügt
import { useTranslation } from 'react-i18next';
import socket from './socket';
import MainLayout from './Layout/MainLayout';
import 'antd/dist/reset.css';
import { produce } from 'immer'; // Immer importieren
import { UserProvider } from './UserContext'; // UserProvider importieren

// Lazy Loading für Komponenten
const LazyPage = React.lazy(() => import('./Page'));
// const LazySettingsPage = React.lazy(() => import('./SettingsPage')); // Falls benötigt

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
              if (typeof item.label === 'object' && item.label !== null) {
                  item.label.value = value;
              } else {
                  item.label = value;
              }
              updated = true;
          } else if (item.properties) {
              // Nur aktualisieren, wenn sich der Wert tatsächlich ändert (optional, aber gut für Performance)
              if (item.properties[propKey] !== value) {
                   item.properties[propKey] = value;
                   updated = true;
              }
          }
          // Optional: break, wenn Links eindeutig sind
          // break;
      }

      if (item.sub) {
         // Wenn im Sub-Baum aktualisiert wurde, muss nicht weiter gesucht werden in diesem Ast
         if (updateMenuPropertyImmer(item.sub, link, propKey, value)) {
             updated = true;
             // Optional: break; wenn Links eindeutig sind
         }
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

  // Handler für MQTT Property Updates mit Immer und useCallback
  const handleMqttPropertyUpdate = useCallback((updates) => {
    // console.log('MQTT property update received in App.js:', updates); // Debugging
    setMenuData(
      produce((draft) => {
        if (!draft || !draft.menuItems) return;
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
        // Nur neu rendern, wenn sich wirklich was geändert hat (Immer macht das ggf. schon intern)
        // return changed ? draft : undefined; // Optional: Explizite Kontrolle
      })
    );
  }, []); // Keine Abhängigkeiten

  // Handle vollständige Menü-Updates
   const handleMenuUpdate = useCallback((data) => {
        console.log('Full menu update received:', data ? 'Data received' : 'No data');
        if (data && Array.isArray(data.menuItems)) {
             setMenuData(data);
             if (!isInitialMenuLoaded) {
                setIsInitialMenuLoaded(true);
             }
        } else {
            console.warn("Ungültiges Menü-Update-Format empfangen.");
            setMenuData({ menuItems: [] }); // Setze leeres Menü bei ungültigen Daten
            setIsInitialMenuLoaded(true); // Verhindere endloses Laden
        }
   }, [isInitialMenuLoaded]); // Abhängigkeit von isInitialMenuLoaded

  // Effekt für Socket-Verbindung und Listener
  useEffect(() => {
    const onConnect = () => {
      console.log('Socket connected');
      setIsConnected(true);
      setConnectionError(null);
      // Fordere Menüdaten an (Backend sollte auf 'connection' reagieren oder einen spezifischen Event nutzen)
       console.log("Requesting initial menu after connect...");
       // Backend sendet 'menu-update' bei Verbindung, kein expliziter Request hier nötig.
    };

    const onDisconnect = (reason) => {
      console.log('Socket disconnected:', reason);
      setIsConnected(false);
      setConnectionError(t('connectionLost'));
       setIsInitialMenuLoaded(false);
    };

    const onConnectError = (error) => {
      console.log('Socket connect error:', error);
      setIsConnected(false);
      setConnectionError(t('connectionError', { message: error.message || 'Unknown error' }));
       setIsInitialMenuLoaded(false);
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
        setConnectionError(t('reconnectFailed')); // String in i18n hinzufügen
     };

      // Listener für spezifische Variablen-Updates (optional)
      // const handleVariableUpdate = (data) => { ... };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('reconnect_attempt', onReconnectAttempt);
    socket.on('reconnect_error', onReconnectError);
    socket.on('reconnect_failed', onReconnectFailed);
    socket.on('menu-update', handleMenuUpdate);
    socket.on('mqtt-property-update', handleMqttPropertyUpdate);
    // socket.on('variable-updated', handleVariableUpdate); // Aktivieren, wenn benötigt

    if (socket.connected) {
       onConnect(); // Initialen Status setzen
    } else {
      console.log("Initial socket status: disconnected");
      setConnectionError(t('initialConnectionError'));
      setIsInitialMenuLoaded(false);
    }

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
      // socket.off('variable-updated', handleVariableUpdate);
    };
  }, [t, handleMqttPropertyUpdate, handleMenuUpdate]); // Callbacks als Abhängigkeiten

  // Memoisiere abgeleitete Werte
  const flatMenuItems = useMemo(() => flattenMenuItems(menuData.menuItems), [menuData.menuItems]);
  const allSvgs = useMemo(() => {
    const svgNames = flatMenuItems.map(item => item.svg).filter(Boolean);
    return Array.from(new Set(svgNames));
  }, [flatMenuItems]);

  // Finde das erste gültige Element für die Startroute
  const firstValidLink = useMemo(() => {
       const homeItem = flatMenuItems.find(item => item.link === '/');
       if (homeItem) return '/';
       // Ansonsten das erste Element der Liste (außer /settings)
       const firstItem = flatMenuItems.find(item => item.link && item.link !== '/settings');
       return firstItem ? firstItem.link : null; // Fallback auf null, falls gar nichts da ist
  }, [flatMenuItems]);


  return (
    // UserProvider umschließt die gesamte Anwendung
    <UserProvider>
        <Router>
          <MainLayout menuItems={menuData.menuItems}> {/* Übergib den aktuellen State */}
            <Suspense
              fallback={
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#fff' }}>
                  <Spin size="large" />
                </div>
              }
            >
             {/* Ladeindikator, bis Menü da oder Fehler auftritt */}
             {!isInitialMenuLoaded && !connectionError && (
                 <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#fff' }}>
                   <Spin size="large" tip={t('loadingMenu')} />
                 </div>
               )}
              {/* Routen nur rendern, wenn Menü geladen ODER ein Verbindungsfehler angezeigt wird */}
              {(isInitialMenuLoaded || connectionError) && (
                 <Routes>
                   {flatMenuItems.map(item => (
                     item && item.link ? ( // Zusätzlicher Check
                       <Route
                         key={item.link}
                         path={item.link}
                         element={<LazyPage svg={item.svg} properties={item} allSvgs={allSvgs} />}
                       />
                     ) : null
                   ))}
                   {/* Fallback-Route: Leite auf die erste gültige Seite um oder zeige Meldung */}
                   <Route path="/" element={firstValidLink ? <Navigate to={firstValidLink} replace /> : <div style={{ color: '#fff', padding: '20px' }}>{t('noPageAvailable')}</div>} />
                   {/* <Route path="/settings" element={<LazySettingsPage />} /> // Falls Settings-Seite existiert */}
                   <Route path="*" element={<div style={{ color: '#fff', padding: '20px'  }}>{t('pageNotFound')}</div>} />
                 </Routes>
               )}
            </Suspense>
          </MainLayout>

          {/* Fehler-Modal */}
          <Modal
             open={!!connectionError}
             footer={null}
             closable={false}
             maskClosable={false}
             centered
             bodyStyle={{
                 backgroundColor: 'rgba(204, 0, 0, 0.9)',
                 color: '#fff',
                 display: 'flex',
                 flexDirection: 'column',
                 justifyContent: 'center',
                 alignItems: 'center',
                 textAlign: 'center',
                 padding: '30px',
                 borderRadius: '8px',
                 minHeight: '150px'
             }}
           >
             <div>
               <h2 style={{ marginBottom: '15px', fontSize: '24px' }}>{t('connectionLostTitle')}</h2>
               <p style={{ fontSize: '18px', marginBottom: '10px' }}>{connectionError}</p>
               {connectionError && connectionError !== t('reconnectFailed') && !connectionError.startsWith(t('connectionError').split(':')[0]) && ( // Zeige nur bei bestimmten Fehlern
                  <p style={{ fontSize: '16px' }}>{t('reconnecting')}</p>
               )}
                {connectionError === t('reconnectFailed') && (
                   <Button type="primary" onClick={() => window.location.reload()} style={{ marginTop: '20px' }}>
                      {t('reloadPage')}
                   </Button>
                )}
             </div>
           </Modal>
        </Router>
    </UserProvider> // UserProvider schließt hier
  );
}

export default App;