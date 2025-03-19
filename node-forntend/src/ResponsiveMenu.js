// src/ResponsiveMenu.js
import React, { useState } from 'react';
import { Drawer, Menu, Button, Grid } from 'antd';
import { MenuOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';

const { useBreakpoint } = Grid;

const ResponsiveMenu = ({ menuItems }) => {
  // Filtere den Home-Eintrag (Link "/") heraus, da das Home-Symbol separat dargestellt wird
  const filteredItems = menuItems.filter(item => item.link !== '/');
  const screens = useBreakpoint();
  const [drawerVisible, setDrawerVisible] = useState(false);

  const items = filteredItems.map(item => ({
    key: item.link,
    label: (
      <Link
        to={item.link}
        style={{
          color: '#fff',
          fontSize: '20px',
          display: 'block',
          textAlign: 'center'
        }}
      >
        {item.label}
      </Link>
    ),
  }));

  if (screens.md) {
    // Bei größeren Bildschirmen: horizontales Menü ohne Home-Eintrag
    return (
      <Menu
        mode="horizontal"
        items={items}
        style={{
          borderBottom: 'none',
          background: 'transparent'
        }}
      />
    );
  } else {
    // Bei kleineren Bildschirmen: Hamburger-Button + Drawer-Menü
    return (
      <>
        <Button
          icon={<MenuOutlined style={{ color: '#fff', fontSize: '24px' }} />}
          onClick={() => setDrawerVisible(true)}
          style={{ marginLeft: '16px' }}
        />
        <Drawer
          title={null}
          placement="left"
          onClose={() => setDrawerVisible(false)}
          visible={drawerVisible}
          bodyStyle={{ padding: 0, backgroundColor: '#001529' }}
        >
          <Menu
            mode="vertical"
            items={items}
            onClick={() => setDrawerVisible(false)}
            style={{ fontSize: '20px', background: '#001529' }}
          />
        </Drawer>
      </>
    );
  }
};

export default ResponsiveMenu;
