import React from 'react';
import { Menu } from 'antd';
import { Link } from 'react-router-dom';

const MenuComponent = ({ menuItems }) => {
  const items = menuItems.map(item => ({
    key: item.link,
    label: <Link to={item.link}>{item.label}</Link>,
  }));

  return <Menu mode="inline" items={items} style={{ height: '100%', borderRight: 0 }} />;
};

export default MenuComponent;