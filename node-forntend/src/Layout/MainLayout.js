// src/MainLayout.js
import React from 'react';
import { Layout } from 'antd';
import HeaderComponent from './HeaderComponent';
import FooterComponent from './FooterComponent';

const { Header, Content, Footer } = Layout;

// +++ NEU: loggablePages als Prop hinzufügen +++
const MainLayout = ({ menuItems, children, loggablePages }) => {
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
      {/* Footer empfängt jetzt loggablePages */}
      <Footer style={{ padding: 0, height: '64px' }}>
        {/* +++ NEU: loggablePages an FooterComponent weitergeben +++ */}
        <FooterComponent loggablePages={loggablePages} />
      </Footer>
    </Layout>
  );
};

export default MainLayout;