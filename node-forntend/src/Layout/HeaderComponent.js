import React, { useState } from 'react';
import { Menu, Grid, Drawer, Button, Modal, Radio } from 'antd';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  HomeOutlined,
  MenuOutlined,
  UserOutlined,
  SettingOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import './HeaderComponent.css';
import PinLogin from './PinLogin';
import SettingsPage from '../SettingsPage';
import pinMapping from '../pinMapping.json'; // Import der PIN-Zuordnung

const { useBreakpoint } = Grid;

const HeaderComponent = ({ menuItems }) => {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const screens = useBreakpoint();
  const navigate = useNavigate();

  // Zustände für Drawer, Sprachmodal, Pin-Modal, Settings-Popup und Benutzerstatus
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [languageModalVisible, setLanguageModalVisible] = useState(false);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [settingsPopupVisible, setSettingsPopupVisible] = useState(false);
  const [loggedInUser, setLoggedInUser] = useState(null);

  // Verwende die externe PIN-Zuordnung
  const validUsers = pinMapping;

  // Funktion zum Erstellen von Menüeinträgen (inkl. Untermenüs)
  const createMenuItem = (item) => {
    if (item.sub && Array.isArray(item.sub)) {
      const enabledChildren = item.sub.filter(
        (child) => !child.hasOwnProperty('enable') || child.enable === "true"
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
            <Link to={item.link} className="header-menu-item">
              {t(item.label)}
            </Link>
          ) : (
            <span className="header-menu-item">{t(item.label)}</span>
          ),
          children: enabledChildren.map(createMenuItem).filter((child) => child !== null),
        };
      }
    } else {
      return item.link
        ? {
            key: item.link,
            label: (
              <Link to={item.link} className="header-menu-item">
                {t(item.label)}
              </Link>
            ),
          }
        : {
            key: item.label,
            label: <span className="header-menu-item">{t(item.label)}</span>,
            disabled: true,
          };
    }
  };

  const filteredItems = menuItems.filter((item) => item.link !== '/');
  const menuItemsForMenu = filteredItems.map(createMenuItem).filter((item) => item !== null);
  const isHomeActive = location.pathname === '/';
  const activeColor = "#ffb000";

  // Home-Button
  const homeButton = (
    <Button
      className="header-home-button"
      type="default"
      ghost
      icon={
        <HomeOutlined
          className="header-home-icon"
          style={{
            fontSize: '32px',
            color: isHomeActive ? activeColor : '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        />
      }
      onClick={() => navigate('/')}
    />
  );

  // Sprachwahl-Popup inkl. Login, Settings und Logout
  const languageModal = (
    <Modal
      title="Sprache ändern"
      open={languageModalVisible}
      onCancel={() => setLanguageModalVisible(false)}
      footer={null}
      centered
      maskProps={{ style: { backgroundColor: 'rgba(0,0,0,0.7)' } }}
    >
      <Radio.Group onChange={(e) => i18n.changeLanguage(e.target.value)} defaultValue={i18n.language}>
        <Radio value="de">Deutsch</Radio>
        <Radio value="en">English</Radio>
        <Radio value="fr">Français</Radio>
        <Radio value="it">Italiano</Radio>
      </Radio.Group>
      <div style={{ marginTop: '20px', textAlign: 'center' }}>
        {!loggedInUser ? (
          <Button
            type="primary"
            onClick={() => {
              setLanguageModalVisible(false);
              setPinModalVisible(true);
            }}
          >
            {t('Login')}
          </Button>
        ) : (
          <div style={{ marginTop: '20px' }}>
            <Button
              type="default"
              onClick={() => {
                setLanguageModalVisible(false);
                setSettingsPopupVisible(true);
              }}
              style={{ marginRight: '10px' }}
            >
              <SettingOutlined /> {t('Settings')}
            </Button>
            <Button type="default" onClick={() => setLoggedInUser(null)}>
              <LogoutOutlined /> {t('Logout')}
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
          className="header-menu"
        />
        <Button
          className="header-user-button"
          type="default"
          ghost
          icon={
            <UserOutlined
              style={{
                fontSize: '32px',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            />
          }
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
          icon={
            <MenuOutlined
              style={{
                fontSize: '32px',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            />
          }
          onClick={() => setDrawerVisible(true)}
        />
        <Button
          className="header-user-button"
          type="default"
          ghost
          icon={
            <UserOutlined
              style={{
                fontSize: '32px',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            />
          }
          onClick={() => setLanguageModalVisible(true)}
        />
        <Drawer
          title={null}
          placement="left"
          onClose={() => setDrawerVisible(false)}
          open={drawerVisible}
          styles={{ header: { borderBottom: 'none' } }}
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
      </div>
    );
  }
};

export default HeaderComponent;
