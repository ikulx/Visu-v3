// src/HeaderComponent.js
import React, { useState } from 'react';
import { Menu, Grid, Drawer, Button, Modal, Radio } from 'antd';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { HomeOutlined, MenuOutlined, UserOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import './HeaderComponent.css';

const { useBreakpoint } = Grid;

const HeaderComponent = ({ menuItems }) => {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const screens = useBreakpoint();
  const navigate = useNavigate();
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [languageModalVisible, setLanguageModalVisible] = useState(false);

  // Erstelle Menü-Items (inkl. Untermenüs)
  const createMenuItem = (item) => {
    if (item.sub && Array.isArray(item.sub)) {
      const enabledChildren = item.sub.filter(child =>
        !child.hasOwnProperty('enable') || child.enable === "true"
      );
      if (enabledChildren.length === 0) {
        return {
          key: item.label,
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
      return item.link
        ? { key: item.link, label: <Link to={item.link} className="header-menu-item">{t(item.label)}</Link> }
        : { key: item.label, label: <span className="header-menu-item">{t(item.label)}</span>, disabled: true };
    }
  };

  const filteredItems = menuItems.filter(item => item.link !== '/');
  const menuItemsForMenu = filteredItems.map(createMenuItem).filter(item => item !== null);
  const isHomeActive = location.pathname === '/';
  const activeColor = "#ffb000";

  // Home-Button mit aktivem Farb-Feedback
  const homeButton = (
    <Button
      className="header-home-button"
      type="default"
      ghost
      icon={<HomeOutlined 
        className="header-home-icon" 
        style={{ 
          fontSize: '32px', 
          color: isHomeActive ? activeColor : '#fff', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center' 
        }} 
      />}
      onClick={() => navigate('/')}
    />
  );

  // User-Button zur Sprachwahl
  const userButton = (
    <Button
      className="header-user-button"
      type="default"
      ghost
      icon={<UserOutlined style={{ 
        fontSize: '32px', 
        color:  '#fff', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center' }}/>}
      onClick={() => setLanguageModalVisible(true)}
    />
  );

  // Modal für die Sprachwahl
  const languageModal = (
    <Modal
      title="Sprache ändern"
      open={languageModalVisible}
      onCancel={() => setLanguageModalVisible(false)}
      footer={null}
      centered
      maskStyle={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
    >
      <Radio.Group onChange={e => i18n.changeLanguage(e.target.value)} defaultValue={i18n.language}>
        <Radio value="de">Deutsch</Radio>
        <Radio value="en">English</Radio>
        <Radio value="fr">Français</Radio>
        <Radio value="it">Italiano</Radio>
      </Radio.Group>
    </Modal>
  );

  if (screens.md) {
    // Desktop-Ansicht: Home-Button links, horizontales Menü in der Mitte, User-Button rechts
    return (
      <div className="header-container">
        {homeButton}
        <Menu
          mode="horizontal"
          triggerSubMenuAction="click"
          selectedKeys={[location.pathname]}
          items={menuItemsForMenu}
          className="header-menu"
        />
        {userButton}
        {languageModal}
      </div>
    );
  } else {
    // Mobile-Ansicht: Home-Button, Hamburger-Menü und User-Button
    return (
      <div className="header-container mobile">
        {homeButton}
        <Button
          type="default"
          className="header-menu-button"
          ghost
          icon={<MenuOutlined style={{ 
            fontSize: '32px', 
            color:  '#fff', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center' }} />}
          onClick={() => setDrawerVisible(true)}
        />
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
            mode="inline"
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
