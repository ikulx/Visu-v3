// src/MainLayout.js
import React from 'react';
import { Layout } from 'antd';
import HeaderComponent from './HeaderComponent';
import FooterComponent from './FooterComponent';

const { Header, Content, Footer } = Layout;

const MainLayout = ({ menuItems, children }) => {
  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      <Header style={{ padding: 0 }}>
        <HeaderComponent menuItems={menuItems} />
      </Header>
      <Content style={{ padding: 0, overflow: 'hidden', flex: 1 }}>
        {children}
      </Content>
      <Footer style={{ textAlign: 'center' }}>
        <FooterComponent />
      </Footer>
    </Layout>
  );
};

export default MainLayout;
