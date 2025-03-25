// src/HeaderComponent.js
import React, { useState } from 'react';
import { Menu, Grid, Drawer, Button, Modal, Radio } from 'antd';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  HomeOutlined,
  MenuOutlined,
  UserOutlined,
  SettingOutlined,
  LogoutOutlined,
  LoginOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import './HeaderComponent.css';
import PinLogin from './PinLogin';
import SettingsPage from '../SettingsPage';
import pinMapping from '../pinMapping.json';
import { useUser } from '../UserContext'; // Import useUser

const { useBreakpoint } = Grid;

const HeaderComponent = ({ menuItems }) => {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const screens = useBreakpoint();
  const navigate = useNavigate();

  const { loggedInUser, setLoggedInUser } = useUser(); // Use global user state

  const [drawerVisible, setDrawerVisible] = useState(false);
  const [languageModalVisible, setLanguageModalVisible] = useState(false);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [settingsPopupVisible, setSettingsPopupVisible] = useState(false);

  const validUsers = pinMapping;

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

  const languageModal = (
    <Modal
      
      open={languageModalVisible}
      onCancel={() => setLanguageModalVisible(false)}
      footer={null}
      centered
      maskProps={{ style: { backgroundColor: 'rgba(0,0,0,0.7)' } }}
      styles={{boddy:{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        minHeight: '200px', // Mindesthöhe für Zentrierun
        }}}
    >
      <Radio.Group optionType="button" size="large"  onChange={(e) => i18n.changeLanguage(e.target.value)} defaultValue={i18n.language}  >
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
            style={{ marginRight: '10px' ,backgroundColor: '#333', height: '50px', width: '70px', border: 'none' }}
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
              style={{ marginRight: '10px' ,backgroundColor: '#333', height: '50px', width: '70px', border: 'none' }}
            >
              <SettingOutlined style={{ fontSize: '30px' }}/> 
            </Button>
            <Button type="default" onClick={() => setLoggedInUser(null)} style={{ backgroundColor: '#333', height: '50px', width: '70px', border: 'none' }}>
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
            setLoggedInUser(user); // Update global state
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
            setLoggedInUser(user); // Update global state
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