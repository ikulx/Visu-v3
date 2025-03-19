// src/FooterComponent.js
import React from 'react';
import { theme } from './theme';

const FooterComponent = () => {
  return (
    <div style={{ textAlign: 'center', color: theme.headerStyle.color, width: '100%' }}>
      © 2023 Meine React App
    </div>
  );
};

export default FooterComponent;
