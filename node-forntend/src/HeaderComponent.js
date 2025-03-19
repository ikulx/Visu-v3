// src/HeaderComponent.js
import React, { useState } from 'react';
import { Menu, Grid, Drawer, Button } from 'antd';
import { Link, useLocation } from 'react-router-dom';
import { HomeOutlined, MenuOutlined, UserOutlined } from '@ant-design/icons';
import { theme } from './theme';

const { useBreakpoint } = Grid;

const HeaderComponent = ({ menuItems }) => {
  const location = useLocation();
  const screens = useBreakpoint();
  const [drawerVisible, setDrawerVisible] = useState(false);

  // Filtere den Home-Eintrag heraus (Home wird über das Symbol dargestellt)
  const filteredItems = menuItems.filter(item => item.link !== '/');
  const items = filteredItems.map(item => ({
    key: item.link,
    label: (
      <Link
        to={item.link}
        style={{
          color: theme.headerStyle.color,
          fontSize: theme.menuStyle.fontSize,
          textAlign: 'center',
          display: 'block',
        }}
      >
        {item.label}
      </Link>
    ),
  }));

  // Home-Symbol (links)
  const homeButton = (
    <div
      style={{
        width: theme.headerStyle.height,
        height: theme.headerStyle.height,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <Link to="/">
        <HomeOutlined style={{ fontSize: theme.iconSizes.default, color: theme.headerStyle.color }} />
      </Link>
    </div>
  );

  // User-Symbol (rechts)
  const userButton = (
    <div
      style={{
        width: theme.headerStyle.height,
        height: theme.headerStyle.height,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <Button
        type="text"
        icon={<UserOutlined style={{ fontSize: theme.iconSizes.default, color: theme.headerStyle.color }} />}
      />
    </div>
  );

  if (screens.md) {
    // Desktop: Home links, horizontales Menü in der Mitte, User rechts
    return (
      <div
        style={{
          display: 'flex',
          width: '100%',
          alignItems: 'center',
          height: theme.headerStyle.height,
          background: theme.headerStyle.backgroundColor,
          padding: '0 16px',
        }}
      >
        {homeButton}
        <div
          style={{
            flex: 1,
            display: 'flex',
            justifyContent: 'space-around',
            alignItems: 'center',
          }}
        >
          <Menu
            mode="horizontal"
            selectedKeys={[location.pathname]}
            items={items}
            style={{
              borderBottom: 'none',
              background: 'transparent',
              flex: 1,
            }}
          />
        </div>
        {userButton}
      </div>
    );
  } else {
    // Mobile: Home links, Hamburger-Button in der Mitte, User rechts
    return (
      <div
        style={{
          display: 'flex',
          width: '100%',
          alignItems: 'center',
          height: theme.headerStyle.height,
          background: theme.headerStyle.backgroundColor,
          padding: '0 16px',
          justifyContent: 'space-between',
        }}
      >
        {homeButton}
        <div
          style={{
            flex: 1,
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <Button
            type="text"
            ghost
            icon={<MenuOutlined style={{ color: theme.headerStyle.color, fontSize: theme.iconSizes.hamburger }} />}
            onClick={() => setDrawerVisible(true)}
          />
        </div>
        {userButton}
        <Drawer
          title={null}
          placement="left"
          onClose={() => setDrawerVisible(false)}
          visible={drawerVisible}
          headerStyle={{ backgroundColor: theme.headerStyle.backgroundColor, borderBottom: 'none' }}
          bodyStyle={{ padding: 0, backgroundColor: theme.headerStyle.backgroundColor }}
          maskStyle={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
        >
          <Menu
            mode="vertical"
            selectedKeys={[location.pathname]}
            items={items}
            onClick={() => setDrawerVisible(false)}
            style={{
              fontSize: theme.menuStyle.fontSize,
              background: theme.headerStyle.backgroundColor,
              color: theme.headerStyle.color,
            }}
          />
        </Drawer>
      </div>
    );
  }
};

export default HeaderComponent;
