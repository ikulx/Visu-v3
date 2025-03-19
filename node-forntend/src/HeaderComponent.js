// src/HeaderComponent.js
import React, { useState } from 'react';
import { Menu, Grid, Drawer, Button } from 'antd';
import { Link, useLocation } from 'react-router-dom';
import { HomeOutlined, MenuOutlined, UserOutlined } from '@ant-design/icons';
import { COLORS, DIMENSIONS, ICON_SIZES } from './theme';

const { useBreakpoint } = Grid;

const HeaderComponent = ({ menuItems }) => {
  const location = useLocation();
  const screens = useBreakpoint();
  const [drawerVisible, setDrawerVisible] = useState(false);

  // Filtere Home-Eintrag heraus
  const filteredItems = menuItems.filter(item => item.link !== '/');
  const items = filteredItems.map(item => ({
    key: item.link,
    label: (
      <Link
        to={item.link}
        style={{
          color: COLORS.text,
          fontSize: '20px',
          textAlign: 'center',
          display: 'block',
        }}
      >
        {item.label}
      </Link>
    ),
  }));

  const homeButton = (
    <div
      style={{
        width: DIMENSIONS.homeButtonSize,
        height: DIMENSIONS.homeButtonSize,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <Link to="/">
        <HomeOutlined style={{ fontSize: ICON_SIZES.default, color: COLORS.text }} />
      </Link>
    </div>
  );

  const userButton = (
    <div
      style={{
        width: DIMENSIONS.homeButtonSize,
        height: DIMENSIONS.homeButtonSize,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <Button
        type="text"
        icon={<UserOutlined style={{ fontSize: ICON_SIZES.default, color: COLORS.text }} />}
      />
    </div>
  );

  if (screens.md) {
    return (
      <div
        style={{
          display: 'flex',
          width: '100%',
          alignItems: 'center',
          height: DIMENSIONS.headerHeight,
          background: COLORS.primary,
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
    return (
      <div
        style={{
          display: 'flex',
          width: '100%',
          alignItems: 'center',
          height: DIMENSIONS.headerHeight,
          background: COLORS.primary,
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
            icon={<MenuOutlined style={{ color: COLORS.text, fontSize: ICON_SIZES.hamburger }} />}
            onClick={() => setDrawerVisible(true)}
          />
        </div>
        {userButton}
        <Drawer
          title={null}
          placement="left"
          onClose={() => setDrawerVisible(false)}
          visible={drawerVisible}
          headerStyle={{ backgroundColor: COLORS.primary, borderBottom: 'none' }}
          bodyStyle={{ padding: 0, backgroundColor: COLORS.primary }}
          maskStyle={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
        >
          <Menu
            mode="vertical"
            selectedKeys={[location.pathname]}
            items={items}
            onClick={() => setDrawerVisible(false)}
            style={{ fontSize: '20px', background: COLORS.primary, color: COLORS.text }}
          />
        </Drawer>
      </div>
    );
  }
};

export default HeaderComponent;
