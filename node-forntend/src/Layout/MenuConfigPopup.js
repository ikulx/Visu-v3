// src/Layout/MenuConfigPopup.js
import React, { useState, useEffect } from 'react';
import { Modal, Button, Input, Tree, message, Radio, Space, Typography, Select } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import socket from '../socket';
import PropertiesEditorPopup from './PropertiesEditorPopup';

const { Title } = Typography;
const { Option } = Select;

const MenuConfigPopup = ({ visible, onClose, menuItems }) => {
  const [treeData, setTreeData] = useState([]);
  const [selectedNodeKey, setSelectedNodeKey] = useState(null);
  const [propertiesModalVisible, setPropertiesModalVisible] = useState(false);
  const [qhmiVariables, setQhmiVariables] = useState([]);

  useEffect(() => {
    socket.emit('request-qhmi-variables');
    socket.on('qhmi-variables', (variables) => {
      setQhmiVariables(variables);
    });

    const convertToTreeData = (items, parentKey = 'root') => {
      return items.map((item, index) => {
        const stableKey = item.id
          ? `menu-${item.id}-${index}`
          : `${parentKey}-child-${Date.now()}-${index}`;
        return {
          stableKey,
          title: item.label,
          link: item.link || '',
          svg: item.svg || '',
          properties: item.properties || {},
          labelSource: item.labelSource || 'static',
          qhmi_variable_id: item.qhmi_variable_id || null,
          children: item.sub ? convertToTreeData(item.sub, stableKey) : [],
        };
      });
    };
    setTreeData(convertToTreeData(menuItems));

    return () => {
      socket.off('qhmi-variables');
    };
  }, [menuItems]);

  const onFinish = () => {
    const updatedMenu = {
      menuItems: convertTreeToMenu(treeData),
    };
    socket.emit('update-menu', updatedMenu);

    socket.once('menu-update-success', () => {
      message.success('Menü erfolgreich aktualisiert');
      onClose();
    });
    socket.once('menu-update-error', (data) => {
      message.error('Fehler beim Speichern des Menüs: ' + data.message);
    });
  };

  const convertTreeToMenu = (nodes) => {
    return nodes.map(node => ({
      link: node.link,
      label: node.title,
      svg: node.svg,
      properties: node.properties,
      labelSource: node.labelSource,
      qhmi_variable_id: node.qhmi_variable_id,
      sub: node.children ? convertTreeToMenu(node.children) : undefined,
    }));
  };

  const handleAddNode = (parentKey) => {
    const newNode = {
      stableKey: `new-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      title: 'Neuer Eintrag',
      link: '',
      svg: '',
      properties: {},
      labelSource: 'static',
      qhmi_variable_id: null,
      children: [],
    };
    const updateTree = (nodes) => {
      if (!parentKey) {
        return [...nodes, newNode];
      }
      return nodes.map(node => {
        if (node.stableKey === parentKey) {
          return {
            ...node,
            children: [...(node.children || []), newNode],
          };
        }
        if (node.children) {
          return {
            ...node,
            children: updateTree(node.children),
          };
        }
        return node;
      });
    };
    setTreeData(updateTree(treeData));
  };

  const handleDeleteNode = (key) => {
    const deleteFromTree = (nodes) => {
      return nodes.filter(node => {
        if (node.stableKey === key) return false;
        if (node.children) {
          node.children = deleteFromTree(node.children);
        }
        return true;
      });
    };
    setTreeData(deleteFromTree(treeData));
  };

  const handleUpdateField = (key, field, value) => {
    const updateTree = (nodes) =>
      nodes.map(node => {
        if (node.stableKey === key) {
          const updatedNode = { ...node, [field]: value };
          if (field === 'labelSource') {
            if (value === 'static') {
              updatedNode.qhmi_variable_id = null;
            } else if (value === 'dynamic') {
              updatedNode.title = ''; // Bei dynamisch wird title ignoriert
            }
          }
          return updatedNode;
        }
        return {
          ...node,
          children: node.children ? updateTree(node.children) : node.children,
        };
      });
    setTreeData(updateTree(treeData));
  };

  const handleEditProperties = (key) => {
    setSelectedNodeKey(key);
    setPropertiesModalVisible(true);
  };

  const handleSaveProperties = (key, newProperties) => {
    const updateTree = (nodes) =>
      nodes.map(node => {
        if (node.stableKey === key) {
          return { ...node, properties: newProperties };
        }
        return {
          ...node,
          children: node.children ? updateTree(node.children) : node.children,
        };
      });
    setTreeData(updateTree(treeData));
    setPropertiesModalVisible(false);
  };

  const renderTreeNodes = (data) =>
    data.map(item => ({
      title: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '8px 0' }}>
          <Title level={5}>
            Menüpunkt: {item.labelSource === 'dynamic' && item.qhmi_variable_id
              ? qhmiVariables.find(v => v.id === item.qhmi_variable_id)?.VAR_VALUE || 'Dynamisch'
              : item.title || 'Unbenannt'}
          </Title>
          <Space direction="vertical" size="small">
            <Space>
              <Radio.Group
                value={item.labelSource}
                onChange={(e) => handleUpdateField(item.stableKey, 'labelSource', e.target.value)}
              >
                <Radio value="static">Statisch</Radio>
                <Radio value="dynamic">Dynamisch</Radio>
              </Radio.Group>
              {item.labelSource === 'static' ? (
                <Input
                  value={item.title}
                  onChange={(e) => handleUpdateField(item.stableKey, 'title', e.target.value)}
                  style={{ width: 200 }}
                  placeholder="Statisches Label"
                />
              ) : (
                <Select
                  value={item.qhmi_variable_id}
                  onChange={(value) => handleUpdateField(item.stableKey, 'qhmi_variable_id', value)}
                  style={{ width: 200 }}
                  placeholder="Wähle eine Variable"
                >
                  {qhmiVariables.map(varItem => (
                    <Option key={varItem.id} value={varItem.id}>
                      {varItem.NAME} (Wert: {varItem.VAR_VALUE || 'N/A'})
                    </Option>
                  ))}
                </Select>
              )}
            </Space>
            <Space>
              <Input
                placeholder="Link"
                value={item.link}
                onChange={(e) => handleUpdateField(item.stableKey, 'link', e.target.value)}
                style={{ width: 200 }}
              />
              <Input
                placeholder="SVG"
                value={item.svg}
                onChange={(e) => handleUpdateField(item.stableKey, 'svg', e.target.value)}
                style={{ width: 200 }}
              />
            </Space>
            <Space>
              <Button
                type="default"
                shape="circle"
                icon={<PlusOutlined />}
                size="small"
                onClick={() => handleAddNode(item.stableKey)}
              />
              <Button
                type="danger"
                shape="circle"
                icon={<DeleteOutlined />}
                size="small"
                onClick={() => handleDeleteNode(item.stableKey)}
              />
              <Button
                shape="circle"
                icon={<EditOutlined />}
                size="small"
                onClick={() => handleEditProperties(item.stableKey)}
              />
            </Space>
          </Space>
        </div>
      ),
      key: item.stableKey,
      children: item.children ? renderTreeNodes(item.children) : [],
    }));

  return (
    <>
      <Modal
        title="Menü Konfiguration"
        open={visible}
        onCancel={onClose}
        footer={[
          <Button key="cancel" onClick={onClose}>
            Abbrechen
          </Button>,
          <Button key="submit" type="primary" onClick={onFinish}>
            Speichern
          </Button>,
        ]}
        width={1000}
      >
        <Tree
          treeData={renderTreeNodes(treeData)}
          defaultExpandAll
          blockNode
        />
        <Button
          type="default"
          onClick={() => handleAddNode(null)}
          style={{ marginTop: 16 }}
        >
          Neuer Haupteintrag
        </Button>
      </Modal>
      {selectedNodeKey && (
        <PropertiesEditorPopup
          visible={propertiesModalVisible}
          onClose={() => setPropertiesModalVisible(false)}
          properties={treeData.find(node => node.stableKey === selectedNodeKey)?.properties || {}}
          qhmiVariables={qhmiVariables}
          onSave={(newProperties) => handleSaveProperties(selectedNodeKey, newProperties)}
        />
      )}
    </>
  );
};

export default MenuConfigPopup;