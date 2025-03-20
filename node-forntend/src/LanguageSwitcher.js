// src/LanguageSwitcher.js
import React from 'react';
import { Button } from 'antd';
import { useTranslation } from 'react-i18next';

const LanguageSwitcher = () => {
  const { i18n } = useTranslation();

  const changeLanguage = (lng) => {
    i18n.changeLanguage(lng);
  };

  return (
    <div style={{ display: 'flex', gap: '8px' }}>
      <Button onClick={() => changeLanguage('de')}>DE</Button>
      <Button onClick={() => changeLanguage('en')}>EN</Button>
      <Button onClick={() => changeLanguage('fr')}>FR</Button>
      <Button onClick={() => changeLanguage('it')}>IT</Button>
    </div>
  );
};

export default LanguageSwitcher;
