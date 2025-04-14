// src/Layout/FooterComponent.js
import React, { useEffect, useState } from 'react';
import { Row, Col, Typography, Button } from 'antd';
import { useLocation } from 'react-router-dom';
import io from 'socket.io-client'; // Wird nur noch für Footer-Daten benötigt
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  WarningOutlined,
  LineChartOutlined
} from '@ant-design/icons';
import ChartPopup from '../ChartPopup';
import './FooterComponent.css';

const { Text } = Typography;

// +++ NEU: loggablePages als Prop empfangen +++
const FooterComponent = ({ loggablePages = [] }) => { // Standardwert ist leeres Array
  const [footerData, setFooterData] = useState({ temperature: '–', alarmButton: 0 });
  const [currentTime, setCurrentTime] = useState(new Date());
  const [chartVisible, setChartVisible] = useState(false);
  const location = useLocation(); // Hook für den aktuellen Pfad

  // Aktuelle Seite bestimmen (ohne führenden Schrägstrich, Kleinbuchstaben)
  const currentPage = (location.pathname.startsWith('/')
    ? location.pathname.substring(1) // Entferne führenden '/'
    : location.pathname
  ).toLowerCase(); // Umwandlung in Kleinbuchstaben für konsistenten Vergleich

  // Effekt für Footer-Daten (Temperatur, Alarm) und Uhrzeit
  useEffect(() => {
    // Socket-Verbindung nur noch für 'footer-update'
    const socket = io(`http://${window.location.hostname}:3001`);
    socket.on('footer-update', data => {
      setFooterData(prevData => ({ ...prevData, ...data })); // Update Footer Daten
    });

    // Timer für die Uhrzeit
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000); // Jede Sekunde aktualisieren

    // Cleanup-Funktion: Socket trennen und Timer löschen
    return () => {
      socket.disconnect();
      clearInterval(timer);
    };
  }, []); // Dieser Effekt läuft nur einmal beim Mounten

  // Zeit und Datum formatieren
  const formattedTime = currentTime.toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const formattedDate = currentTime.toLocaleDateString('de-DE');

  // Handler für Klick auf Logo -> Seite neu laden
  const handleLogoClick = () => {
    window.location.reload();
  };

  // Handler für Klick auf Alarm-Button (Beispiel)
  const handleCheckClick = () => {
    // Hier könnte Logik stehen, um z.B. Alarme zu quittieren
    console.log('Alarm-Button geklickt!');
    // alert('Alarm-Button wurde geklickt!'); // Beispiel-Alert
  };

  // Handler für Klick auf Chart-Button -> Popup öffnen
  const handleChartClick = () => {
    setChartVisible(true);
  };

  // Alarmwert aus den Footer-Daten extrahieren
  const alarmVal = Number(footerData.alarmButton);

  // Funktion zur Bestimmung des dynamischen Alarm-Icons
  const getDynamicIcon = () => {
    if (alarmVal === 1 || alarmVal === 11) { // OK / Quittiert
      return <CheckCircleOutlined style={{ fontSize: '32px', color: '#52c41a' }} />;
    } else if (alarmVal === 2 || alarmVal === 12) { // Warnung / Quittiert
      return <ExclamationCircleOutlined style={{ fontSize: '32px', color: '#faad14' }} />;
    } else if (alarmVal === 3 || alarmVal === 13) { // Alarm / Quittiert
      return <WarningOutlined className="pulsating-icon" style={{ fontSize: '32px', color: '#f5222d' }} />;
    } else { // Default / Kein Alarm
      return <CheckCircleOutlined style={{ fontSize: '32px', color: '#fff' }} />;
    }
  };

  // Basis-Styling für die Footer-Buttons
  const buttonStyle = {
    width: '64px',
    height: '64px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: '8px', // Abstand zwischen Buttons
    border: 'none',
    boxShadow: 'none',
    padding: 0, // Kein Innenabstand
    backgroundColor: 'transparent', // Transparenter Hintergrund
  };

  // Spezielles Styling für den ersten Button (Alarm), ggf. mit Rahmen
  const firstButtonStyle = {
    ...buttonStyle,
    border: alarmVal > 10 ? '2px solid blue' : 'none', // Blauer Rahmen bei quittiertem Zustand > 10?
  };

  // +++ NEU: Prüfen, ob der Log-Button angezeigt werden soll +++
  // Stelle sicher, dass loggablePages ein Array ist und vergleiche mit currentPage
  const showLogButton = Array.isArray(loggablePages) && loggablePages.includes(currentPage);
  // console.log(`[Footer] CurrentPage: ${currentPage}, LoggablePages:`, loggablePages, `ShowButton: ${showLogButton}`); // Debugging Log

  return (
    <Row style={{ height: '100%', backgroundColor: '#383838' }} align="middle" justify="space-between">
      {/* Linke Seite: Buttons */}
      <Col span={8}>
        <div style={{ display: 'flex', alignItems: 'center', paddingLeft: 8 }}>
          {/* Alarm Button */}
          <Button type="default" ghost style={firstButtonStyle} onClick={handleCheckClick} aria-label="Alarm Status">
            {getDynamicIcon()}
          </Button>

          {/* +++ NEU: Bedingte Anzeige des Log-Buttons +++ */}
          {showLogButton && (
            <Button type="default" ghost style={buttonStyle} onClick={handleChartClick} aria-label="Show Logs">
              <LineChartOutlined style={{ fontSize: '32px', color: '#fff' }} />
            </Button>
          )}
          {/* Hier könnten weitere Buttons hin */}
        </div>
      </Col>

      {/* Mitte: Logo (nur wenn nicht auf Homepage) */}
      <Col span={8} style={{ textAlign: 'center' }}>
         {location.pathname !== '/' && ( // Logo nur anzeigen, wenn NICHT auf der Homepage
             <img
                 src="/assets/ygnis_white.svg"
                 alt="Logo"
                 style={{ cursor: 'pointer', maxHeight: '56px', verticalAlign: 'middle' }} // Höhe leicht reduziert
                 onClick={handleLogoClick}
               />
         )}
      </Col>

      {/* Rechte Seite: Temperatur, Uhrzeit, Datum */}
      <Col span={8} style={{ textAlign: 'right', paddingRight: 16 }}>
        <div style={{ fontSize: 18, lineHeight: 1.2, color: '#fff' }}>
          <Text style={{ fontSize: 18, display: 'block', margin: 0, padding: 0, color: '#fff' }}>
            {footerData.temperature}°C | {formattedTime}
          </Text>
          <Text style={{ fontSize: 18, display: 'block', margin: 0, padding: 0, color: '#fff' }}>
            {formattedDate}
          </Text>
        </div>
      </Col>

      {/* Chart Popup (bleibt unverändert, wird nur bei Bedarf angezeigt) */}
      <ChartPopup
        visible={chartVisible}
        onClose={() => setChartVisible(false)}
        currentPage={currentPage} // currentPage wird für die Datenabfrage im Popup benötigt
      />
    </Row>
  );
};

export default FooterComponent;