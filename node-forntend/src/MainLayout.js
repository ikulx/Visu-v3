// src/MainLayout.js
import React from 'react';
import { Layout } from 'antd';
import HeaderComponent from './HeaderComponent';
import FooterComponent from './FooterComponent';

const { Header, Content, Footer } = Layout;

const MainLayout = ({ menuItems, children }) => {
  return (
    <Layout style={{ minHeight: '100vh', overflow: 'hidden' }}>
      <Header style={{ padding: 0, height: '64px' }}>
        <HeaderComponent menuItems={menuItems} />
      </Header>
      <Content style={{ height: 'calc(100vh - 64px - 48px)', overflow: 'hidden', background: '#000' }}>
        {children}
      </Content>
      <Footer style={{ textAlign: 'center', height: '48px', lineHeight: '48px', background: '#001529', color: '#fff' }}>
        <FooterComponent />
      </Footer>
    </Layout>
  );
};

export default MainLayout;
