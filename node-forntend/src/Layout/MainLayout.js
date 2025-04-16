// src/MainLayout.js
import React from 'react';
import { Layout } from 'antd';
import HeaderComponent from './HeaderComponent';
import FooterComponent from './FooterComponent';

const { Header, Content, Footer } = Layout;

// Empfängt jetzt onAlarmButtonClick und mqttNotificationsEnabled
const MainLayout = ({ menuItems, children, loggablePages, onAlarmButtonClick, mqttNotificationsEnabled }) => {
  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      {/* Header bleibt unverändert */}
      <Header style={{ padding: 0, height: '64px' }}>
        <HeaderComponent menuItems={menuItems} />
      </Header>
      {/* Content bleibt unverändert */}
      <Content style={{ padding: 0, overflow: 'hidden', flex: 1 }}>
        {children}
      </Content>
      {/* Footer empfängt jetzt die neuen Props */}
      <Footer style={{ padding: 0, height: '64px' }}>
        <FooterComponent
            loggablePages={loggablePages}
            onAlarmButtonClick={onAlarmButtonClick} // Weitergeben an Footer
            mqttNotificationsEnabled={mqttNotificationsEnabled} // Weitergeben an Footer
        />
      </Footer>
    </Layout>
  );
};

export default MainLayout;