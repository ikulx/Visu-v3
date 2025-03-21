// src/FooterComponent.js
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
import './FooterComponent.css';

const { Text } = Typography;

const FooterComponent = () => {
  const [footerData, setFooterData] = useState({ temperature: '–', alarmButton: 0 });
  const [currentTime, setCurrentTime] = useState(new Date());
  const location = useLocation();

  useEffect(() => {
    const socket = io(`http://${window.location.hostname}:3001`);
    socket.on('footer-update', data => {
      //console.log('Footer update received:', data);
      setFooterData(data);
    });
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => {
      socket.disconnect();
      clearInterval(timer);
    };
  }, []);

  const formattedTime = currentTime.toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const formattedDate = currentTime.toLocaleDateString('de-DE');

  const handleLogoClick = () => {
    window.location.reload();
  };

  const handleCheckClick = () => {
    alert('Alarm-Button wurde geklickt!');
  };

  const handleChartClick = () => {
    alert('LineChartOutlined Button wurde geklickt!');
  };

  // Umwandlung in Zahl, falls notwendig
  const alarmVal = Number(footerData.alarmButton);

  // Dynamische Icon-Auswahl für den ersten Button
  const getDynamicIcon = () => {
    if (alarmVal === 1 || alarmVal === 11) {
      return <CheckCircleOutlined style={{ fontSize: '32px', color: '#52c41a' }} />;
    } else if (alarmVal === 2 || alarmVal === 12) {
      return <ExclamationCircleOutlined style={{ fontSize: '32px', color: '#faad14' }} />;
    } else if (alarmVal === 3 || alarmVal === 13) {
      return (
        <WarningOutlined 
          className="pulsating-icon" 
          style={{ fontSize: '32px', color: '#f5222d' }} 
        />
      );
    } else {
      return <CheckCircleOutlined style={{ fontSize: '32px', color: '#fff' }} />;
    }
  };

  // Gemeinsamer Button-Stil für beide Buttons
  const buttonStyle = {
    width: '64px',
    height: '64px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: '8px',
    border: 'none',
    boxShadow: 'none',
  };

  // Nur für den ersten Button: Wenn alarmVal > 10, setze den Border auf blau.
  const firstButtonStyle = {
    ...buttonStyle,
    border: alarmVal > 10 ? '2px solid blue' : 'none',
  };

  return (
    <Row style={{ height: '100%' }} align="middle" justify="space-between">
      {/* Linke Spalte: Zwei Buttons */}
      <Col span={8}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Button type="default" ghost style={firstButtonStyle} onClick={handleCheckClick}>
            {getDynamicIcon()}
          </Button>
          <Button type="default" ghost style={buttonStyle} onClick={handleChartClick}>
            <LineChartOutlined style={{ fontSize: '32px', color: '#fff' }} />
          </Button>
        </div>
      </Col>

      {/* Mittlere Spalte: Logo (nur wenn nicht auf "/" ) */}
      {location.pathname !== '/' ? (
        <Col span={8} style={{ textAlign: 'center' }}>
          <img
            src="/assets/ygnis_white.svg"
            alt="Logo"
            style={{ cursor: 'pointer', maxHeight: '64px' }}
            onClick={handleLogoClick}
          />
        </Col>
      ) : (
        <Col span={8} />
      )}

      {/* Rechte Spalte: Temperatur, Uhrzeit & Datum */}
      <Col span={8} style={{ textAlign: 'right', paddingRight: 16 }}>
        <div style={{ fontSize: 20, lineHeight: 1.2, color: '#fff' }}>
          <Text style={{fontSize: 18, display: 'block', margin: 0, padding: 0 }}>
            {footerData.temperature}°C | {formattedTime}
          </Text>
          <Text style={{fontSize: 18, display: 'block', margin: 0, padding: 0 }}>
            {formattedDate}
          </Text>
        </div>
      </Col>
    </Row>
  );
};

export default FooterComponent;
