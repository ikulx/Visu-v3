// Beispiel in FooterComponent.js
import React, { useEffect, useState } from 'react';
import { Row, Col, Typography } from 'antd';
import socket from './socket'; // zentrale Socket-Instanz importieren

const { Text } = Typography;

const FooterComponent = () => {
  const [footerData, setFooterData] = useState({ temperature: '–' });
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    socket.on('footer-update', data => {
      setFooterData(data);
    });
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => {
      socket.off('footer-update');
      clearInterval(timer);
    };
  }, []);

  const formattedTime = currentTime.toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const formattedDate = currentTime.toLocaleDateString('de-DE');

  return (
    <Row style={{ height: '100%' }} justify="end" align="middle">
      <Col>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            height: '100%',
            paddingRight: 16,
            color: '#fff',
            fontSize: 12,
            lineHeight: 1.2,
          }}
        >
          <Text style={{ display: 'block', margin: 0, padding: 0 }}>
            {footerData.temperature}°C {formattedTime}
          </Text>
          <Text style={{ display: 'block', margin: 0, padding: 0 }}>
            {formattedDate}
          </Text>
        </div>
      </Col>
    </Row>
  );
};

export default FooterComponent;
