// src/Layout/FooterComponent.js
import React, { useEffect, useState } from 'react';
import { Row, Col, Typography, Button } from 'antd';
import { useLocation } from 'react-router-dom';
import io from 'socket.io-client';
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  WarningOutlined,
  LineChartOutlined
} from '@ant-design/icons';
import ChartPopup from '../ChartPopup';
// +++ NEU: AlarmPopup importieren +++
import AlarmsPopup from './AlarmsPopup'; // Pfad anpassen, falls nötig
import './FooterComponent.css';

const { Text } = Typography;

const FooterComponent = ({ loggablePages = [] }) => {
  const [footerData, setFooterData] = useState({ temperature: '–', alarmButton: 0 });
  const [currentTime, setCurrentTime] = useState(new Date());
  const [chartVisible, setChartVisible] = useState(false);
  // +++ NEU: State für Alarm-Popup +++
  const [alarmsPopupVisible, setAlarmsPopupVisible] = useState(false);
  const location = useLocation();

  const currentPage = (location.pathname.startsWith('/')
    ? location.pathname.substring(1)
    : location.pathname
  ).toLowerCase();

  useEffect(() => {
    const socket = io(`http://${window.location.hostname}:3001`);
    // Höre auf allgemeine Footer-Updates
    const handleFooterUpdate = (data) => {
        // Nur aktualisieren, wenn sich Daten geändert haben
        setFooterData(prevData => ({ ...prevData, ...data }));
    }
    socket.on('footer-update', handleFooterUpdate);

    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    // Cleanup beim Unmounten
    return () => {
      socket.off('footer-update', handleFooterUpdate);
      socket.disconnect();
      clearInterval(timer);
    };
  }, []); // Läuft nur einmal

  const formattedTime = currentTime.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', hour12: false });
  const formattedDate = currentTime.toLocaleDateString('de-DE');

  const handleLogoClick = () => window.location.reload();

  // +++ GEÄNDERT: Öffnet jetzt das Alarm-Popup +++
  const handleAlarmButtonClick = () => {
    setAlarmsPopupVisible(true);
  };

  const handleChartClick = () => setChartVisible(true);

  // Alarmwert sicher auslesen
  const alarmVal = Number(footerData?.alarmButton || 0);

  // Funktion zur Bestimmung des Alarm-Icons
  const getDynamicIcon = () => {
    // Zustand 11, 12, 13 könnten quittierte Alarme sein? (Beispiel)
    if (alarmVal === 1 || alarmVal === 11) return <CheckCircleOutlined style={{ fontSize: '32px', color: '#52c41a' }} />; // Grün
    if (alarmVal === 2 || alarmVal === 12) return <ExclamationCircleOutlined style={{ fontSize: '32px', color: '#faad14' }} />; // Gelb
    if (alarmVal === 3 || alarmVal === 13) return <WarningOutlined className="pulsating-icon" style={{ fontSize: '32px', color: '#f5222d' }} />; // Rot pulsierend
    return <CheckCircleOutlined style={{ fontSize: '32px', color: '#fff' }} />; // Default weiß/grau oder grün? Nehmen wir weiß.
  };

  const buttonStyle = { width: '64px', height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: '8px', border: 'none', boxShadow: 'none', padding: 0, backgroundColor: 'transparent' };
  const firstButtonStyle = { ...buttonStyle, border: alarmVal > 10 ? '2px solid blue' : 'none' }; // Beispiel für Quittierungsanzeige

  // Prüfen, ob der Log-Button angezeigt werden soll
  const showLogButton = Array.isArray(loggablePages) && loggablePages.includes(currentPage);

  return (
    // Fragment, damit Popups außerhalb der Row gerendert werden können
    <>
        <Row style={{ height: '100%', backgroundColor: '#383838' }} align="middle" justify="space-between">
          {/* Linke Spalte: Buttons */}
          <Col span={8} xs={10}> {/* Mehr Platz auf Mobile */}
            <div style={{ display: 'flex', alignItems: 'center', paddingLeft: 8 }}>
              {/* Alarm Button */}
              <Button type="default" ghost style={firstButtonStyle} onClick={handleAlarmButtonClick} aria-label="Alarme anzeigen">
                {getDynamicIcon()}
              </Button>

              {/* Log Button (bedingt) */}
              {showLogButton && (
                <Button type="default" ghost style={buttonStyle} onClick={handleChartClick} aria-label="Logs anzeigen">
                  <LineChartOutlined style={{ fontSize: '32px', color: '#fff' }} />
                </Button>
              )}
            </div>
          </Col>

           {/* Mitte: Logo */}
          <Col span={8} xs={4} style={{ textAlign: 'center' }}>
             {location.pathname !== '/' && (
                 <img src="/assets/ygnis_white.svg" alt="Logo" style={{ cursor: 'pointer', maxHeight: '56px', verticalAlign: 'middle' }} onClick={handleLogoClick} />
             )}
           </Col>

          {/* Rechte Spalte: Infos */}
          <Col span={8} xs={10} style={{ textAlign: 'right', paddingRight: 16 }}>
             <div style={{ fontSize: 18, lineHeight: 1.2, color: '#fff' }}>
               <Text style={{ fontSize: 18, display: 'block', margin: 0, padding: 0, color: '#fff' }}> {footerData.temperature}°C | {formattedTime} </Text>
               <Text style={{ fontSize: 18, display: 'block', margin: 0, padding: 0, color: '#fff' }}> {formattedDate} </Text>
             </div>
           </Col>
        </Row>

        {/* Chart Popup */}
        <ChartPopup visible={chartVisible} onClose={() => setChartVisible(false)} currentPage={currentPage}/>

        {/* Alarm Popup */}
        <AlarmsPopup visible={alarmsPopupVisible} onClose={() => setAlarmsPopupVisible(false)} />
    </>
  );
};

export default FooterComponent;