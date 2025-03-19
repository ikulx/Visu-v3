// src/HomePage.js
import React from 'react';

const HomePage = ({ text }) => {
  return (
    <div style={{
      color: '#fff',
      fontSize: '20px',
      textAlign: 'center',
      width: '100%',
      height: '100%',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      padding: '24px'
    }}>
      {text}
    </div>
  );
};

export default HomePage;
