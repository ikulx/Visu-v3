import React, { useState } from 'react';
import { Menu, Grid, Drawer, Button } from 'antd';
import { Link, useLocation, useNavigate } from 'react-router-dom'; // Importiere useNavigate
import { HomeOutlined, MenuOutlined, UserOutlined } from '@ant-design/icons';
import './HeaderComponent.css';

const { useBreakpoint } = Grid;

const HeaderComponent = ({ menuItems }) => {
  const location = useLocation();
  const screens = useBreakpoint();
  const [drawerVisible, setDrawerVisible] = useState(false);
  const navigate = useNavigate(); // Initialisiere navigate

  // Filtere den Home-Link aus den Menüpunkten
  const filteredItems = menuItems.filter(item => item.link !== '/');
  const items = filteredItems.map(item => ({
    key: item.link,
    label: <Link to={item.link}>{item.label}</Link>,
  }));

  // Home-Button
  const homeButton = (
    <Button
      className="header-home-button"
      type="text"
      ghost
      icon={<HomeOutlined className="header-home-icon" />}
      onClick={() => navigate('/')} // Verwende navigate für Navigation
    />
  );

  // Menü-Button (Hamburger)
  const menuButton = (
    <Button
      className="header-menu-button"
      type="text"
      ghost
      icon={<MenuOutlined className="header-menu-icon" />}
      onClick={() => setDrawerVisible(true)}
    />
  );

  // User-Button
  const userButton = (
    <Button
      className="header-user-button"
      type="text"
      ghost
      icon={<UserOutlined className="header-user-icon" />}
      onClick={() => navigate('/user')} // Verwende navigate für Navigation
    />
  );

  // Desktop-Ansicht
  if (screens.md) {
    return (
      <div className="header-container">
        {homeButton}
        <Menu
          mode="horizontal"
          selectedKeys={[location.pathname]}
          items={items}
          className="header-menu"
        />
        {userButton}
      </div>
    );
  } 
  // Mobile-Ansicht
  else {
    return (
      <div className="header-container mobile">
        {homeButton}
        {menuButton}
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
            items={items}
            onClick={() => setDrawerVisible(false)}
            className="header-menu-mobile"
          />
        </Drawer>
      </div>
    );
  }
};

export default HeaderComponent;