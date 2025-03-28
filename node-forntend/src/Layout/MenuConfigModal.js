// src/MenuConfigModal.js
import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, Button, Select, Switch, Tree, message } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import socket from '../socket';
import { useTranslation } from 'react-i18next';

const { Option } = Select;

const MenuConfigModal = ({ visible, onClose, menuItems }) => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [menuData, setMenuData] = useState(menuItems);

  useEffect(() => {
    setMenuData(menuItems);

    const onMenuConfigSuccess = (response) => {
      console.log('Menu config successful:', response.message);
      setMenuData(response.menu.menuItems);
      message.success(t('menuUpdated'));
    };

    const onMenuConfigError = (error) => {
      console.error('Menu config error:', error.message);
      message.error(t('menuUpdateFailed', { message: error.message }));
    };

    socket.on('menu-config-success', onMenuConfigSuccess);
    socket.on('menu-config-error', onMenuConfigError);

    return () => {
      socket.off('menu-config-success', onMenuConfigSuccess);
      socket.off('menu-config-error', onMenuConfigError);
    };
  }, [menuItems, t]);

  const generateTreeData = (items) => {
    return items.map(item => ({
      title: `${item.label} (${item.link || '-'})`,
      key: item.link || item.label,
      children: item.sub ? generateTreeData(item.sub) : undefined,
      itemData: item
    }));
  };

  const treeData = generateTreeData(menuData);
  const [selectedNode, setSelectedNode] = useState(null);

  const onSelect = (selectedKeys, info) => {
    if (selectedKeys.length > 0) {
      const node = info.node.itemData;
      setSelectedNode(node);
      form.setFieldsValue({
        label: node.label,
        link: node.link,
        svg: node.svg,
        enable: node.enable === "true" || node.enable === true,
        properties: Object.entries(node.properties || {}).map(([key, value]) => ({
          key,
          value: typeof value === 'object' ? value.value : value,
          source_type: typeof value === 'object' ? value.source_type : 'static',
          source_key: typeof value === 'object' ? value.source_key || '' : ''
        }))
      });
    } else {
      setSelectedNode(null);
      form.resetFields();
    }
  };

  const onFinish = (values) => {
    if (!selectedNode) {
      message.error(t('selectMenuItem'));
      return;
    }

    const updatedNode = {
      ...selectedNode,
      label: values.label,
      link: values.link,
      svg: values.svg,
      enable: values.enable,
      properties: values.properties.reduce((acc, prop) => {
        acc[prop.key] = {
          value: prop.source_type === 'static' ? prop.value : null, // Nur bei static einen Wert setzen
          source_type: prop.source_type,
          source_key: prop.source_type === 'static' ? null : prop.source_key
        };
        return acc;
      }, {})
    };

    const updateMenu = (items) => {
      return items.map(item => {
        if (item.link === selectedNode.link && item.label === selectedNode.label) {
          return { ...item, ...updatedNode };
        } else if (item.sub) {
          return { ...item, sub: updateMenu(item.sub) };
        }
        return item;
      });
    };

    const updatedMenu = { menuItems: updateMenu(menuData) };
    setMenuData(updatedMenu.menuItems);
    socket.emit('update-menu-config', updatedMenu);
  };

  const addNewItem = () => {
    const newItem = {
      label: 'New Item',
      link: '/new-item',
      svg: 'default',
      enable: true,
      properties: {}
    };
    const updatedMenu = { menuItems: [...menuData, newItem] };
    setMenuData(updatedMenu.menuItems);
    socket.emit('update-menu-config', updatedMenu);
  };

  const deleteItem = () => {
    if (!selectedNode) {
      message.error(t('selectMenuItem'));
      return;
    }

    const deleteFromMenu = (items) => {
      return items.filter(item => {
        if (item.link === selectedNode.link && item.label === selectedNode.label) {
          return false;
        } else if (item.sub) {
          item.sub = deleteFromMenu(item.sub);
          return true;
        }
        return true;
      });
    };

    const updatedMenu = { menuItems: deleteFromMenu(menuData) };
    setMenuData(updatedMenu.menuItems);
    socket.emit('update-menu-config', updatedMenu);
    setSelectedNode(null);
    form.resetFields();
  };

  return (
    <Modal
      title={t('menuConfiguration')}
      open={visible}
      onCancel={onClose}
      footer={null}
      width={800}
      centered
      styles={{ body: { backgroundColor: '#141414', color: '#fff', padding: '20px' } }}
    >
      <div style={{ display: 'flex', gap: '20px' }}>
        <div style={{ flex: 1 }}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={addNewItem}
            style={{ marginBottom: '10px' }}
          >
            {t('addItem')}
          </Button>
          <Tree
            treeData={treeData}
            onSelect={onSelect}
            height={400}
            style={{ backgroundColor: '#1f1f1f', color: '#fff' }}
          />
        </div>
        <div style={{ flex: 1 }}>
          {selectedNode ? (
            <Form
              form={form}
              layout="vertical"
              onFinish={onFinish}
              style={{ color: '#fff' }}
            >
              <Form.Item name="label" label={t('label')} rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="link" label={t('link')} rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="svg" label={t('svg')} rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="enable" label={t('enable')} valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.List name="properties">
                {(fields, { add, remove }) => (
                  <>
                    {fields.map(({ key, name, ...restField }) => {
                      const sourceType = form.getFieldValue(['properties', name, 'source_type']) || 'static';
                      return (
                        <div key={key} style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                          <Form.Item
                            {...restField}
                            name={[name, 'key']}
                            rules={[{ required: true, message: t('propertyKeyRequired') }]}
                          >
                            <Input placeholder={t('key')} />
                          </Form.Item>
                          <Form.Item
                            {...restField}
                            name={[name, 'value']}
                            rules={[{ required: sourceType === 'static', message: t('propertyValueRequired') }]}
                          >
                            <Input placeholder={t('value')} disabled={sourceType !== 'static'} />
                          </Form.Item>
                          <Form.Item
                            {...restField}
                            name={[name, 'source_type']}
                            rules={[{ required: true, message: t('sourceTypeRequired') }]}
                          >
                            <Select
                              placeholder={t('sourceType')}
                              onChange={() => form.validateFields()} // Trigger Validierung bei Änderung
                            >
                              <Option value="static">{t('static')}</Option>
                              <Option value="dynamic">{t('dynamic')}</Option>
                              <Option value="mqtt">{t('mqtt')}</Option>
                            </Select>
                          </Form.Item>
                          <Form.Item
                            {...restField}
                            name={[name, 'source_key']}
                            rules={[{ required: sourceType !== 'static', message: t('sourceKeyRequired') }]}
                          >
                            <Input placeholder={t('sourceKey')} disabled={sourceType === 'static'} />
                          </Form.Item>
                          <Button
                            type="danger"
                            icon={<DeleteOutlined />}
                            onClick={() => remove(name)}
                          />
                        </div>
                      );
                    })}
                    <Button type="dashed" onClick={() => add()} block>
                      {t('addProperty')}
                    </Button>
                  </>
                )}
              </Form.List>
              <div style={{ marginTop: '20px', textAlign: 'right' }}>
                <Button type="danger" icon={<DeleteOutlined />} onClick={deleteItem} style={{ marginRight: '10px' }}>
                  {t('deleteItem')}
                </Button>
                <Button type="primary" htmlType="submit">
                  {t('save')}
                </Button>
              </div>
            </Form>
          ) : (
            <p>{t('selectMenuItemToEdit')}</p>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default MenuConfigModal;