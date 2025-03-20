// src/HeaderComponent.js
import React, { useState } from 'react';
import { Menu, Grid, Drawer, Button, Modal, Radio } from 'antd';
import { Link, useLocation, useNavigate } from 'react-router-dom'; // Importiere useNavigate
import { HomeOutlined, MenuOutlined, UserOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import './HeaderComponent.css';

const { useBreakpoint } = Grid;

const HeaderComponent = ({ menuItems }) => {
  const { i18n, t } = useTranslation();
  const location = useLocation();
  const screens = useBreakpoint();
  const navigate = useNavigate();
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [languageModalVisible, setLanguageModalVisible] = useState(false);

  // Hilfsfunktion: Erzeuge ein Menü-Item inkl. Untermenüpunkte
  const createMenuItem = (item) => {
    // Falls ein Untermenü vorhanden ist, filtern wir die enableten Einträge
    if (item.sub && Array.isArray(item.sub)) {
      const enabledChildren = item.sub.filter(child =>
        !child.hasOwnProperty('enable') || child.enable === "true"
      );
      if (enabledChildren.length === 0) {
        return {
          key: item.label, // Verwende Label als Key
          label: <span className="header-menu-item">{t(item.label)}</span>,
          disabled: true,
        };
      } else if (enabledChildren.length === 1) {
        return createMenuItem(enabledChildren[0]);
      } else {
        return {
          key: item.link || item.label,
          label: item.link ? (
            <Link to={item.link} className="header-menu-item">{t(item.label)}</Link>
          ) : (
            <span className="header-menu-item">{t(item.label)}</span>
          ),
          children: enabledChildren.map(createMenuItem).filter(child => child !== null),
        };
      }
    } else {
      // Kein Submenü → Einfaches Item, Übersetzung des Labels
      return item.link
        ? { key: item.link, label: <Link to={item.link} className="header-menu-item">{t(item.label)}</Link> }
        : { key: item.label, label: <span className="header-menu-item">{t(item.label)}</span>, disabled: true };
    }
  };

  // Filtere den Home-Link aus den Menüpunkten, da das Home-Symbol separat dargestellt wird.
  const filteredItems = menuItems.filter(item => item.link !== '/');
  const menuItemsForMenu = filteredItems.map(createMenuItem).filter(item => item !== null);

  // Prüfe, ob wir uns auf der Home-Seite befinden.
  const isHomeActive = location.pathname === '/';
  const activeColor = "#ffb000";

  // Home-Symbol als Button; erhält aktive Farbe, wenn Home aktiv ist.
  const homeButton = (
    <Button
      className="header-home-button"
      type="default"
      ghost
      icon={
        <HomeOutlined
          className="header-home-icon"
          style={{ fontSize: '32px', color: isHomeActive ? activeColor : '#fff' }}
        />
      }
      onClick={() => navigate('/')}
    />
  );

  // Hamburger-Menü-Button (für mobile Ansicht)
  const menuButton = (
    <Button
      className="header-menu-button"
      type="default"
      ghost
      icon={<MenuOutlined className="header-menu-icon" style={{ fontSize: '32px', color: '#fff' }} />}
      onClick={() => setDrawerVisible(true)}
    />
  );

  // User-Button: Öffnet ein Modal zur Sprachwahl
  const userButton = (
    <Button
      className="header-user-button"
      type="default"
      ghost
      icon={<UserOutlined className="header-user-icon" style={{ fontSize: '32px', color: '#fff' }} />}
      onClick={() => setLanguageModalVisible(true)}
    />
  );

  // Language Switcher Modal
  const handleLanguageChange = e => {
    i18n.changeLanguage(e.target.value);
  };

  const languageModal = (
    <Modal
      title="Sprache ändern"
      open={languageModalVisible}
      onCancel={() => setLanguageModalVisible(false)}
      footer={null}
      centered
      styles={{ mask: { backgroundColor: 'rgba(0,0,0,0.7)' } }}
    >
      <Radio.Group onChange={handleLanguageChange} defaultValue={i18n.language}>
        <Radio value="de">Deutsch</Radio>
        <Radio value="en">English</Radio>
        <Radio value="fr">Français</Radio>
        <Radio value="it">Italiano</Radio>
      </Radio.Group>
    </Modal>
  );

  if (screens.md) {
    // Desktop-Ansicht: Home links, horizontales Menü in der Mitte, User-Button rechts
    return (
      <div className="header-container">
        {homeButton}
        <Menu
          mode="horizontal"
          selectedKeys={[location.pathname]}
          items={menuItemsForMenu}
          className="header-menu"
          style={{ flex: 1, background: 'transparent', borderBottom: 'none' }}
        />
        {userButton}
        {languageModal}
      </div>
    );
  } else {
    // Mobile-Ansicht: Home links, Hamburger-Button in der Mitte, User-Button rechts
    return (
      <div className="header-container mobile">
        {homeButton}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <Button
            type="default"
            ghost
            icon={<MenuOutlined className="header-menu-icon" style={{ fontSize: '32px', color: '#fff' }} />}
            onClick={() => setDrawerVisible(true)}
          />
        </div>
        {userButton}
        <Drawer
          title={null}
          placement="left"
          onClose={() => setDrawerVisible(false)}
          open={drawerVisible}
          headerStyle={{ borderBottom: 'none' }}
          bodyStyle={{ padding: 0 }}
        >
          <Menu
            mode="vertical"
            selectedKeys={[location.pathname]}
            items={menuItemsForMenu}
            onClick={() => setDrawerVisible(false)}
            className="header-menu-mobile"
          />
        </Drawer>
        {languageModal}
      </div>
    );
  }
};

export default HeaderComponent;
