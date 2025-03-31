// src/MenuConfigModal.js
import React, { useState, useEffect } from 'react';
import {
  Modal,
  Form,
  Input,
  Button,
  Select,
  Switch,
  Tree,
  message,
  Divider
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  CopyOutlined
} from '@ant-design/icons';
import socket from '../socket';
import { useTranslation } from 'react-i18next';

const { Option } = Select;

const MenuConfigModal = ({ visible, onClose }) => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [menuData, setMenuData] = useState({ menuItems: [] });
  const [selectedNode, setSelectedNode] = useState(null);

  useEffect(() => {
    if (visible) {
      socket.emit('request-menu-config');
    }

    const onMenuConfigUpdate = (data) => {
      console.log('Menu config received:', JSON.stringify(data, null, 2));
      setMenuData(data);
    };

    const onMenuConfigSuccess = (response) => {
      console.log('Menu config successful:', response.message);
      setMenuData(response.menu);
      message.success(t('menuUpdated'));
    };

    const onMenuConfigError = (error) => {
      console.error('Menu config error:', error.message);
      message.error(t('menuUpdateFailed', { message: error.message }));
    };

    socket.on('menu-config-update', onMenuConfigUpdate);
    socket.on('menu-config-success', onMenuConfigSuccess);
    socket.on('menu-config-error', onMenuConfigError);

    return () => {
      socket.off('menu-config-update', onMenuConfigUpdate);
      socket.off('menu-config-success', onMenuConfigSuccess);
      socket.off('menu-config-error', onMenuConfigError);
    };
  }, [visible, t]);

  // Generiere Baumdaten. Falls label ein Objekt ist, wird der value genutzt.
  const generateTreeData = (items) => {
    return items.map(item => {
      const labelText =
        typeof item.label === 'object' ? item.label.value : item.label;
      return {
        title: `${labelText} (${item.link || '-'})`,
        key: item.link || labelText,
        children: (item.sub && item.sub.length > 0) ? generateTreeData(item.sub) : [],
        itemData: item
      };
    });
  };

  const treeData = generateTreeData(menuData.menuItems);

  // Beim Auswählen eines Knotens: Formular mit den Werten füllen
  const onSelect = (selectedKeys, info) => {
    if (selectedKeys.length > 0) {
      const node = info.node.itemData;
      setSelectedNode(node);
      // Falls label als Objekt gespeichert ist, direkt verwenden; ansonsten umwandeln
      const labelField =
        typeof node.label === 'object'
          ? node.label
          : { value: node.label, source_type: 'static', source_key: '' };
      form.setFieldsValue({
        label: labelField,
        link: node.link,
        svg: node.svg,
        enable: node.enable === "true" || node.enable === true,
        properties: Object.entries(node.properties || {}).map(([key, value]) => ({
          key,
          // Bei statischen Properties wird value genutzt, sonst source_key
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

  // Speichern der Änderungen am ausgewählten Menüpunkt
  const onFinish = (values) => {
    if (!selectedNode) {
      message.error(t('selectMenuItem'));
      return;
    }

    const updatedNode = {
      ...selectedNode,
      // Label als Objekt übernehmen
      label: values.label,
      link: values.link,
      svg: values.svg,
      enable: values.enable,
      properties: values.properties.reduce((acc, prop) => {
        if (prop.source_type === 'static') {
          acc[prop.key] = {
            value: prop.value,
            source_type: prop.source_type,
            source_key: null
          };
        } else {
          acc[prop.key] = {
            value: null,
            source_type: prop.source_type,
            source_key: prop.source_key
          };
        }
        return acc;
      }, {})
    };

    const updateMenu = (items) => {
      return items.map(item => {
        const currentLabel =
          typeof item.label === 'object' ? item.label.value : item.label;
        const selectedLabel =
          typeof selectedNode.label === 'object' ? selectedNode.label.value : selectedNode.label;
        if (item.link === selectedNode.link && currentLabel === selectedLabel) {
          return { ...item, ...updatedNode };
        } else if (item.sub && item.sub.length > 0) {
          return { ...item, sub: updateMenu(item.sub) };
        }
        return item;
      });
    };

    const updatedMenu = { menuItems: updateMenu(menuData.menuItems) };
    setMenuData(updatedMenu);
    socket.emit('update-menu-config', updatedMenu);
  };

  // Fügt einen neuen Top-Level-Menüpunkt hinzu; Label wird als Objekt initialisiert.
  const addNewItem = () => {
    const newItem = {
      label: { value: 'New Item', source_type: 'static', source_key: '' },
      link: '/new-item',
      svg: 'default',
      enable: true,
      properties: {},
      sub: []
    };
    const updatedMenu = { menuItems: [...menuData.menuItems, newItem] };
    setMenuData(updatedMenu);
    socket.emit('update-menu-config', updatedMenu);
  };

  // Fügt ein neues Untermenü zum aktuell ausgewählten Menüpunkt hinzu.
  const addSubMenu = () => {
    if (!selectedNode) {
      message.error(t('selectMenuItem'));
      return;
    }
    const newSubMenu = {
      label: { value: 'New Submenu', source_type: 'static', source_key: '' },
      link: '/new-submenu',
      svg: 'default',
      enable: true,
      properties: {},
      sub: []
    };

    const addSubMenuToNode = (items) => {
      return items.map(item => {
        const currentLabel =
          typeof item.label === 'object' ? item.label.value : item.label;
        const selectedLabel =
          typeof selectedNode.label === 'object' ? selectedNode.label.value : selectedNode.label;
        if (item.link === selectedNode.link && currentLabel === selectedLabel) {
          const updatedSub = item.sub ? [...item.sub, newSubMenu] : [newSubMenu];
          return { ...item, sub: updatedSub };
        } else if (item.sub && item.sub.length > 0) {
          return { ...item, sub: addSubMenuToNode(item.sub) };
        }
        return item;
      });
    };

    const updatedMenu = { menuItems: addSubMenuToNode(menuData.menuItems) };
    setMenuData(updatedMenu);
    socket.emit('update-menu-config', updatedMenu);
  };

  // Dupliziert den aktuell ausgewählten Menüpunkt inkl. Untermenüs
  const duplicateItem = () => {
    if (!selectedNode) {
      message.error(t('selectMenuItem'));
      return;
    }

    const duplicateMenuItem = (item) => {
      const newItem = JSON.parse(JSON.stringify(item));
      // Label kopieren und " Copy" anhängen
      if (typeof newItem.label === 'object') {
        newItem.label.value = newItem.label.value + ' Copy';
      } else {
        newItem.label = newItem.label + ' Copy';
      }
      newItem.link = newItem.link + '-copy';
      if (newItem.sub && newItem.sub.length > 0) {
        newItem.sub = newItem.sub.map(duplicateMenuItem);
      }
      return newItem;
    };

    const duplicateInList = (items) => {
      return items.flatMap(item => {
        let arr = [item];
        const currentLabel =
          typeof item.label === 'object' ? item.label.value : item.label;
        const selectedLabel =
          typeof selectedNode.label === 'object' ? selectedNode.label.value : selectedNode.label;
        if (item.link === selectedNode.link && currentLabel === selectedLabel) {
          arr.push(duplicateMenuItem(item));
        }
        if (item.sub && item.sub.length > 0) {
          item.sub = duplicateInList(item.sub);
        }
        return arr;
      });
    };

    const updatedMenuItems = duplicateInList(menuData.menuItems);
    const updatedMenu = { menuItems: updatedMenuItems };
    setMenuData(updatedMenu);
    socket.emit('update-menu-config', updatedMenu);
    message.success(t('menuDuplicated'));
  };

  // Löscht den ausgewählten Menüpunkt
  const deleteItem = () => {
    if (!selectedNode) {
      message.error(t('selectMenuItem'));
      return;
    }

    const deleteFromMenu = (items) => {
      return items.filter(item => {
        const currentLabel =
          typeof item.label === 'object' ? item.label.value : item.label;
        const selectedLabel =
          typeof selectedNode.label === 'object' ? selectedNode.label.value : selectedNode.label;
        if (item.link === selectedNode.link && currentLabel === selectedLabel) {
          return false;
        } else if (item.sub && item.sub.length > 0) {
          item.sub = deleteFromMenu(item.sub);
          return true;
        }
        return true;
      });
    };

    const updatedMenu = { menuItems: deleteFromMenu(menuData.menuItems) };
    setMenuData(updatedMenu);
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
      width={900}
      centered
      style={{ top: 20 }}
      styles={{ body: {backgroundColor: '#141414', color: '#fff', padding: '20px' }}}
    >
      <div style={{ display: 'flex', gap: '20px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ marginBottom: '10px', display: 'flex', gap: '10px' }}>
            <Button  icon={<PlusOutlined />} onClick={addNewItem}>
              {t('addItem')}
            </Button>
            <Button
              type="default"
              icon={<PlusOutlined />}
              onClick={addSubMenu}
              disabled={!selectedNode}
            >
              {t('addSubMenu')}
            </Button>
          </div>
          <Divider style={{ backgroundColor: '#fff' }} />
          <Tree
            treeData={treeData}
            onSelect={onSelect}
            height={400}
            style={{ backgroundColor: '#1f1f1f', color: '#fff', padding: '10px' }}
          />
        </div>
        <div style={{ flex: 1 }}>
          {selectedNode ? (
            <Form form={form} layout="vertical" onFinish={onFinish} style={{ color: '#fff' }}>
              {/* Label-Gruppe mit dynamischer Auswahl */}
              <Form.Item label={t('label')}>
                <Form.Item
                  name={['label', 'source_type']}
                  noStyle
                  rules={[{ required: true, message: t('sourceTypeRequired') }]}
                >
                  <Select style={{ width: 120 }} onChange={() => form.validateFields()}>
                    <Option value="static">{t('static')}</Option>
                    <Option value="dynamic">{t('dynamic')}</Option>
                    <Option value="mqtt">{t('mqtt')}</Option>
                  </Select>
                </Form.Item>
                <Form.Item
                  noStyle
                  shouldUpdate={(prev, curr) =>
                    prev.label?.source_type !== curr.label?.source_type
                  }
                >
                  {({ getFieldValue }) => {
                    const type = getFieldValue(['label', 'source_type']) || 'static';
                    return type === 'static' ? (
                      <Form.Item
                        name={['label', 'value']}
                        noStyle
                        rules={[{ required: true, message: t('labelValueRequired') }]}
                      >
                        <Input placeholder={t('labelValue')} style={{ width: 200, marginLeft: 10 }} />
                      </Form.Item>
                    ) : (
                      <Form.Item
                        name={['label', 'source_key']}
                        noStyle
                        rules={[{ required: true, message: t('labelSourceKeyRequired') }]}
                      >
                        <Input placeholder={t('labelSourceKey')} style={{ width: 200, marginLeft: 10 }} />
                      </Form.Item>
                    );
                  }}
                </Form.Item>
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
                      const sourceType =
                        form.getFieldValue(['properties', name, 'source_type']) || 'static';
                      return (
                        <div key={key} style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                          <Form.Item
                            {...restField}
                            name={[name, 'key']}
                            rules={[{ required: true, message: t('propertyKeyRequired') }]}
                          >
                            <Input placeholder={t('key')} />
                          </Form.Item>
                          {sourceType === 'static' ? (
                            <Form.Item
                              {...restField}
                              name={[name, 'value']}
                              rules={[{ required: true, message: t('propertyValueRequired') }]}
                            >
                              <Input placeholder={t('value')} />
                            </Form.Item>
                          ) : (
                            <Form.Item
                              {...restField}
                              name={[name, 'source_key']}
                              rules={[{ required: true, message: t('sourceKeyRequired') }]}
                            >
                              <Input placeholder={t('sourceKey')} />
                            </Form.Item>
                          )}
                          <Form.Item
                            {...restField}
                            name={[name, 'source_type']}
                            rules={[{ required: true, message: t('sourceTypeRequired') }]}
                          >
                            <Select placeholder={t('sourceType')} onChange={() => form.validateFields()}>
                              <Option value="static">{t('static')}</Option>
                              <Option value="dynamic">{t('dynamic')}</Option>
                              <Option value="mqtt">{t('mqtt')}</Option>
                            </Select>
                          </Form.Item>
                          <Button type="primary" danger icon={<DeleteOutlined />} onClick={() => remove(name)} />
                        </div>
                      );
                    })}
                    <Button type="dashed" onClick={() => add()} block>
                      {t('addProperty')}
                    </Button>
                  </>
                )}
              </Form.List>
              <Divider style={{ backgroundColor: '#fff', margin: '20px 0' }} />
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <Button type="default" icon={<CopyOutlined />} onClick={duplicateItem}>
                  {t('duplicate')}
                </Button>
                <Button type="primary" danger icon={<DeleteOutlined />} onClick={deleteItem}>
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
