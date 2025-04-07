import React, { useState, useEffect } from 'react';
import { Modal, Tabs, Form, Input, Button, Select, Switch, Tree, message, Divider, Table } from 'antd';
import { PlusOutlined, DeleteOutlined, CopyOutlined, SaveOutlined } from '@ant-design/icons';
import socket from '../socket';
import { useTranslation } from 'react-i18next';

const { Option } = Select;
const { TabPane } = Tabs;

// 20 vordefinierte Farben
const predefinedColors = [
  '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#FFA500', '#800080', '#008000', '#FFC0CB',
  '#A52A2A', '#808080', '#FFD700', '#C0C0C0', '#40E0D0', '#FF4500', '#DA70D6', '#7FFF00', '#4682B4', '#F0E68C',
];

const MenuConfigModal = ({ visible, onClose }) => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [menuData, setMenuData] = useState({ menuItems: [] });
  const [selectedNode, setSelectedNode] = useState(null);
  const [loggingSettings, setLoggingSettings] = useState([]);
  const [tempLoggingSettings, setTempLoggingSettings] = useState([]); // Temporärer Zustand für Änderungen
  const [newTopic, setNewTopic] = useState('');

  // Daten anfordern, wenn das Modal geöffnet wird
  useEffect(() => {
    if (visible) {
      socket.emit('request-menu-config');
      socket.emit('request-logging-settings');
    }
  }, [visible]);

  // Socket.IO-Listener für Updates
  useEffect(() => {
    const onMenuConfigUpdate = (data) => {
      console.log('Menu config received:', JSON.stringify(data, null, 2));
      setMenuData(data);
      if (selectedNode) {
        const updatedNode = findNodeByLinkAndLabel(data.menuItems, selectedNode.link, selectedNode.label);
        if (updatedNode) {
          setSelectedNode(updatedNode);
          updateForm(updatedNode);
        }
      }
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

    const onLoggingSettingsUpdate = (data) => {
      setLoggingSettings(data);
      setTempLoggingSettings(data); // Initialisiere temporäre Einstellungen mit den Server-Daten
    };

    socket.on('menu-config-update', onMenuConfigUpdate);
    socket.on('menu-config-success', onMenuConfigSuccess);
    socket.on('menu-config-error', onMenuConfigError);
    socket.on('logging-settings-update', onLoggingSettingsUpdate);

    return () => {
      socket.off('menu-config-update', onMenuConfigUpdate);
      socket.off('menu-config-success', onMenuConfigSuccess);
      socket.off('menu-config-error', onMenuConfigError);
      socket.off('logging-settings-update', onLoggingSettingsUpdate);
    };
  }, [visible, t, selectedNode]);

  // Hilfsfunktion zum Finden eines Knotens
  const findNodeByLinkAndLabel = (items, link, label) => {
    for (const item of items) {
      const itemLabel = typeof item.label === 'object' ? item.label.value : item.label;
      if (item.link === link && itemLabel === label) {
        return item;
      }
      if (item.sub && item.sub.length > 0) {
        const found = findNodeByLinkAndLabel(item.sub, link, label);
        if (found) return found;
      }
    }
    return null;
  };

  // Hilfsfunktion zum Aktualisieren des Formulars
  const updateForm = (node) => {
    const labelField =
      typeof node.label === 'object'
        ? node.label
        : { value: node.label, source_type: 'static', source_key: '' };
    form.setFieldsValue({
      label: labelField,
      link: node.link,
      svg: node.svg,
      enable: node.enable === 'true' || node.enable === true,
      qhmiVariable: node.qhmiVariable,
      svgConditions: node.svgConditions || [],
      properties: Object.entries(node.properties || {}).map(([key, value]) => ({
        key,
        value: typeof value === 'object' ? value.value : value,
        source_type: typeof value === 'object' ? value.source_type : 'static',
        source_key: typeof value === 'object' ? value.source_key || '' : '',
      })),
      actions: Object.entries(node.actions || {}).map(([actionName, qhmiNames]) => ({
        actionName,
        qhmiNames: Array.isArray(qhmiNames) ? qhmiNames : [qhmiNames],
      })),
    });
  };

  const generateTreeData = (items) => {
    return items.map(item => {
      const labelText = typeof item.label === 'object' ? item.label.value : item.label;
      return {
        title: `${labelText} (${item.link || '-'})`,
        key: item.link || labelText,
        children: item.sub && item.sub.length > 0 ? generateTreeData(item.sub) : [],
        itemData: item,
      };
    });
  };

  const treeData = generateTreeData(menuData.menuItems);

  const onSelect = (selectedKeys, info) => {
    if (selectedKeys.length > 0) {
      const node = info.node.itemData;
      setSelectedNode(node);
      updateForm(node);
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
      qhmiVariable: values.qhmiVariable,
      svgConditions: values.svgConditions,
      properties: values.properties.reduce((acc, prop) => {
        if (prop.source_type === 'static') {
          acc[prop.key] = { value: prop.value, source_type: prop.source_type, source_key: null };
        } else {
          acc[prop.key] = { value: null, source_type: prop.source_type, source_key: prop.source_key };
        }
        return acc;
      }, {}),
      actions: values.actions.reduce((acc, action) => {
        acc[action.actionName] = action.qhmiNames;
        return acc;
      }, {}),
    };

    const updateMenu = (items) => {
      return items.map(item => {
        const currentLabel = typeof item.label === 'object' ? item.label.value : item.label;
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

  const addNewItem = () => {
    const newItem = {
      label: { value: 'New Item', source_type: 'static', source_key: '' },
      link: '/new-item',
      svg: 'default',
      enable: true,
      qhmiVariable: null,
      svgConditions: [],
      properties: {},
      actions: {},
      sub: [],
    };
    const updatedMenu = { menuItems: [...menuData.menuItems, newItem] };
    setMenuData(updatedMenu);
    socket.emit('update-menu-config', updatedMenu);
  };

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
      qhmiVariable: null,
      svgConditions: [],
      properties: {},
      actions: {},
      sub: [],
    };

    const addSubMenuToNode = (items) => {
      return items.map(item => {
        const currentLabel = typeof item.label === 'object' ? item.label.value : item.label;
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

  const duplicateItem = () => {
    if (!selectedNode) {
      message.error(t('selectMenuItem'));
      return;
    }

    const duplicateMenuItem = (item) => {
      const newItem = JSON.parse(JSON.stringify(item));
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
        const currentLabel = typeof item.label === 'object' ? item.label.value : item.label;
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

  const deleteItem = () => {
    if (!selectedNode) {
      message.error(t('selectMenuItem'));
      return;
    }

    const deleteFromMenu = (items) => {
      return items.filter(item => {
        const currentLabel = typeof item.label === 'object' ? item.label.value : item.label;
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

  // Logging-Einstellungen Funktionen
  const handleAddLoggingSetting = () => {
    if (newTopic.trim()) {
      const newSetting = {
        topic: newTopic,
        enabled: true,
        color: predefinedColors[0],
        page: '',
        description: '',
        unit: '°C',
      };
      setTempLoggingSettings([...tempLoggingSettings, newSetting]);
      setNewTopic('');
    }
  };

  const handleToggleLoggingSetting = (topic, enabled) => {
    const updatedSettings = tempLoggingSettings.map(setting =>
      setting.topic === topic ? { ...setting, enabled: !enabled } : setting
    );
    setTempLoggingSettings(updatedSettings);
  };

  const handleColorChange = (topic, color) => {
    const updatedSettings = tempLoggingSettings.map(setting =>
      setting.topic === topic ? { ...setting, color } : setting
    );
    setTempLoggingSettings(updatedSettings);
  };

  const handlePageChange = (topic, page) => {
    const updatedSettings = tempLoggingSettings.map(setting =>
      setting.topic === topic ? { ...setting, page } : setting
    );
    setTempLoggingSettings(updatedSettings);
  };

  const handleDescriptionChange = (topic, description) => {
    const updatedSettings = tempLoggingSettings.map(setting =>
      setting.topic === topic ? { ...setting, description } : setting
    );
    setTempLoggingSettings(updatedSettings);
  };

  const handleUnitChange = (topic, unit) => {
    const updatedSettings = tempLoggingSettings.map(setting =>
      setting.topic === topic ? { ...setting, unit } : setting
    );
    setTempLoggingSettings(updatedSettings);
  };

  const handleSaveLoggingSettings = () => {
    // Sende alle temporären Einstellungen an den Server
    tempLoggingSettings.forEach(setting => {
      socket.emit('update-logging-setting', {
        topic: setting.topic,
        enabled: setting.enabled,
        color: setting.color,
        page: setting.page,
        description: setting.description,
        unit: setting.unit,
      });
    });
    message.success(t('loggingSettingsSaved'));
  };

  // Generiere die Baumstruktur für die Logging-Einstellungen
  const generateLoggingTreeData = () => {
    // Gruppiere die Einstellungen nach Seiten
    const pageMap = {};

    tempLoggingSettings.forEach(setting => {
      const pages = setting.page ? setting.page.split(',').map(p => p.trim()) : ['Ohne Seite'];
      pages.forEach(page => {
        if (!pageMap[page]) {
          pageMap[page] = [];
        }
        pageMap[page].push(setting);
      });
    });

    // Erstelle die Baumstruktur
    return Object.keys(pageMap)
      .sort() // Sortiere die Seiten alphabetisch
      .map(page => ({
        title: page,
        key: `page-${page}`,
        children: pageMap[page].map(setting => ({
          title: (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>{setting.topic}</span>
              <Button
                size="small"
                onClick={() => handleToggleLoggingSetting(setting.topic, setting.enabled)}
              >
                {setting.enabled ? t('Disable') : t('Enable')}
              </Button>
              <Select
                size="small"
                value={setting.color || predefinedColors[0]}
                onChange={(value) => handleColorChange(setting.topic, value)}
                style={{ width: 120 }}
              >
                {predefinedColors.map((colorOption) => (
                  <Option key={colorOption} value={colorOption}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <div
                        style={{
                          width: 16,
                          height: 16,
                          backgroundColor: colorOption,
                          marginRight: 8,
                          border: '1px solid #434343',
                        }}
                      />
                      {colorOption}
                    </div>
                  </Option>
                ))}
              </Select>
              <Input
                size="small"
                value={setting.page || ''}
                onChange={(e) => handlePageChange(setting.topic, e.target.value)}
                placeholder="z. B. hg01,hg02"
                style={{ width: 150 }}
              />
              <Input
                size="small"
                value={setting.description || ''}
                onChange={(e) => handleDescriptionChange(setting.topic, e.target.value)}
                placeholder="Beschreibung"
                style={{ width: 150 }}
              />
              <Select
                size="small"
                value={setting.unit || '°C'}
                onChange={(value) => handleUnitChange(setting.topic, value)}
                style={{ width: 80 }}
              >
                <Option value="°C">°C</Option>
                <Option value="%">%</Option>
              </Select>
            </div>
          ),
          key: `topic-${setting.topic}`,
          isLeaf: true,
        })),
      }));
  };

  const loggingTreeData = generateLoggingTreeData();

  return (
    <Modal
      title={t('Configuration')}
      open={visible}
      onCancel={onClose}
      footer={null}
      width={900}
      centered
      style={{ top: 20 }}
      styles={{ body: { backgroundColor: '#141414', color: '#fff', padding: '20px' } }}
    >
      <Tabs defaultActiveKey="1" style={{ color: '#fff' }}>
        {/* Tab für Menü-Einstellungen */}
        <TabPane tab={t('Menu Settings')} key="1">
          <div style={{ display: 'flex', gap: '20px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ marginBottom: '10px', display: 'flex', gap: '10px' }}>
                <Button icon={<PlusOutlined />} onClick={addNewItem}>
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
                  <Form.Item name="link" label={t('link')} rules={[{ required: false }]}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="svg" label={t('defaultSvg')} rules={[{ required: false }]}>
                    <Input placeholder="Standard-SVG (Fallback)" />
                  </Form.Item>
                  <Form.Item name="enable" label={t('enable')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="qhmiVariable" label={t('qhmiVariable')} rules={[{ required: false }]}>
                    <Input placeholder="Name der QhmiVariable" />
                  </Form.Item>
                  <Form.List name="svgConditions">
                    {(fields, { add, remove }) => (
                      <>
                        {fields.map(({ key, name, ...restField }) => (
                          <div key={key} style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                            <Form.Item
                              {...restField}
                              name={[name, 'value']}
                              label={t('conditionValue')}
                              rules={[{ required: true, message: t('conditionValueRequired') }]}
                            >
                              <Input placeholder="Wert" />
                            </Form.Item>
                            <Form.Item
                              {...restField}
                              name={[name, 'svg']}
                              label={t('svg')}
                              rules={[{ required: true, message: t('svgRequired') }]}
                            >
                              <Input placeholder="SVG-Datei" />
                            </Form.Item>
                            <Button type="primary" danger icon={<DeleteOutlined />} onClick={() => remove(name)} />
                          </div>
                        ))}
                        <Button type="dashed" onClick={() => add()} block>
                          {t('addSvgCondition')}
                        </Button>
                      </>
                    )}
                  </Form.List>
                  <Divider style={{ backgroundColor: '#fff', margin: '20px 0' }} />
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
                  <Form.List name="actions">
                    {(fields, { add, remove }) => (
                      <>
                        {fields.map(({ key, name, ...restField }) => (
                          <div key={key} style={{ marginBottom: '20px', border: '1px solid #434343', padding: '10px' }}>
                            <Form.Item
                              {...restField}
                              name={[name, 'actionName']}
                              label={t('actionName')}
                              rules={[{ required: true, message: t('actionNameRequired') }]}
                            >
                              <Input placeholder={t('actionName')} />
                            </Form.Item>
                            <Form.List name={[name, 'qhmiNames']}>
                              {(qhmiFields, { add: addQhmi, remove: removeQhmi }) => (
                                <>
                                  {qhmiFields.map(({ key: qhmiKey, name: qhmiName, ...qhmiRestField }) => (
                                    <div key={qhmiKey} style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                                      <Form.Item
                                        {...qhmiRestField}
                                        name={[qhmiName]}
                                        rules={[{ required: true, message: t('qhmiVariableNameRequired') }]}
                                      >
                                        <Input placeholder={t('qhmiVariableName')} />
                                      </Form.Item>
                                      <Button
                                        type="primary"
                                        danger
                                        icon={<DeleteOutlined />}
                                        onClick={() => removeQhmi(qhmiName)}
                                      />
                                    </div>
                                  ))}
                                  <Button type="dashed" onClick={() => addQhmi()} block style={{ marginBottom: '10px' }}>
                                    {t('addQhmiVariable')}
                                  </Button>
                                </>
                              )}
                            </Form.List>
                            <Button type="primary" danger icon={<DeleteOutlined />} onClick={() => remove(name)} />
                          </div>
                        ))}
                        <Button type="dashed" onClick={() => add()} block>
                          {t('addAction')}
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
        </TabPane>

        {/* Tab für Logging-Einstellungen */}
        <TabPane tab={t('Logging Settings')} key="2">
          <Form
            layout="inline"
            onFinish={handleAddLoggingSetting}
            style={{ marginBottom: '20px', backgroundColor: '#1f1f1f', padding: '16px', borderRadius: '4px' }}
          >
            <Form.Item>
              <Input
                placeholder={t('New Topic')}
                value={newTopic}
                onChange={(e) => setNewTopic(e.target.value)}
                style={{ width: '300px', backgroundColor: '#333', color: '#fff', border: '1px solid #434343' }}
              />
            </Form.Item>
            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                style={{ backgroundColor: '#ffb000', borderColor: '#ffb000' }}
              >
                {t('Add')}
              </Button>
            </Form.Item>
          </Form>
          <Tree
            treeData={loggingTreeData}
            defaultExpandAll
            height={400}
            style={{ backgroundColor: '#1f1f1f', color: '#fff', padding: '10px' }}
          />
          <div style={{ marginTop: '20px', textAlign: 'right' }}>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSaveLoggingSettings}
              style={{ backgroundColor: '#ffb000', borderColor: '#ffb000' }}
            >
              {t('Save')}
            </Button>
          </div>
        </TabPane>
      </Tabs>
    </Modal>
  );
};

export default MenuConfigModal;