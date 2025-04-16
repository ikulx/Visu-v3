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
// AlarmsPopup wird nicht mehr hier direkt gesteuert
// import AlarmsPopup from './AlarmsPopup';
import './FooterComponent.css';

const { Text } = Typography;

// Empfängt onAlarmButtonClick und mqttNotificationsEnabled von MainLayout
const FooterComponent = ({ loggablePages = [], onAlarmButtonClick, mqttNotificationsEnabled }) => {
  const [footerData, setFooterData] = useState({ temperature: '–', alarmButton: 0 });
  const [currentTime, setCurrentTime] = useState(new Date());
  const [chartVisible, setChartVisible] = useState(false);
  const location = useLocation();

  const currentPage = (location.pathname.startsWith('/')
    ? location.pathname.substring(1)
    : location.pathname
  ).toLowerCase();

  useEffect(() => {
    const socket = io(`http://${window.location.hostname}:3001`);
    const handleFooterUpdate = (data) => { setFooterData(prevData => ({ ...prevData, ...data })); }
    socket.on('footer-update', handleFooterUpdate);
    const timer = setInterval(() => { setCurrentTime(new Date()); }, 1000);
    return () => { socket.off('footer-update', handleFooterUpdate); socket.disconnect(); clearInterval(timer); };
  }, []);

  const formattedTime = currentTime.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', hour12: false });
  const formattedDate = currentTime.toLocaleDateString('de-DE');

  const handleLogoClick = () => window.location.reload();
  const handleChartClick = () => setChartVisible(true);

  // Alarmwert sicher auslesen
  const alarmVal = Number(footerData?.alarmButton || 0);

  // Funktion zur Bestimmung des Alarm-Icons
  const getDynamicIcon = () => {
    if (alarmVal === 1) return <CheckCircleOutlined style={{ fontSize: '32px', color: '#52c41a' }} />;
    if (alarmVal === 2) return <ExclamationCircleOutlined style={{ fontSize: '32px', color: '#faad14' }} />;
    if (alarmVal === 3) return <WarningOutlined className="pulsating-icon" style={{ fontSize: '32px', color: '#f5222d' }} />;
    return <CheckCircleOutlined style={{ fontSize: '32px', color: '#fff' }} />;
  };

  // Basis-Button-Style
  const buttonBaseStyle = { width: '64px', height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: '8px', border: 'none', boxShadow: 'none', padding: 0, backgroundColor: 'transparent' };

  // Style für Alarm-Button mit blauer Umrandung bei Mute
  const alarmButtonStyle = {
      ...buttonBaseStyle,
      border: !mqttNotificationsEnabled ? '3px solid #1890ff' : 'none', // Blauer Rand, wenn disabled
      borderRadius: !mqttNotificationsEnabled ? '8px' : '0' // Runde Ecken für den Rand
  };

  // Prüfen, ob der Log-Button angezeigt werden soll
  const showLogButton = Array.isArray(loggablePages) && loggablePages.includes(currentPage);

  return (
    <>
        <Row style={{ height: '100%', backgroundColor: '#383838' }} align="middle" justify="space-between">
          {/* Linke Spalte: Buttons */}
          <Col span={8} xs={10}>
            <div style={{ display: 'flex', alignItems: 'center', paddingLeft: 8 }}>
              {/* Alarm Button - Nutzt jetzt alarmButtonStyle und onAlarmButtonClick Prop */}
              <Button type="default" ghost style={alarmButtonStyle} onClick={onAlarmButtonClick} aria-label="Alarme anzeigen">
                {getDynamicIcon()}
              </Button>

              {/* Log Button (bedingt) */}
              {showLogButton && (
                <Button type="default" ghost style={buttonBaseStyle} onClick={handleChartClick} aria-label="Logs anzeigen">
                  <LineChartOutlined style={{ fontSize: '32px', color: '#fff' }} />
                </Button>
              )}
            </div>
          </Col>

           {/* Mitte: Logo */}
          <Col span={8} xs={4} style={{ textAlign: 'center' }}>
             {location.pathname !== '/' && ( <img src="/assets/ygnis_white.svg" alt="Logo" style={{ cursor: 'pointer', maxHeight: '56px', verticalAlign: 'middle' }} onClick={handleLogoClick} /> )}
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

        {/* Alarm Popup wird jetzt von App.js gerendert */}
    </>
  );
};

export default FooterComponent;