// src/App.js
import React, { Suspense, useState, useEffect, useMemo, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Spin, Modal, Button } from 'antd';
import { useTranslation } from 'react-i18next';
import socket from './socket';
import MainLayout from './Layout/MainLayout';
import 'antd/dist/reset.css';
import { produce } from 'immer';
import { UserProvider } from './UserContext';

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
              // Unterscheidung, ob Label ein Objekt oder String ist
              if (typeof item.label === 'object' && item.label !== null) {
                  item.label.value = value; // Nur den Wert im Objekt ändern
              } else {
                  item.label = value; // Einfachen String überschreiben
              }
              updated = true;
          } else if (item.properties) {
              // Nur aktualisieren, wenn sich der Wert tatsächlich ändert
              if (item.properties[propKey] !== value) {
                   item.properties[propKey] = value;
                   updated = true;
              }
          }
          // Optional: break; wenn Links eindeutig sind und Performance wichtig ist
          // break;
      }

      // Rekursiv in Untermenüs suchen
      if (item.sub) {
         // Wenn im Sub-Baum aktualisiert wurde, muss nicht weiter gesucht werden
         if (updateMenuPropertyImmer(item.sub, link, propKey, value)) {
             updated = true;
             // Optional: break;
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
  // State für logbare Seiten (wird von loggingHandler befüllt)
  const [loggablePages, setLoggablePages] = useState([]);

  // Handler für MQTT Property Updates mit Immer und useCallback
  const handleMqttPropertyUpdate = useCallback((updates) => {
    setMenuData(
      produce((draft) => {
        if (!draft || !draft.menuItems) return;
        // Iteriere durch alle empfangenen Updates
        for (const [key, value] of Object.entries(updates)) {
          const dotIndex = key.lastIndexOf('.'); // Finde letzten Punkt (trennt link von property)
          if (dotIndex === -1) continue; // Überspringe, wenn kein Punkt gefunden wurde
          const link = key.substring(0, dotIndex);
          const propKey = key.substring(dotIndex + 1);
          // Rufe die rekursive Update-Funktion auf
          updateMenuPropertyImmer(draft.menuItems, link, propKey, value);
        }
      })
    );
  }, []); // Keine Abhängigkeiten, da produce verwendet wird

  // Handle vollständige Menü-Updates
   const handleMenuUpdate = useCallback((data) => {
        console.log('Full menu update received:', data ? 'Data received' : 'No data');
        if (data && Array.isArray(data.menuItems)) {
             setMenuData(data); // Setze die neuen Menüdaten
             if (!isInitialMenuLoaded) {
                setIsInitialMenuLoaded(true); // Markiere, dass das Menü geladen wurde
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
      // Backend sendet 'menu-update' und 'loggable-pages-update' bei Verbindung automatisch
      // Explizite Anfrage nach loggable pages sicherheitshalber
      console.log("Requesting loggable pages after connect...");
      socket.emit('request-loggable-pages');
    };

    const onDisconnect = (reason) => {
      console.log('Socket disconnected:', reason);
      setIsConnected(false);
      setConnectionError(t('connectionLost'));
      setIsInitialMenuLoaded(false); // Menü muss neu geladen werden
      setLoggablePages([]); // Logbare Seiten zurücksetzen bei Disconnect
    };

    const onConnectError = (error) => {
      console.log('Socket connect error:', error);
      setIsConnected(false);
      setConnectionError(t('connectionError', { message: error.message || 'Unknown error' }));
      setIsInitialMenuLoaded(false);
      setLoggablePages([]); // Logbare Seiten zurücksetzen bei Fehler
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
        setConnectionError(t('reconnectFailed', 'Wiederverbindung fehlgeschlagen. Bitte laden Sie die Seite neu.')); // String in i18n hinzufügen/prüfen
     };

     // Handler für logbare Seiten Updates
     const handleLoggablePagesUpdate = (pagesArray) => {
         console.log('Loggable pages update received:', pagesArray);
         if (Array.isArray(pagesArray)) {
             setLoggablePages(pagesArray); // Aktualisiere den State
         } else {
             console.warn("Ungültiges Format für loggable-pages-update empfangen.");
             setLoggablePages([]); // Setze auf leeres Array bei ungültigen Daten
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
    // Listener für logbare Seiten
    socket.on('loggable-pages-update', handleLoggablePagesUpdate);

    // Prüfe initialen Verbindungsstatus
    if (socket.connected) {
       onConnect(); // Initialen Status setzen und Daten anfordern
    } else {
      console.log("Initial socket status: disconnected");
      setConnectionError(t('initialConnectionError'));
      setIsInitialMenuLoaded(false); // Kein Menü geladen
      setLoggablePages([]); // Keine logbaren Seiten bekannt
    }

    // Cleanup-Funktion: Entfernt alle Listener beim Unmounten der Komponente
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
    };
  }, [t, handleMqttPropertyUpdate, handleMenuUpdate]); // Callbacks als Abhängigkeiten

  // Memoisiere abgeleitete Werte: flache Menüliste und alle verwendeten SVGs
  const flatMenuItems = useMemo(() => flattenMenuItems(menuData.menuItems), [menuData.menuItems]);
  const allSvgs = useMemo(() => {
    const svgNames = flatMenuItems.map(item => item.svg).filter(Boolean);
    return Array.from(new Set(svgNames)); // Eindeutige SVG-Namen
  }, [flatMenuItems]);

  // Memoisiere den ersten gültigen Link für die Startroute (Fallback)
  const firstValidLink = useMemo(() => {
       const homeItem = flatMenuItems.find(item => item.link === '/'); // Gibt es eine explizite Homepage?
       if (homeItem) return '/';
       // Ansonsten das erste Element der Liste (außer /settings, falls vorhanden)
       const firstItem = flatMenuItems.find(item => item.link && item.link !== '/settings');
       return firstItem ? firstItem.link : null; // Fallback auf null, falls gar nichts da ist
  }, [flatMenuItems]);


  // Rendern der Anwendung
  return (
    <UserProvider> {/* Stellt Benutzerkontext bereit */}
        <Router> {/* Router für Navigation */}
          <MainLayout menuItems={menuData.menuItems} loggablePages={loggablePages}> {/* loggablePages weitergeben */}
            <Suspense
              fallback={ // Ladeindikator für lazy loaded Komponenten
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#fff' }}>
                  <Spin size="large" />
                </div>
              }
            >
             {/* Ladeindikator, bis Menü da oder Fehler auftritt */}
             {!isInitialMenuLoaded && !connectionError && (
                 <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#fff' }}>
                   <Spin size="large" tip={t('loadingMenu', 'Lade Menü...')} />
                 </div>
               )}
              {/* Routen nur rendern, wenn Menü geladen ODER ein Verbindungsfehler angezeigt wird */}
              {(isInitialMenuLoaded || connectionError) && (
                 <Routes>
                   {/* Erstelle Routen für jeden Menüeintrag */}
                   {flatMenuItems.map(item => (
                     item && item.link ? ( // Sicherstellen, dass Item und Link existieren
                       <Route
                         key={item.link} // Eindeutiger Key für die Route
                         path={item.link} // Pfad der Route
                         element={<LazyPage svg={item.svg} properties={item} allSvgs={allSvgs} />} // Lazy loaded Seitenkomponente
                       />
                     ) : null // Ignoriere ungültige Einträge
                   ))}
                   {/* Fallback-Route: Leite auf erste gültige Seite oder zeige Meldung */}
                   <Route path="/" element={firstValidLink ? <Navigate to={firstValidLink} replace /> : <div style={{ color: '#fff', padding: '20px' }}>{t('noPageAvailable', 'Keine Seite verfügbar.')}</div>} />
                   {/* Route für nicht gefundene Pfade */}
                   <Route path="*" element={<div style={{ color: '#fff', padding: '20px' }}>{t('pageNotFound', 'Seite nicht gefunden.')}</div>} />
                 </Routes>
               )}
            </Suspense>
          </MainLayout>

           {/* Fehler-Modal für Verbindungsprobleme */}
           <Modal
             open={!!connectionError} // Sichtbar, wenn connectionError gesetzt ist
             footer={null} closable={false} maskClosable={false} centered
             styles={{ body: { backgroundColor: 'rgba(204, 0, 0, 0.9)', color: '#fff', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: '30px', borderRadius: '8px', minHeight: '150px'} }}
           >
             <div>
               <h2 style={{ marginBottom: '15px', fontSize: '24px' }}>{t('connectionLostTitle', 'Verbindungsproblem')}</h2>
               <p style={{ fontSize: '18px', marginBottom: '10px' }}>{connectionError}</p>
               {/* Zeige "Verbinde neu...", außer bei bestimmten Fehlern */}
               {connectionError && connectionError !== t('reconnectFailed', 'Wiederverbindung fehlgeschlagen. Bitte laden Sie die Seite neu.') && !connectionError.startsWith(t('connectionError').split(':')[0]) && (
                  <p style={{ fontSize: '16px' }}>{t('reconnecting', 'Versuche, die Verbindung wiederherzustellen...')}</p>
               )}
                {/* Zeige Reload-Button, wenn Wiederverbindung endgültig scheitert */}
                {connectionError === t('reconnectFailed', 'Wiederverbindung fehlgeschlagen. Bitte laden Sie die Seite neu.') && (
                   <Button type="primary" onClick={() => window.location.reload()} style={{ marginTop: '20px' }}>
                      {t('reloadPage', 'Seite neu laden')}
                   </Button>
                )}
             </div>
           </Modal>

        </Router>
    </UserProvider>
  );
}

export default App;