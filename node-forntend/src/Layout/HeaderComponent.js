// src/Layout/HeaderComponent.js
import React, { useState, useEffect } from 'react';
import { Menu, Grid, Drawer, Button, Modal, Radio } from 'antd';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  HomeOutlined,
  MenuOutlined,
  UserOutlined,
  SettingOutlined,
  LogoutOutlined,
  LoginOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import './HeaderComponent.css';
import PinLogin from './PinLogin';
import SettingsPage from '../SettingsPage';
import MenuConfigPopup from './MenuConfigPopup';
import pinMapping from '../pinMapping.json';
import { useUser } from '../UserContext';
import socket from '../socket';

const { useBreakpoint } = Grid;

const HeaderComponent = ({ menuItems: initialMenuItems = [] }) => {
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
  const [menuItems, setMenuItems] = useState(initialMenuItems);

  const validUsers = pinMapping;

  useEffect(() => {
    setMenuItems(initialMenuItems);
    socket.emit('request-menu');
    socket.on('menu-update', (data) => {
      console.log('Received menu items:', data.menuItems);
      setMenuItems(data.menuItems || []);
    });

    return () => {
      socket.off('menu-update');
    };
  }, [initialMenuItems]);

  const createMenuItem = (item, parentKey = '') => {
    if (!item || !item.label) {
      console.warn('Ungültiger Menüpunkt:', item);
      return null;
    }

    const uniqueKey = item.link || `${parentKey}-${item.label}-${Math.random().toString(36).substr(2, 5)}`;
    // Unterscheidung zwischen statischen und dynamischen Labels mit Fallback
    const displayLabel = item.labelSource === 'dynamic' && item.qhmi_variable_id
      ? item.label // Dynamisches Label direkt verwenden (kommt aus VAR_VALUE)
      : t(item.label, { defaultValue: item.label }); // Statisches Label übersetzen, Fallback auf item.label

    if (item.sub && Array.isArray(item.sub) && item.sub.length > 0) {
      const enabledChildren = item.sub.filter(
        (child) => !child.hasOwnProperty('enable') || child.enable === "true"
      );
      if (enabledChildren.length === 0) {
        return {
          key: uniqueKey,
          label: <span className="header-menu-item">{displayLabel}</span>,
        };
      } else if (enabledChildren.length === 1) {
        return createMenuItem(enabledChildren[0], uniqueKey);
      } else {
        return {
          key: uniqueKey,
          label: item.link ? (
            <Link to={item.link} className="header-menu-item">
              {displayLabel}
            </Link>
          ) : (
            <span className="header-menu-item">{displayLabel}</span>
          ),
          children: enabledChildren.map((child) => createMenuItem(child, uniqueKey)).filter((child) => child !== null),
        };
      }
    } else {
      if (!item.link) {
        // console.warn('Menüpunkt ohne link:', item);
        return {
          // key: uniqueKey,
          // label: <span className="header-menu-item">{displayLabel}</span>,
          // disabled: true,
        };
      }
      return {
        key: item.link,
        label: (
          <Link to={item.link} className="header-menu-item">
            {displayLabel}
          </Link>
        ),
      };
    }
  };

  const filteredItems = menuItems.filter((item) => item.link !== '/');
  const menuItemsForMenu = filteredItems.map((item) => createMenuItem(item)).filter((item) => item !== null);
  const isHomeActive = location.pathname === '/';
  const activeColor = "#ffb000";

  const handleMenuClick = ({ key }) => {
    const clickedItem = menuItems.find((item) => item.link === key);
    if (clickedItem && clickedItem.link) {
      console.log('Navigating to:', clickedItem.link);
      navigate(clickedItem.link);
    } else {
      // console.warn('No valid link for menu item with key:', key);
    }
    if (!screens.md) {
      setDrawerVisible(false);
    }
  };

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
      styles={{
        body: {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          minHeight: '200px',
        },
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
            {loggedInUser === 'admin' && (
              <Button
                type="default"
                onClick={() => {
                  setLanguageModalVisible(false);
                  setMenuConfigVisible(true);
                }}
                style={{ marginRight: '10px', backgroundColor: '#333', height: '50px', width: '70px', border: 'none' }}
              >
                <ToolOutlined style={{ fontSize: '30px' }} />
              </Button>
            )}
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
          className="header-menu"
          onClick={handleMenuClick}
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
        {menuConfigVisible && (
          <MenuConfigPopup
            visible={menuConfigVisible}
            onClose={() => setMenuConfigVisible(false)}
            menuItems={menuItems}
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
        {menuConfigVisible && (
          <MenuConfigPopup
            visible={menuConfigVisible}
            onClose={() => setMenuConfigVisible(false)}
            menuItems={menuItems}
          />
        )}
      </div>
    );
  }
};

export default HeaderComponent;