// src/HomePage.js
import React from 'react';
import { Layout, Image, Typography } from 'antd';
const { Content } = Layout;
const { Title } = Typography;

const HomePage = ({ text }) => {
  return (
    <Content
      style={{
        background: '#1f1f1f',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        textAlign: 'center'
      }}
    >
      <Image
        src='/assets/home-image.png'
        alt='Homepage Bild'
        preview={false}
        style={{ maxHeight: '50vh', marginBottom: '20px' }}
      />
      <Title level={2} style={{ color: '#fff' }}>
        {text || 'Kein Text verfügbar'}
      </Title>
    </Content>
  );
};

export default HomePage;
