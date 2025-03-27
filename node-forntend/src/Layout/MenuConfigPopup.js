import React, { useState, useEffect } from 'react';
import { Modal, Button, Tree, Input, Radio, Select } from 'antd';
import socket from '../socket';
import PropertiesEditorPopup from './PropertiesEditorPopup';

const { TreeNode } = Tree;
const { Option } = Select;

const MenuConfigPopup = ({ visible, onClose, menuItems, qhmiVariables }) => {
  const [localMenuItems, setLocalMenuItems] = useState(() => menuItems || []);

  useEffect(() => {
    if (visible) setLocalMenuItems(menuItems || []);
  }, [visible, menuItems]);

  const addMenuItem = (parentId = null) => {
    const newItem = {
      id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      link: '',
      label: 'Neuer Menüpunkt',
      svg: '',
      labelSource: 'static',
      qhmi_variable_id: null,
      properties: {},
      sub: [],
    };
    if (parentId) {
      const updateSubItems = (items) => items.map(item => {
        if (item.id === parentId) return { ...item, sub: [...item.sub, newItem] };
        if (item.sub) return { ...item, sub: updateSubItems(item.sub) };
        return item;
      });
      setLocalMenuItems(prev => updateSubItems(prev));
    } else {
      setLocalMenuItems(prev => [...prev, newItem]);
    }
  };

  const updateMenuItem = (id, field, value) => {
    const updateItems = (items) => items.map(item => {
      if (item.id === id) {
        const updatedItem = { ...item, [field]: value };
        if (field === 'labelSource') {
          if (value === 'static') updatedItem.qhmi_variable_id = null;
          else if (value === 'dynamic') updatedItem.label = '';
        }
        return updatedItem;
      }
      if (item.sub) return { ...item, sub: updateItems(item.sub) };
      return item;
    });
    setLocalMenuItems(prev => updateItems(prev));
  };

  const handleSave = () => {
    const cleanedMenuItems = localMenuItems.map(item => ({
      ...item,
      id: undefined,
      sub: item.sub ? item.sub.map(sub => ({ ...sub, id: undefined })) : []
    }));
    console.log('Sending menu items to server:', cleanedMenuItems);
    socket.emit('update-menu', { menuItems: cleanedMenuItems });
    onClose();
  };

  const renderTreeNodes = (data) => data.map(item => (
    <TreeNode
      title={
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Input
            value={item.label}
            onChange={(e) => updateMenuItem(item.id, 'label', e.target.value)}
            style={{ width: 150, marginRight: 8 }}
            disabled={item.labelSource === 'dynamic'}
            placeholder={item.labelSource === 'dynamic' ? 'Dynamisch (Variable)' : 'Label'}
          />
          <Radio.Group value={item.labelSource} onChange={(e) => updateMenuItem(item.id, 'labelSource', e.target.value)} style={{ marginRight: 8 }}>
            <Radio value="static">Statisch</Radio>
            <Radio value="dynamic">Dynamisch</Radio>
          </Radio.Group>
          {item.labelSource === 'dynamic' && (
            <Select
              value={item.qhmi_variable_id}
              onChange={(value) => updateMenuItem(item.id, 'qhmi_variable_id', value)}
              style={{ width: 150, marginRight: 8 }}
              placeholder="Wähle eine Variable"
            >
              {qhmiVariables.map(varItem => (
                <Option key={varItem.id} value={varItem.id}>{varItem.NAME}</Option>
              ))}
            </Select>
          )}
          <Input value={item.link} onChange={(e) => updateMenuItem(item.id, 'link', e.target.value)} style={{ width: 150, marginRight: 8 }} placeholder="Link" />
          <Input value={item.svg} onChange={(e) => updateMenuItem(item.id, 'svg', e.target.value)} style={{ width: 150, marginRight: 8 }} placeholder="SVG" />
          <Button onClick={() => setEditingProperties(item)} style={{ marginRight: 8 }}>Properties</Button>
          <Button onClick={() => addMenuItem(item.id)}>Unterpunkt hinzufügen</Button>
        </div>
      }
      key={item.id}
    >
      {item.sub && renderTreeNodes(item.sub)}
    </TreeNode>
  ));

  const [editingProperties, setEditingProperties] = useState(null);

  return (
    <Modal
      title="Menü konfigurieren"
      open={visible}
      onCancel={onClose}
      footer={[
        <Button key="add" onClick={() => addMenuItem()}>Menüpunkt hinzufügen</Button>,
        <Button key="cancel" onClick={onClose}>Abbrechen</Button>,
        <Button key="save" type="primary" onClick={handleSave}>Speichern</Button>,
      ]}
      width={1200}
    >
      <Tree>{renderTreeNodes(localMenuItems)}</Tree>
      {editingProperties && (
        <PropertiesEditorPopup
          visible={true}
          onClose={() => setEditingProperties(null)}
          properties={editingProperties.properties}
          qhmiVariables={qhmiVariables}
          onSave={(newProperties) => {
            updateMenuItem(editingProperties.id, 'properties', newProperties);
            setEditingProperties(null);
          }}
        />
      )}
    </Modal>
  );
};

export default MenuConfigPopup;