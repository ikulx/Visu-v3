// src/HeaderComponent.js
import React, { useState } from 'react';
import { Menu, Grid, Drawer, Button, Modal, Radio } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  HomeOutlined,
  MenuOutlined,
  UserOutlined,
  SettingOutlined,
  LogoutOutlined,
  LoginOutlined,
  ControlOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import './HeaderComponent.css';
import PinLogin from './PinLogin';
import SettingsPage from '../SettingsPage';
import MenuConfigModal from './MenuConfigModal';
import pinMapping from '../pinMapping.json';
import { useUser } from '../UserContext';

const { useBreakpoint } = Grid;

const HeaderComponent = ({ menuItems }) => {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const screens = useBreakpoint();
  const navigate = useNavigate();
  const { loggedInUser, setLoggedInUser } = useUser();

  const [drawerVisible, setDrawerVisible] = useState(false);
  const [languageModalVisible, setLanguageModalVisible] = useState(false);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [settingsPopupVisible, setSettingsPopupVisible] = useState(false);
  const [menuConfigVisible, setMenuConfigVisible] = useState(false);

  const validUsers = pinMapping;

  const createMenuItem = (item) => {
    // console.log('Processing menu item:', JSON.stringify(item, null, 2));
    if (item.sub && Array.isArray(item.sub) && item.sub.length > 0) { // Nur wenn sub nicht leer ist
      const enabledChildren = item.sub.filter(
        (child) => !child.hasOwnProperty('enable') || child.enable === "true" || child.enable === true
      );
      if (enabledChildren.length === 0) {
        // console.log('No enabled children for:', item.label);
        return null;
      } else if (enabledChildren.length === 1) {
        return createMenuItem(enabledChildren[0]);
      } else {
        return {
          key: item.link || item.label,
          label: t(item.label),
          children: enabledChildren.map(createMenuItem).filter((child) => child !== null),
        };
      }
    } else {
      if (!item.link) {
        console.warn('Menu item without link ignored:', item.label);
        return null;
      }
      return {
        key: item.link,
        label: t(item.label),
      };
    }
  };

  // console.log('Raw menuItems before filtering:', JSON.stringify(menuItems, null, 2));
  const filteredItems = menuItems.filter((item) => item.link !== '/');
  // console.log('Filtered items (excluding "/"):', JSON.stringify(filteredItems, null, 2));
  const menuItemsForMenu = filteredItems.map(createMenuItem).filter((item) => item !== null);
  // console.log('Generated menuItemsForMenu:', JSON.stringify(menuItemsForMenu, null, 2));

  // Fallback, falls menuItemsForMenu leer ist
  if (menuItemsForMenu.length === 0) {
    console.warn('No valid menu items generated.');
    menuItemsForMenu.push({ key: '/', label: 'Home (Fallback)' });
  }

  const isHomeActive = location.pathname === '/';
  const activeColor = "#ffb000";

  const handleMenuClick = (e) => {
    // console.log('Menu item clicked:', e.key);
    if (e.key.startsWith('/')) {
      navigate(e.key);
      setDrawerVisible(false);
    } else {
      console.warn('Invalid route clicked:', e.key);
    }
  };

  const homeButton = (
    <Button
      className="header-home-button"
      type="default"
      ghost
      icon={<HomeOutlined style={{ fontSize: '32px', color: isHomeActive ? activeColor : '#fff' }} />}
      onClick={() => navigate('/')}
    />
  );

  const languageModal = (
    <Modal
      open={languageModalVisible}
      onCancel={() => setLanguageModalVisible(false)}
      footer={null}
      centered
      maskProps={{ style: { backgroundColor: 'rgba(0,0,0,0.7)' } }}
      styles={{
        body: {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          minHeight: '200px',
        }
      }}
    >
      <Radio.Group
        optionType="button"
        size="large"
        onChange={(e) => i18n.changeLanguage(e.target.value)}
        defaultValue={i18n.language}
      >
        <Radio value="de">Deutsch</Radio>
        <Radio value="en">English</Radio>
        <Radio value="fr">Français</Radio>
        <Radio value="it">Italiano</Radio>
      </Radio.Group>
      <div style={{ marginTop: '20px', textAlign: 'center' }}>
        {!loggedInUser ? (
          <Button
            type="default"
            onClick={() => {
              setLanguageModalVisible(false);
              setPinModalVisible(true);
            }}
            style={{ marginRight: '10px', backgroundColor: '#333', height: '50px', width: '70px', border: 'none' }}
          >
            <LoginOutlined style={{ fontSize: '30px' }} />
          </Button>
        ) : (
          <div style={{ marginTop: '20px' }}>
            <Button
              type="default"
              onClick={() => {
                setLanguageModalVisible(false);
                setSettingsPopupVisible(true);
              }}
              style={{ marginRight: '10px', backgroundColor: '#333', height: '50px', width: '70px', border: 'none' }}
            >
              <SettingOutlined style={{ fontSize: '30px' }} />
            </Button>
            <Button
              type="default"
              onClick={() => {
                setLanguageModalVisible(false);
                setMenuConfigVisible(true);
              }}
              style={{ marginRight: '10px', backgroundColor: '#333', height: '50px', width: '70px', border: 'none' }}
            >
              <ControlOutlined style={{ fontSize: '30px' }} />
            </Button>
            <Button
              type="default"
              onClick={() => setLoggedInUser(null)}
              style={{ backgroundColor: '#333', height: '50px', width: '70px', border: 'none' }}
            >
              <LogoutOutlined style={{ fontSize: '30px' }} />
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );

  if (screens.md) {
    return (
      <div className="header-container">
        {homeButton}
        <Menu
          mode="horizontal"
          triggerSubMenuAction="click"
          selectedKeys={[location.pathname]}
          items={menuItemsForMenu}
          onClick={handleMenuClick}
          className="header-menu"
        />
        <Button
          className="header-user-button"
          type="default"
          ghost
          icon={<UserOutlined style={{ fontSize: '32px', color: '#fff' }} />}
          onClick={() => setLanguageModalVisible(true)}
        />
        {languageModal}
        <PinLogin
          visible={pinModalVisible}
          validUsers={validUsers}
          onSuccess={(user) => {
            setLoggedInUser(user);
            setPinModalVisible(false);
          }}
          onCancel={() => setPinModalVisible(false)}
        />
        {settingsPopupVisible && (
          <SettingsPage
            visible={settingsPopupVisible}
            onClose={() => setSettingsPopupVisible(false)}
            user={loggedInUser}
          />
        )}
        <MenuConfigModal
          visible={menuConfigVisible}
          onClose={() => setMenuConfigVisible(false)}
        />
      </div>
    );
  } else {
    return (
      <div className="header-container mobile">
        {homeButton}
        <Button
          type="default"
          className="header-menu-button"
          ghost
          icon={<MenuOutlined style={{ fontSize: '32px', color: '#fff' }} />}
          onClick={() => setDrawerVisible(true)}
        />
        <Button
          className="header-user-button"
          type="default"
          ghost
          icon={<UserOutlined style={{ fontSize: '32px', color: '#fff' }} />}
          onClick={() => setLanguageModalVisible(true)}
        />
        <Drawer
          title={null}
          placement="left"
          onClose={() => setDrawerVisible(false)}
          open={drawerVisible}
          styles={{ header: { borderBottom: 'none' }, body: {padding: 0} }}
        >
          <Menu
            mode="inline"
            selectedKeys={[location.pathname]}
            items={menuItemsForMenu}
            onClick={handleMenuClick}
            className="header-menu-mobile"
          />
        </Drawer>
        {languageModal}
        <PinLogin
          visible={pinModalVisible}
          validUsers={validUsers}
          onSuccess={(user) => {
            setLoggedInUser(user);
            setPinModalVisible(false);
          }}
          onCancel={() => setPinModalVisible(false)}
        />
        {settingsPopupVisible && (
          <SettingsPage
            visible={settingsPopupVisible}
            onClose={() => setSettingsPopupVisible(false)}
            user={loggedInUser}
          />
        )}
        <MenuConfigModal
          visible={menuConfigVisible}
          onClose={() => setMenuConfigVisible(false)}
        />
      </div>
    );
  }
};

export default HeaderComponent;