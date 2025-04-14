import React, { useEffect, useState, useMemo } from 'react';
// +++ NEU: Zusätzliche Imports +++
import { Modal, Table, Menu, Grid, Drawer, Button, Upload, message, Space, Divider } from 'antd';
import { useTranslation } from 'react-i18next';
import socket from './socket';
import EditVariableModal from './EditVariableModal';
import { useUser } from './UserContext';
// +++ NEU: Icons importieren +++
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons';

// +++ NEU: Definieren Sie die Backend-Basis-URL (konsistent mit socket.js) +++
const BACKEND_BASE_URL = `http://${window.location.hostname}:3001`;

const SettingsPage = ({ visible, onClose, user }) => {
  const { t, i18n } = useTranslation();
  const { xs } = Grid.useBreakpoint(); // Bestimmt, ob die Bildschirmbreite klein ist (mobile)
  const { loggedInUser } = useUser(); // Holt den aktuell eingeloggten Benutzer

  // States für die Komponente
  const [settingsData, setSettingsData] = useState([]); // Speichert die vom Backend empfangenen Rohdaten
  const [selectedMain, setSelectedMain] = useState(null); // Ausgewählte Hauptgruppe im Menü
  const [selectedSub, setSelectedSub] = useState(null); // Ausgewählte Untergruppe im Menü
  const [menuDrawerVisible, setMenuDrawerVisible] = useState(false); // Sichtbarkeit des Menü-Drawers auf Mobilgeräten

  const [editModalVisible, setEditModalVisible] = useState(false); // Sichtbarkeit des Bearbeitungs-Popups
  const [editRecords, setEditRecords] = useState([]); // Datensätze, die im Popup bearbeitet werden

  // +++ NEU: State für Upload-Vorgang +++
  const [isUploading, setIsUploading] = useState(false); // Zeigt an, ob gerade ein CSV-Import läuft

  // Effekt: Fordert Settings vom Backend an, wenn das Modal sichtbar wird und ein Benutzer eingeloggt ist
  useEffect(() => {
    if (visible && loggedInUser) {
      console.log(`[SettingsPage] Visible for user ${loggedInUser}, requesting settings.`);
      socket.emit('request-settings', { user: loggedInUser });
    } else if (!visible) {
      // Beim Schließen des Modals Zustände zurücksetzen
      setIsUploading(false); // Upload-Status zurücksetzen
      // Optional: Auswahl zurücksetzen? Hängt vom gewünschten Verhalten ab.
      // setSelectedMain(null);
      // setSelectedSub(null);
    }
  }, [visible, loggedInUser]); // Abhängig von Sichtbarkeit und Benutzer

  // Effekt: Lauscht auf Settings-Updates vom Backend via Socket.IO
  useEffect(() => {
    const handleSettingsUpdate = (data) => {
      console.log('[SettingsPage] Received settings-update:', data ? `${data.length} items` : 'empty data');
      // Filterung basierend auf dem eingeloggten Benutzer (Backend sendet evtl. alle)
      // Diese Filterung ist wichtig, falls der globale Broadcast in dbRoutes verwendet wird.
      const filteredData = data.filter(row => {
        if (!row.benutzer) return false; // Keine Berechtigung, wenn Feld leer
        const allowedUsers = row.benutzer.split(',').map(u => u.trim().toLowerCase());
        // Zeige, wenn der Benutzer erlaubt ist ODER 'all' erlaubt ist
        return allowedUsers.includes(loggedInUser?.toLowerCase()) || allowedUsers.includes('all');
      });
      setSettingsData(filteredData);
    };
    socket.on("settings-update", handleSettingsUpdate);

    // Cleanup-Funktion: Entfernt den Listener, wenn die Komponente unmountet
    return () => {
      socket.off("settings-update", handleSettingsUpdate);
    };
  }, [loggedInUser]); // Abhängigkeit vom eingeloggten Benutzer

  // Bestimmt das zu verwendende Namensfeld basierend auf der Sprache
  const lang = i18n.language || 'en';
  const nameField =
    lang === 'de' ? 'NAME_de'
    : lang === 'fr' ? 'NAME_fr'
    : lang === 'it' ? 'NAME_it'
    : 'NAME_en'; // Fallback auf Englisch oder Deutsch wäre auch möglich

  // Memoized: Filtert die Settings, die sichtbar sein sollen (visible == 1)
  const visibleSettings = useMemo(() => {
    return settingsData.filter(row => row.visible == 1 || row.visible === '1' || row.visible === true);
  }, [settingsData]);

  // Memoized: Gruppiert die sichtbaren Settings nach tag_top und tag_sub
  const groupedData = useMemo(() => {
    const groups = {};
    visibleSettings.forEach(row => {
      const main = row.tag_top || t('ungrouped', 'Ohne Gruppe'); // Übersetzung für Fallback
      if (!groups[main]) {
        groups[main] = { withSub: {}, noSub: [] }; // Initialisiere Struktur für Hauptgruppe
      }
      const sub = row.tag_sub && row.tag_sub.trim() ? row.tag_sub.trim() : null; // Untergruppe extrahieren
      if (sub) { // Wenn Untergruppe vorhanden
        if (!groups[main].withSub[sub]) {
          groups[main].withSub[sub] = []; // Initialisiere Array für Untergruppe
        }
        groups[main].withSub[sub].push(row); // Füge Zeile zur Untergruppe hinzu
      } else { // Wenn keine Untergruppe
        groups[main].noSub.push(row); // Füge Zeile direkt zur Hauptgruppe hinzu
      }
    });
    // Optional: Gruppen sortieren
    // const sortedGroups = {};
    // Object.keys(groups).sort().forEach(key => { sortedGroups[key] = groups[key]; });
    // return sortedGroups;
    return groups;
  }, [visibleSettings, t]); // Abhängig von sichtbaren Settings und Übersetzung

  // Memoized: Erstellt die Menüstruktur für Ant Design Menu basierend auf den gruppierten Daten
  const menuItems = useMemo(() => {
    const items = [];
    Object.keys(groupedData).sort().forEach(mainKey => { // Hauptgruppen sortieren
      const group = groupedData[mainKey];
      const subItems = [];

      // Eintrag für "Allgemein" hinzufügen, wenn es Elemente ohne Untergruppe gibt
      if (group.noSub.length > 0) {
           subItems.push({ key: `${mainKey}___nosub`, label: t('general', 'Allgemein') });
       }

      // Untergruppen hinzufügen und sortieren
      Object.keys(group.withSub).sort().forEach(subKey => {
        subItems.push({ key: `${mainKey}___${subKey}`, label: subKey });
      });

      // Nur Hauptgruppen hinzufügen, die auch Einträge haben
      if (group.noSub.length > 0 || Object.keys(group.withSub).length > 0) {
          if (subItems.length === 1 && group.noSub.length > 0 && Object.keys(group.withSub).length === 0) {
              // Wenn NUR "Allgemein" drin ist, zeige direkt die Hauptgruppe
              items.push({ key: `${mainKey}___nosub`, label: mainKey });
          } else {
              // Ansonsten als Gruppe mit Kindern (oder nur als Top-Level wenn keine Kinder)
              items.push({
                 key: mainKey, // Key für die Hauptgruppe selbst (für defaultOpenKeys)
                 label: mainKey,
                 children: subItems.length > 0 ? subItems : undefined // Kinder nur wenn vorhanden
              });
          }
      }
    });
    return items;
  }, [groupedData, t]); // Abhängig von gruppierten Daten und Übersetzung

  // Effekt: Wählt automatisch den ersten Menüpunkt aus oder stellt sicher, dass die Auswahl gültig bleibt
  useEffect(() => {
    const mainKeys = Object.keys(groupedData);
    if (mainKeys.length === 0) { // Keine Daten -> Auswahl zurücksetzen
      setSelectedMain(null);
      setSelectedSub(null);
      return;
    }

    // Prüfen, ob die aktuelle Auswahl noch gültig ist
    let currentMainIsValid = selectedMain && groupedData[selectedMain];
    let currentSubIsValid = false;
    if (currentMainIsValid) {
      if (selectedSub === 'nosub') { // Prüfen, ob 'nosub' noch existiert
        currentSubIsValid = groupedData[selectedMain].noSub.length > 0;
      } else { // Prüfen, ob die spezifische Untergruppe noch existiert
        currentSubIsValid = selectedSub && groupedData[selectedMain].withSub[selectedSub];
      }
    }

    // Wenn Auswahl ungültig ODER noch keine Auswahl getroffen wurde, neue Standardauswahl treffen
    if (!currentMainIsValid || !currentSubIsValid) {
      const newMain = mainKeys.sort()[0]; // Erste sortierte Hauptgruppe
      setSelectedMain(newMain);
      const group = groupedData[newMain];
      if (group.noSub.length > 0) { // Bevorzuge "Allgemein" / 'nosub'
        setSelectedSub('nosub');
      } else { // Ansonsten erste sortierte Untergruppe
        const subKeys = Object.keys(group.withSub).sort();
        setSelectedSub(subKeys.length > 0 ? subKeys[0] : null); // Erste Untergruppe oder null, wenn keine da
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupedData]); // Nur von groupedData abhängig machen (selectedMain/Sub werden hier gesetzt)


  // Memoized: Filtert die Daten für die Tabelle basierend auf der Menüauswahl
  const filteredData = useMemo(() => {
    if (!selectedMain || !groupedData[selectedMain]) return []; // Nichts ausgewählt -> leere Tabelle

    if (selectedSub === 'nosub') { // "Allgemein" / ohne Untergruppe ausgewählt
      return groupedData[selectedMain].noSub;
    } else if (selectedSub && groupedData[selectedMain].withSub[selectedSub]) { // Spezifische Untergruppe ausgewählt
      return groupedData[selectedMain].withSub[selectedSub];
    }
    return []; // Fallback für ungültige Auswahl
  }, [groupedData, selectedMain, selectedSub]);

  // Spaltendefinitionen für die Ant Design Tabelle
  const columns = [
    {
      title: t('Name'), // Spaltenüberschrift übersetzen
      dataIndex: 'name',
      key: 'name',
      // Rendert den sprachspezifischen Namen oder den Standardnamen (NAME)
      render: (_, record) =>
        record[nameField] && record[nameField].trim() ? record[nameField] : record['NAME'],
      sorter: (a, b) => { // Sortierfunktion hinzufügen
          const nameA = (a[nameField] && a[nameField].trim() ? a[nameField] : a['NAME']) || '';
          const nameB = (b[nameField] && b[nameField].trim() ? b[nameField] : b['NAME']) || '';
          return nameA.localeCompare(nameB);
      },
      ellipsis: true, // Text kürzen, wenn zu lang
    },
    {
      title: t('Wert'), // Spaltenüberschrift übersetzen
      dataIndex: 'VAR_VALUE',
      key: 'VAR_VALUE',
      // Rendert den Wert, bei Dropdown den Klartext
      render: (text, record) => {
        if (record.TYPE === 'drop') {
          let optionsString = '';
          // Sprachabhängige Optionen laden (mit Fallback auf Deutsch/Englisch)
          const langOptions = [
            record[`OPTI_${lang}`], // Aktuelle Sprache
            record.OPTI_de,         // Fallback Deutsch
            record.OPTI_en          // Fallback Englisch
          ];
          optionsString = langOptions.find(opt => opt && opt.trim()) || ''; // Finde die erste definierte Options-Zeichenkette

          const options = optionsString
            .split(',')
            .filter(opt => opt.trim() !== '')
            .map(opt => {
              const parts = opt.split(':');
              const key = parts[0].trim();
              const label = (parts[1] || key).trim(); // Wenn kein Label da ist, nimm den Key
              return { key, label };
            });
          // Finde das passende Label zum aktuellen Wert
          const found = options.find(opt => opt.key === String(record.VAR_VALUE)); // Vergleiche als String
          return found ? found.label : record.VAR_VALUE; // Zeige Label oder (wenn nicht gefunden) den Rohwert
        } else {
          return record.VAR_VALUE; // Für andere Typen (Text, Num) zeige den Wert direkt
        }
      },
      ellipsis: true,
    },
    {
      title: t('unit', 'Einheit'), // Spaltenüberschrift übersetzen
      dataIndex: 'unit',
      key: 'unit',
      width: 80, // Breite begrenzen
      align: 'center',
    },
  ];

  // Handler für Klick auf Menüeintrag
  const onMenuClick = (e) => {
    const parts = e.key.split('___'); // Schlüssel aufteilen (Haupt___Sub)
    setSelectedMain(parts[0]);
    setSelectedSub(parts.length > 1 ? parts[1] : null); // Untergruppe setzen (kann 'nosub' sein)
    if (xs) { // Auf Mobilgeräten
      setMenuDrawerVisible(false); // Menü schließen
    }
  };

  // Handler für Klick auf Tabellenzeile -> Öffnet Bearbeitungsmodal
  const handleRowClick = (record) => {
    if (record && record.NAME) { // Nur öffnen, wenn ein gültiger Datensatz vorhanden ist
        setEditRecords([record]); // Einzelnen Datensatz als Array übergeben
        setEditModalVisible(true);
    } else {
        console.warn("Ungültiger Datensatz für Bearbeitung:", record);
    }
  };

  // Handler für erfolgreiches Update im Bearbeitungsmodal
  const handleUpdateSuccess = () => {
    setEditModalVisible(false); // Modal schließen
    // Die Datenaktualisierung erfolgt durch das 'settings-update'-Event vom Backend
  };

  // --- Handler für CSV Export ---
  const handleExportVariables = () => {
    // Konstruiere die vollständige URL zum Backend-Export-Endpunkt
    const exportUrl = `${BACKEND_BASE_URL}/db/export/variables.csv`;
    console.log(`Exportiere Variablen über URL: ${exportUrl}`);
    // Navigiere zu dieser vollständigen URL, Browser startet Download
    window.location.href = exportUrl;
  };

  // --- Konfiguration für CSV Import (Ant Design Upload) ---
  const uploadProps = useMemo(() => ({
    name: 'csvfile', // Muss mit Multer im Backend übereinstimmen
    action: `${BACKEND_BASE_URL}/db/import/variables`, // Korrekte Backend-URL
    accept: '.csv', // Nur CSV-Dateien erlauben
    showUploadList: false, // Keine Dateiliste anzeigen
    beforeUpload: (file) => { // Prüfung vor dem Upload
      const isCsv = file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv');
      if (!isCsv) {
        message.error(t('uploadErrorNotCsv', 'Sie können nur CSV-Dateien hochladen!'));
      }
      const isLt10M = file.size / 1024 / 1024 < 10; // Größenlimit 10MB
      if (!isLt10M) {
        message.error(t('uploadErrorSizeLimit', 'Datei muss kleiner als 10MB sein!'));
      }
      if (isCsv && isLt10M) {
           setIsUploading(true); // Ladezustand setzen
      }
      // Upload nur starten, wenn Prüfungen OK, sonst ignorieren
      return isCsv && isLt10M ? true : Upload.LIST_IGNORE;
    },
    onChange: (info) => { // Reaktion auf Upload-Statusänderung
      if (info.file.status === 'uploading') {
        // Hier muss nichts getan werden, da isUploading schon gesetzt ist
        return;
      }
      // Upload beendet (Erfolg oder Fehler)
      setIsUploading(false); // Ladezustand zurücksetzen

      if (info.file.status === 'done') { // Upload erfolgreich
        console.log("Upload erfolgreich:", info.file.response);
        if (info.file.response?.message) { // Prüfe Backend-Antwort
             if (info.file.response.errors && info.file.response.errors.length > 0) { // Mit Fehlern abgeschlossen
                  message.warning(`${info.file.response.message} (${t('detailsInConsole', 'Details in Konsole')})`, 6);
                  console.warn("Importfehler Details:", info.file.response.errors);
             } else { // Komplett erfolgreich
                  message.success(`${info.file.response.message} (I: ${info.file.response.inserted || 0}, U: ${info.file.response.updated || 0}, S: ${info.file.response.skipped || 0})`, 5);
             }
             // Nach Import Settings neu anfordern, um die Tabelle zu aktualisieren
             socket.emit('request-settings', { user: loggedInUser });
        } else { // Fallback-Meldung
             message.success(t('uploadSuccess', '{filename} erfolgreich hochgeladen.', { filename: info.file.name }));
             socket.emit('request-settings', { user: loggedInUser }); // Auch hier neu laden
        }
      } else if (info.file.status === 'error') { // Upload fehlgeschlagen
        console.error("Upload fehlgeschlagen:", info.file.response, info.file.error);
        let errorMsg = t('uploadError', '{filename} Upload fehlgeschlagen.', { filename: info.file.name });
        // Versuche, Details aus Backend-Antwort oder XHR-Status zu extrahieren
        if (info.file.response?.error) {
             errorMsg = `${errorMsg} ${t('reason', 'Grund')}: ${info.file.response.error}`;
             if(info.file.response.details) {
                 errorMsg += ` ${t('details', 'Details')}: ${info.file.response.details}`;
             }
        } else if (info.xhr?.statusText) { // Browser XHR Fehler
             errorMsg += ` Status: ${info.xhr.statusText}`;
        } else if (info.file.error?.message) { // Fehler vom Upload-Event selbst
             errorMsg += ` ${t('error', 'Fehler')}: ${info.file.error.message}`;
        }
        message.error(errorMsg, 7); // Fehlermeldung länger anzeigen
      }
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [t, loggedInUser]); // Abhängig von Übersetzung und eingeloggtem Benutzer

  // JSX für Export/Import Bereich
  const dataManagementSection = (
       <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#1f1f1f', borderRadius: '4px' }}>
           <Space wrap> {/* Wrap hinzugefügt für besseres Verhalten bei wenig Platz */}
                <Button
                    icon={<DownloadOutlined />}
                    onClick={handleExportVariables}
                    style={{ backgroundColor: '#333', borderColor: '#555', color: '#fff' }}
                    title={t('exportVariablesTooltip', 'Alle aktuell sichtbaren Variablen als CSV exportieren')} // Tooltip hinzugefügt
                 >
                    {t('Export CSV', 'CSV Exportieren')}
                </Button>
                {/* Umschließe Upload mit Tooltip */}
                {/* <Tooltip title={t('importVariablesTooltip', 'Variablen aus einer CSV-Datei importieren/aktualisieren')}> */}
                    <Upload {...uploadProps}>
                        <Button
                            icon={<UploadOutlined />}
                            loading={isUploading}
                            style={{ backgroundColor: '#333', borderColor: '#555', color: '#fff' }}
                        >
                            {isUploading ? t('Uploading...', 'Lädt hoch...') : t('Import CSV', 'CSV Importieren')}
                        </Button>
                    </Upload>
                {/* </Tooltip> */}
           </Space>
       </div>
   );

  // Funktion zur Bestimmung des aktuell ausgewählten Menü-Keys für Ant Design Menu
   const getSelectedKey = () => {
      if (!selectedMain) return [];
      // Konstruiere den Key basierend auf Haupt- und Untergruppe (oder 'nosub')
      const subKeyPart = selectedSub ? `___${selectedSub}` : '___nosub';
      // Finde den tatsächlichen Key im Menü, der diesem Schema entspricht
       const findKey = (items, targetKey) => {
          for (const item of items) {
              if (item.key === targetKey) return item.key;
              if (item.children) {
                  const found = findKey(item.children, targetKey);
                  if (found) return found;
              }
          }
          return null;
       }
      const targetKey = `${selectedMain}${subKeyPart}`;
      const actualKey = findKey(menuItems, targetKey);
      // Wenn der Key nicht exakt gefunden wird (z.B. weil es eine Hauptgruppe ohne 'nosub' ist),
      // versuchen wir, nur die Hauptgruppe zu selektieren, falls diese existiert.
      return actualKey ? [actualKey] : (menuItems.find(item => item.key === selectedMain) ? [selectedMain] : []);
   };

  // Haupt-Return der Komponente
  return (
    <Modal
        open={visible} // Sichtbarkeit des Modals
        onCancel={onClose} // Funktion zum Schließen
        footer={null} // Kein Standard-Footer
        width={xs ? "100%" : "90%"} // Breite an Bildschirmgröße anpassen
        style={{ top: 0, paddingBottom: 0, maxWidth: '100vw' }} // Style für Vollbild-Nähe
        bodyStyle={{ padding: 0, height: '100vh', overflow: 'hidden', backgroundColor: '#141414', color: '#fff', display: 'flex', flexDirection: 'column' }} // Body-Style
        maskProps={{ style: { backgroundColor: 'rgba(0,0,0,0.7)' } }} // Dunkler Hintergrund
        closable={true} // Schließen-Button (X) anzeigen
        destroyOnClose // Zustand beim Schließen zurücksetzen
    >
      {xs ? ( // Mobile Ansicht (xs = true)
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {/* Mobiler Header innerhalb des Modals */}
          <div style={{ display: 'flex', alignItems: 'center', backgroundColor: '#1f1f1f', padding: '10px', borderBottom: '1px solid #333', flexShrink: 0 }}>
            <Button type="text" onClick={() => setMenuDrawerVisible(true)} style={{ color: '#fff', fontSize: '20px', marginRight: '10px' }} aria-label={t('openMenu', 'Menü öffnen')}>☰</Button>
            <span style={{ color: '#fff', fontSize: '16px', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {/* Angezeigter Titel basierend auf Auswahl */}
              {selectedMain ? `${selectedMain}${selectedSub && selectedSub !== 'nosub' ? ` / ${selectedSub}` : ''}` : t('Settings', 'Einstellungen')}
            </span>
          </div>
          {/* CSV Bereich direkt unter dem Header */}
          <div style={{ padding: '10px', flexShrink: 0, backgroundColor: '#141414' }}>
                {dataManagementSection}
          </div>
          {/* Tabellenbereich */}
          <div style={{ flex: 1, padding: '0 10px 10px 10px', overflowY: 'auto', backgroundColor: '#141414' }}>
            <Table
              dataSource={filteredData} // Gefilterte Daten für die Tabelle
              columns={columns} // Spaltendefinitionen
              pagination={false} // Keine Seitenumbruch
              rowKey={(record) => record.NAME} // Eindeutiger Schlüssel pro Zeile
              onRow={(record) => ({ onClick: () => handleRowClick(record) })} // Klick-Handler für Zeile
              style={{ backgroundColor: '#141414', color: '#fff' }}
              size="small" // Kleinere Darstellung für Mobile
              scroll={{ x: 'max-content' }} // Horizontal scrollen bei Bedarf
            />
          </div>
          {/* Menü-Drawer */}
          <Drawer
            title={t('Menu', 'Menü')}
            placement="left"
            onClose={() => setMenuDrawerVisible(false)}
            open={menuDrawerVisible}
            bodyStyle={{ padding: 0, backgroundColor: '#1f1f1f' }}
            headerStyle={{ backgroundColor: '#1f1f1f', color: '#fff', borderBottom: '1px solid #333' }}
            width="250px" // Breite des Drawers
          >
            <Menu
              mode="inline" // Vertikales Menü
              selectedKeys={getSelectedKey()} // Aktuell ausgewählter Key hervorheben
              onClick={onMenuClick} // Handler für Klick auf Menüeintrag
              items={menuItems} // Menüstruktur
              style={{ backgroundColor: '#1f1f1f', color: '#fff', borderRight: 0 }}
            />
          </Drawer>
        </div>
      ) : ( // Desktop Ansicht (xs = false)
        <div style={{ display: 'flex', flexDirection: 'row', height: '100%' }}>
          {/* Linke Spalte: Menü */}
          <div style={{ width: '250px', borderRight: '1px solid #333', display: 'flex', flexDirection: 'column', backgroundColor: '#1f1f1f', flexShrink: 0 }}>
             <div style={{ padding: '16px', borderBottom: '1px solid #333', color: '#fff', fontSize: '16px', fontWeight: 'bold', flexShrink: 0 }}>
                 {t('Menu', 'Menü')}
             </div>
             <div style={{ flex: 1, overflowY: 'auto' }}> {/* Scrollbarer Menübereich */}
                 <Menu
                   mode="inline"
                   selectedKeys={getSelectedKey()}
                   defaultOpenKeys={selectedMain ? [selectedMain] : []} // Hauptgruppe standardmäßig öffnen
                   onClick={onMenuClick}
                   items={menuItems}
                   style={{ backgroundColor: '#1f1f1f', color: '#fff', borderRight: 0 }}
                   inlineIndent={16} // Einrückung für Untermenüs anpassen
                 />
             </div>
          </div>
          {/* Rechte Spalte: Inhalt (CSV + Tabelle) */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: '#141414' }}>
             {/* Bereich für CSV Export/Import */}
             <div style={{ padding: '15px 15px 0 15px', flexShrink: 0 }}>
                 {dataManagementSection}
             </div>
             {/* Bereich für Tabelle */}
             <div style={{ flex: 1, padding: '0 15px 15px 15px', overflowY: 'auto' }}> {/* Scrollbarer Tabellenbereich */}
                 <Table
                   dataSource={filteredData}
                   columns={columns}
                   pagination={false}
                   rowKey={(record) => record.NAME}
                   onRow={(record) => ({ onClick: () => handleRowClick(record) })}
                   style={{ backgroundColor: '#141414', color: '#fff' }}
                   size="middle" // Standardgröße für Desktop
                   scroll={{ x: 'max-content' }} // Horizontal scrollen bei Bedarf
                 />
             </div>
          </div>
        </div>
      )}
      {/* Edit Modal (wird nur gerendert, wenn sichtbar und Daten vorhanden) */}
      {editModalVisible && editRecords.length > 0 && (
        <EditVariableModal
          visible={editModalVisible}
          records={editRecords} // Übergibt die zu bearbeitenden Datensätze
          onCancel={() => setEditModalVisible(false)} // Schließt das Modal ohne Speichern
          onUpdateSuccess={handleUpdateSuccess} // Wird nach erfolgreichem Speichern aufgerufen
        />
      )}
    </Modal>
  );
};

export default SettingsPage;