// src/MainLayout.js
import React from 'react';
import { Layout } from 'antd';
import HeaderComponent from './HeaderComponent';
import FooterComponent from './FooterComponent';
import { theme, DIMENSIONS } from './theme';

const { Header, Content, Footer } = Layout;

const MainLayout = ({ menuItems, children }) => {
  return (
    <Layout style={{ height: '100vh', overflow: 'hidden', backgroundColor: theme.contentStyle.backgroundColor }}>
      <Header style={{ padding: 0, height: DIMENSIONS.headerHeight, background: theme.headerStyle.backgroundColor }}>
        <HeaderComponent menuItems={menuItems} />
      </Header>
      <Content
        style={{
          background: theme.contentStyle.backgroundColor,
          padding: 0,
          margin: 0,
          overflow: 'hidden',
          height: `calc(100vh - ${DIMENSIONS.headerHeight} - ${DIMENSIONS.footerHeight})`,
        }}
      >
        {children}
      </Content>
      <Footer
        style={{
          textAlign: 'center',
          height: DIMENSIONS.footerHeight,
          lineHeight: DIMENSIONS.footerHeight,
          background: theme.footerStyle.backgroundColor,
          color: theme.footerStyle.color,
        }}
      >
        <FooterComponent />
      </Footer>
    </Layout>
  );
};

export default MainLayout;
