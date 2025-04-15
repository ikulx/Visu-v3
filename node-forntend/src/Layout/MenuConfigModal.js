// src/Layout/MenuConfigModal.js
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Modal, Tabs, Form, Input, Button, Select, Switch, Tree, message, Divider, Table, Popconfirm, Space, Spin, Upload, InputNumber, Tooltip } from 'antd';
import { PlusOutlined, DeleteOutlined, CopyOutlined, SaveOutlined, EditOutlined, LoadingOutlined, DownloadOutlined, UploadOutlined, SettingOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import socket from '../socket';
import { useTranslation } from 'react-i18next';
import { produce } from 'immer';
import RulesConfigTab from './RulesConfigTab'; // Pfad anpassen, falls nötig

// Backend URL Konstante
const BACKEND_BASE_URL = `http://${window.location.hostname}:3001`;

const { Option } = Select;
const { TabPane } = Tabs;
const { Item } = Form; // Für Form Items

// Vordefinierte Farben (für Logging Tab)
const predefinedColors = [
  '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#FFA500', '#800080', '#008000', '#FFC0CB',
  '#A52A2A', '#808080', '#FFD700', '#C0C0C0', '#40E0D0', '#FF4500', '#DA70D6', '#7FFF00', '#4682B4', '#F0E68C',
];

// Prioritätsoptionen für Alarme
const alarmPriorities = ['prio1', 'prio2', 'prio3', 'warning', 'info'];

// Spalten für Alarmkonfiguration-Übersichtstabelle
const alarmConfigColumns = (onEdit, onDelete, t) => [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: t('alarm_identifier', 'Identifier/Key'), dataIndex: 'mqtt_topic', key: 'mqtt_topic', ellipsis: true }, // Label angepasst
    { title: t('description', 'Beschreibung'), dataIndex: 'description', key: 'description', ellipsis: true },
    {
        title: t('actions', 'Aktionen'), key: 'actions', width: 100, align: 'center', render: (_, record) => (
            <Space>
                <Tooltip title={t('editConfigTooltip', 'Identifier und Bit-Definitionen bearbeiten')}>
                     <Button icon={<SettingOutlined />} onClick={() => onEdit(record)} size="small" />
                </Tooltip>
                <Popconfirm title={t('deleteConfigConfirm', 'Identifier und alle zugehörigen Bit-Definitionen löschen?')} onConfirm={() => onDelete(record.id)} okText={t('yes', 'Ja')} cancelText={t('no', 'Nein')}>
                    <Tooltip title={t('deleteConfigTooltip', 'Diesen Identifier löschen')}>
                         <Button danger icon={<DeleteOutlined />} size="small" />
                    </Tooltip>
                </Popconfirm>
            </Space>
        )
    }
];

// --- Helper-Funktionen außerhalb der Komponente ---

// Funktion zum Generieren eines stabilen Keys für Tree-Nodes (Menu)
const generateNodeKey = (item, index, parentKey = 'root') => {
    if (!item) return `${parentKey}-invalid-${index}`;
    const labelPart = typeof item.label === 'object' && item.label !== null
        ? (item.label.value || `item-${index}`)
        : (item.label || `item-${index}`);
    return item.id != null ? `item-${item.id}` : `${parentKey}-${item.link || labelPart}-${index}`;
};

// Funktion zum Erzeugen der Baumstruktur für das Menü
const generateTreeData = (items, parentKey = 'root') => {
    if (!Array.isArray(items)) return [];
    return items.map((item, index) => {
        if (!item) return null;
        const key = generateNodeKey(item, index, parentKey); // Nutzt globale Funktion
        const labelText = typeof item.label === 'object' && item.label !== null ? (item.label.value || `Item ${index + 1}`) : (item.label || `Item ${index + 1}`);
        return {
            title: `${labelText} (${item.link || '-'})`,
            key: key,
            children: generateTreeData(item.sub, key), // Rekursiver Aufruf
            itemData: item, // Originaldaten für Klick-Handler speichern
        };
    }).filter(Boolean); // null-Werte entfernen (falls items ungültige Einträge hatte)
};

// Funktion zum Finden eines Knotens anhand seiner Daten (Referenz oder ID)
const findNodeByReference = (items, nodeToFind) => {
    if (!Array.isArray(items) || !nodeToFind) return null;
    for (const item of items) {
        if (!item) continue;
        // ID bevorzugen, da Referenz sich ändern kann
        if ((nodeToFind.id != null && item.id === nodeToFind.id) || item === nodeToFind) {
            return item;
        }
        // Rekursiv in Kindern suchen
        if (item.sub) {
            const found = findNodeByReference(item.sub, nodeToFind);
            if (found) return found;
        }
    }
    return null;
};

// Findet den generierten Key eines bestimmten Knotens im Baum
const findKeyInTree = (items, nodeToFind, parentKey = 'root') => {
    if (!Array.isArray(items) || !nodeToFind) return null;
    for (let index = 0; index < items.length; index++) {
        const item = items[index];
        if (!item) continue;
        const key = generateNodeKey(item, index, parentKey); // Nutzt globale Funktion
        // ID bevorzugen für Vergleich
        if ((nodeToFind.id != null && item.id === nodeToFind.id) || item === nodeToFind) {
            return key;
        }
        // Rekursiv in Kindern suchen
        if (item.sub) {
            const foundKey = findKeyInTree(item.sub, nodeToFind, key);
            if (foundKey) return foundKey;
        }
    }
    return null;
};


// --- Hauptkomponente des Modals ---
const MenuConfigModal = ({ visible, onClose }) => {
  const { t } = useTranslation();
  const [menuForm] = Form.useForm();
  // States für Menu Tab
  const [menuData, setMenuData] = useState({ menuItems: [] });
  const [isLoadingMenu, setIsLoadingMenu] = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedNodeKey, setSelectedNodeKey] = useState(null);
  // States für Logging Tab
  const [loggingSettings, setLoggingSettings] = useState([]);
  const [isLoadingLogging, setIsLoadingLogging] = useState(false);
  const [tempLoggingSettings, setTempLoggingSettings] = useState([]);
  const [pages, setPages] = useState([]);
  const [tempPages, setTempPages] = useState([]);
  const [newPage, setNewPage] = useState('');
  const [newLoggingTopic, setNewLoggingTopic] = useState('');
  const [selectedPageForTopic, setSelectedPageForTopic] = useState(null);
  // States für Rules Tab
  const [visibilityRules, setVisibilityRules] = useState([]);
  const [isLoadingRules, setIsLoadingRules] = useState(false);
  // State für CSV Import
  const [isUploading, setIsUploading] = useState(false);
  // States für Alarmkonfiguration
  const [alarmConfigs, setAlarmConfigs] = useState([]);
  const [isLoadingAlarms, setIsLoadingAlarms] = useState(false);
  const [isAlarmConfigModalVisible, setIsAlarmConfigModalVisible] = useState(false);
  const [editingAlarmConfig, setEditingAlarmConfig] = useState(null);
  const [alarmConfigForm] = Form.useForm();


  // --- UseEffect Hooks ---

  // Effekt zum initialen Laden aller Daten
  useEffect(() => {
    if (visible) {
      console.log("MenuConfigModal visible: Requesting all configs...");
      setIsLoadingMenu(true); setIsLoadingLogging(true); setIsLoadingRules(true); setIsLoadingAlarms(true);
      socket.emit('request-menu-config'); socket.emit('request-logging-settings'); socket.emit('request-visibility-rules'); socket.emit('request-alarm-configs');
    } else {
      // Reset states when modal is closed
      setIsLoadingMenu(false); setIsLoadingLogging(false); setIsLoadingRules(false); setIsLoadingAlarms(false); setIsUploading(false);
      setSelectedNode(null); setSelectedNodeKey(null); menuForm.resetFields();
      setTempLoggingSettings(loggingSettings); setTempPages(pages); // Reset temp logging to actual logging settings
      setEditingAlarmConfig(null); setIsAlarmConfigModalVisible(false); // Reset alarm editing
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]); // menuForm, loggingSettings, pages aus Deps entfernt, da Reset keine Abhängigkeit von ihnen braucht

  // Effekt für Menü-Formular Update bei Selektion
  const updateMenuForm = useCallback((node) => {
       if (!node) { menuForm.resetFields(); return; }
       const labelField = typeof node.label === 'object' && node.label !== null ? node.label : { value: node.label || '', source_type: 'static', source_key: '' };
       const properties = node.properties || {};
       const actions = node.actions || {};
       menuForm.setFieldsValue({
          label: labelField,
          link: node.link || '',
          svg: node.svg || '',
          enable: node.enable === true || node.enable === 'true' || node.enable === 1,
          qhmiVariable: node.qhmiVariable || '',
          svgConditions: node.svgConditions || [],
          properties: Object.entries(properties).map(([key, propData]) => {
             const isObject = typeof propData === 'object' && propData !== null;
             return { key, value: isObject ? propData.value : propData, source_type: isObject ? propData.source_type || 'static' : 'static', source_key: isObject ? propData.source_key || '' : '' };
           }),
          actions: Object.entries(actions).map(([actionName, qhmiNames]) => ({ actionName, qhmiNames: Array.isArray(qhmiNames) ? qhmiNames : [qhmiNames].filter(Boolean) })),
        });
   }, [menuForm]); // Hängt nur vom Formular selbst ab


  // Effekt für alle Socket.IO-Listener
  useEffect(() => {
    // Listener für Menü
    const onMenuConfigUpdate = (data) => {
         const newMenuData = data && Array.isArray(data.menuItems) ? data : { menuItems: [] };
         setMenuData(newMenuData); setIsLoadingMenu(false);
         if (selectedNode) {
            const stillSelectedNode = findNodeByReference(newMenuData.menuItems, selectedNode); // Global helper
            if (stillSelectedNode) {
                setSelectedNode(stillSelectedNode);
                updateMenuForm(stillSelectedNode); // Callback aufrufen
                setSelectedNodeKey(findKeyInTree(newMenuData.menuItems, stillSelectedNode)); // Globale Funktion
            } else {
                setSelectedNode(null); setSelectedNodeKey(null); menuForm.resetFields();
            }
        }
    };
    const onMenuConfigSuccess = (response) => { setIsLoadingMenu(false); message.success(response.message || t('menuUpdated')); if (response.menu && Array.isArray(response.menu.menuItems)) setMenuData(response.menu);};
    const onMenuConfigError = (error) => { setIsLoadingMenu(false); message.error(t('menuUpdateFailed', { message: error.message })); };
    // Listener für Logging
    const onLoggingSettingsUpdate = (data) => { const validData = Array.isArray(data) ? data : []; setLoggingSettings(validData); setTempLoggingSettings(validData); const uniquePages = [...new Set(validData.filter(s => s.page).flatMap(s => s.page.split(',').map(p => p.trim())))].sort(); setPages(uniquePages); setTempPages(uniquePages); setIsLoadingLogging(false); };
    // Listener für Rules
    const onVisibilityRulesUpdate = (data) => { setVisibilityRules(Array.isArray(data) ? data : []); setIsLoadingRules(false); };
    const onVisibilityRulesSuccess = (response) => { setIsLoadingRules(false); message.success(response.message || t('rulesSaved')); };
    const onVisibilityRulesError = (error) => { setIsLoadingRules(false); message.error(error.message || t('rulesSaveFailed')); };
     // Listener für Alarme
     const handleAlarmConfigsUpdate = (data) => { console.log("Alarm configs received:", data); setAlarmConfigs(Array.isArray(data) ? data : []); setIsLoadingAlarms(false); };
     const handleAlarmConfigsSuccess = (response) => { message.success(response.message || t('alarmConfigSaved', 'Alarmkonfiguration gespeichert.')); setIsLoadingAlarms(false); };
     const handleAlarmConfigsError = (error) => { message.error(error.message || t('alarmConfigSaveFailed', 'Speichern fehlgeschlagen.')); setIsLoadingAlarms(false); };

    // Listener registrieren
    socket.on('menu-config-update', onMenuConfigUpdate);
    socket.on('menu-config-success', onMenuConfigSuccess);
    socket.on('menu-config-error', onMenuConfigError);
    socket.on('logging-settings-update', onLoggingSettingsUpdate);
    socket.on('visibility-rules-update', onVisibilityRulesUpdate);
    socket.on('visibility-rules-success', onVisibilityRulesSuccess);
    socket.on('visibility-rules-error', onVisibilityRulesError);
    socket.on('alarm-configs-update', handleAlarmConfigsUpdate);
    socket.on('alarm-configs-success', handleAlarmConfigsSuccess);
    socket.on('alarm-configs-error', handleAlarmConfigsError);
    // Cleanup
    return () => {
      socket.off('menu-config-update', onMenuConfigUpdate);
      socket.off('menu-config-success', onMenuConfigSuccess);
      socket.off('menu-config-error', onMenuConfigError);
      socket.off('logging-settings-update', onLoggingSettingsUpdate);
      socket.off('visibility-rules-update', onVisibilityRulesUpdate);
      socket.off('visibility-rules-success', onVisibilityRulesSuccess);
      socket.off('visibility-rules-error', onVisibilityRulesError);
      socket.off('alarm-configs-update', handleAlarmConfigsUpdate);
      socket.off('alarm-configs-success', handleAlarmConfigsSuccess);
      socket.off('alarm-configs-error', handleAlarmConfigsError);
    };
  // Korrigierte Abhängigkeiten: t für Texte, menuForm für Reset, selectedNode zur Prüfung, updateMenuForm Callback
  }, [t, menuForm, selectedNode, updateMenuForm]);

  // --- Callbacks für Menü-Tab ---
  const treeData = useMemo(() => generateTreeData(menuData.menuItems), [menuData.menuItems]); // Nutzt globale Funktion
  const onSelect = useCallback((selectedKeys, info) => { if (info.node && info.node.itemData) { const node = info.node.itemData; setSelectedNode(node); setSelectedNodeKey(info.node.key); updateMenuForm(node); } else { setSelectedNode(null); setSelectedNodeKey(null); menuForm.resetFields(); } }, [menuForm, updateMenuForm]);
  const onFinishMenuItem = useCallback(async () => { if (!selectedNode) { message.error(t('selectMenuItem')); return; } try { const values = await menuForm.validateFields(); setIsLoadingMenu(true); const updatedMenu = produce(menuData, draft => { const updateNode = (items) => { if (!Array.isArray(items)) return false; for (let i = 0; i < items.length; i++) { if (!items[i]) continue; if ((selectedNode.id != null && items[i].id === selectedNode.id) || items[i] === selectedNode) { items[i] = { ...items[i], label: values.label || { value: 'Unnamed', source_type: 'static', source_key: null }, link: values.link || null, svg: values.svg || null, enable: values.enable === true, qhmiVariable: values.qhmiVariable || null, svgConditions: values.svgConditions || [], properties: (values.properties || []).reduce((acc, prop) => { if (prop && prop.key) { if (prop.source_type === 'static') { acc[prop.key] = { value: prop.value, source_type: prop.source_type, source_key: null }; } else { acc[prop.key] = { value: null, source_type: prop.source_type, source_key: prop.source_key }; } } return acc; }, {}), actions: (values.actions || []).reduce((acc, action) => { if (action && action.actionName) { acc[action.actionName] = action.qhmiNames || []; } return acc; }, {}), }; return true; } if (items[i].sub && updateNode(items[i].sub)) return true; } return false; }; if (!updateNode(draft.menuItems)) { console.warn("Selected node not found for update!"); setIsLoadingMenu(false); } }); if (findNodeByReference(updatedMenu.menuItems, selectedNode)) { socket.emit('update-menu-config', updatedMenu); } } catch (info) { console.log('Menu Item Validate Failed:', info); message.error(t('validationFailed')); setIsLoadingMenu(false); } }, [selectedNode, menuData, t, menuForm]);
  const addNewItem = useCallback(() => { setIsLoadingMenu(true); const newItem = { label: { value: 'New Item', source_type: 'static', source_key: '' }, link: `/new-item-${Date.now()}`, svg: 'default', enable: true, qhmiVariable: null, svgConditions: [], properties: {}, actions: {}, sub: [], }; const updatedMenu = produce(menuData, draft => { if (!draft.menuItems) draft.menuItems = []; draft.menuItems.push(newItem); }); socket.emit('update-menu-config', updatedMenu); }, [menuData]);
  const addSubMenu = useCallback(() => { if (!selectedNode) { message.error(t('selectMenuItem')); return; } setIsLoadingMenu(true); const newSubMenu = { label: { value: 'New Submenu', source_type: 'static', source_key: '' }, link: `/new-submenu-${Date.now()}`, svg: 'default', enable: true, qhmiVariable: null, svgConditions: [], properties: {}, actions: {}, sub: [], }; const updatedMenu = produce(menuData, draft => { const addSubRecursive = (items) => { if (!Array.isArray(items)) return false; for (let i = 0; i < items.length; i++) { if (!items[i]) continue; if ((selectedNode.id != null && items[i].id === selectedNode.id) || items[i] === selectedNode) { if (!items[i].sub) items[i].sub = []; items[i].sub.push(newSubMenu); return true; } if (items[i].sub && addSubRecursive(items[i].sub)) return true; } return false; }; addSubRecursive(draft.menuItems); }); socket.emit('update-menu-config', updatedMenu); }, [selectedNode, menuData, t]);
  const duplicateItem = useCallback(() => { if (!selectedNode) { message.error(t('selectMenuItem')); return; } setIsLoadingMenu(true); const deepCopy = (obj) => JSON.parse(JSON.stringify(obj)); const duplicateMenuItemRecursive = (item) => { const newItem = deepCopy(item); delete newItem.id; const labelBase = typeof newItem.label === 'object' ? newItem.label.value : newItem.label; const newLabelValue = `${labelBase || 'Item'} Copy`; if (typeof newItem.label === 'object') newItem.label.value = newLabelValue; else newItem.label = newLabelValue; newItem.link = `${item.link || 'item'}-copy-${Date.now()}`; if (Array.isArray(newItem.sub)) newItem.sub = newItem.sub.map(duplicateMenuItemRecursive); else newItem.sub = []; return newItem; }; const updatedMenu = produce(menuData, draft => { const duplicateInList = (items) => { if (!Array.isArray(items)) return false; let inserted = false; for (let i = items.length - 1; i >= 0; i--) { if (!items[i]) continue; if ((selectedNode.id != null && items[i].id === selectedNode.id) || items[i] === selectedNode) { const duplicate = duplicateMenuItemRecursive(items[i]); items.splice(i + 1, 0, duplicate); inserted = true; break; } if (!inserted && items[i]?.sub && duplicateInList(items[i].sub)) { inserted = true; break; } } return inserted; }; duplicateInList(draft.menuItems); }); socket.emit('update-menu-config', updatedMenu); }, [selectedNode, menuData, t]);
  const deleteItem = useCallback(() => { if (!selectedNode) { message.error(t('selectMenuItem')); return; } setIsLoadingMenu(true); const currentSelectedNodeId = selectedNode?.id; const currentSelectedNodeRef = selectedNode; const updatedMenu = produce(menuData, draft => { const deleteRecursive = (items) => { if (!Array.isArray(items)) return false; for (let i = 0; i < items.length; i++) { if (!items[i]) continue; const nodeMatches = (currentSelectedNodeId != null && items[i].id === currentSelectedNodeId) || items[i] === currentSelectedNodeRef; if (nodeMatches) { items.splice(i, 1); return true; } if (items[i].sub && deleteRecursive(items[i].sub)) return true; } return false; }; deleteRecursive(draft.menuItems); }); setSelectedNode(null); setSelectedNodeKey(null); menuForm.resetFields(); socket.emit('update-menu-config', updatedMenu); }, [selectedNode, menuData, t, menuForm]);

  // --- Callbacks für Logging-Tab ---
  const handleDeletePage = useCallback((pageToDelete) => { const updatedPages = tempPages.filter(p => p !== pageToDelete); setTempPages(updatedPages); const updatedSettings = tempLoggingSettings.map(setting => { if (setting.page) { const pages = setting.page.split(',').map(p => p.trim()); const filteredPages = pages.filter(p => p !== pageToDelete); return { ...setting, page: filteredPages.join(',') }; } return setting; }); setTempLoggingSettings(updatedSettings); }, [tempPages, tempLoggingSettings]);
  const handleDeleteLoggingSetting = useCallback((topic) => { setTempLoggingSettings(currentSettings => currentSettings.filter(setting => setting.topic !== topic)); }, []);
  const handleToggleLoggingSetting = useCallback((topic) => { setTempLoggingSettings(currentSettings => currentSettings.map(setting => setting.topic === topic ? { ...setting, enabled: !setting.enabled } : setting)); }, []);
  const handleColorChange = useCallback((topic, color) => { setTempLoggingSettings(currentSettings => currentSettings.map(setting => setting.topic === topic ? { ...setting, color } : setting)); }, []);
  const handlePageChange = useCallback((topic, pagesArray) => { setTempLoggingSettings(currentSettings => currentSettings.map(setting => setting.topic === topic ? { ...setting, page: Array.isArray(pagesArray) ? pagesArray.sort().join(',') : '' } : setting)); }, []);
  const handleDescriptionChange = useCallback((topic, description) => { setTempLoggingSettings(currentSettings => currentSettings.map(setting => setting.topic === topic ? { ...setting, description } : setting)); }, []);
  const handleUnitChange = useCallback((topic, unit) => { setTempLoggingSettings(currentSettings => currentSettings.map(setting => setting.topic === topic ? { ...setting, unit } : setting)); }, []);
  const handleAddPage = useCallback(() => { if (newPage.trim() && !tempPages.includes(newPage.trim())) { const updatedPages = [...tempPages, newPage.trim()].sort(); setTempPages(updatedPages); setNewPage(''); } else if (tempPages.includes(newPage.trim())) { message.error(t('pageAlreadyExists')); } }, [newPage, tempPages, t]);
  const handleAddLoggingSetting = useCallback(() => { if (newLoggingTopic.trim() && selectedPageForTopic) { const topicToAdd = newLoggingTopic.trim(); setTempLoggingSettings(currentSettings => { const existingSettingIndex = currentSettings.findIndex(setting => setting.topic === topicToAdd); if (existingSettingIndex > -1) { const setting = currentSettings[existingSettingIndex]; const currentPages = setting.page ? setting.page.split(',').map(p => p.trim()) : []; if (!currentPages.includes(selectedPageForTopic)) { const updatedPages = [...currentPages, selectedPageForTopic].sort().join(','); const newSettings = [...currentSettings]; newSettings[existingSettingIndex] = {...setting, page: updatedPages}; return newSettings; } else { message.warning(t('topicAlreadyOnPage')); return currentSettings; } } else { return [ ...currentSettings, { topic: topicToAdd, enabled: true, color: predefinedColors[currentSettings.length % predefinedColors.length], page: selectedPageForTopic, description: '', unit: '', } ]; } }); setNewLoggingTopic(''); setSelectedPageForTopic(null); } else { message.error(t('selectPageAndTopic')); } }, [newLoggingTopic, selectedPageForTopic, t]);
  const handleSaveLoggingSettings = useCallback(() => { setIsLoadingLogging(true); socket.emit('update-pages-and-settings', { pages: tempPages, settings: tempLoggingSettings, }); }, [tempPages, tempLoggingSettings]);
  const generateLoggingTreeData = useCallback((settings, pages) => { const pageMap = {}; pages.forEach(page => { pageMap[page] = new Set(); }); settings.forEach(setting => { const assignedPages = setting.page ? setting.page.split(',').map(p => p.trim()) : []; assignedPages.forEach(page => { if (pageMap[page]) { pageMap[page].add(setting); } }); }); return pages.map(page => ({ title: ( <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}> <span style={{ fontWeight: 'bold' }}>{page}</span> <Popconfirm title={t('confirmDeletePage')} onConfirm={() => handleDeletePage(page)} okText={t('yes')} cancelText={t('no')}> <Button size="small" danger icon={<DeleteOutlined />} /> </Popconfirm> </div> ), key: `page-${page}`, children: Array.from(pageMap[page] || []).sort((a, b) => a.topic.localeCompare(b.topic)).map(setting => ({ title: ( <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '2px 0' }}> <span style={{ minWidth: '150px', flexShrink: 0 }}>{setting.topic}</span> <Switch checked={setting.enabled !== false} onChange={() => handleToggleLoggingSetting(setting.topic)} checkedChildren={t('Enabled')} unCheckedChildren={t('Disabled')} size="small"/> <Select size="small" value={setting.color || predefinedColors[0]} onChange={(value) => handleColorChange(setting.topic, value)} style={{ width: 100 }}>{predefinedColors.map((colorOption) => (<Option key={colorOption} value={colorOption} style={{ padding: '4px 8px' }}><div style={{ display: 'flex', alignItems: 'center' }}><div style={{ width: 14, height: 14, backgroundColor: colorOption, marginRight: 5, border: '1px solid #555', borderRadius: '2px' }}/></div></Option>))}</Select> <Select size="small" mode="multiple" allowClear placeholder={t('Select Pages')} value={setting.page ? setting.page.split(',').map(p => p.trim()) : []} onChange={(value) => handlePageChange(setting.topic, value)} style={{ minWidth: 150, flexGrow: 1 }}>{tempPages.map(p => (<Option key={p} value={p}>{p}</Option>))}</Select> <Input size="small" value={setting.description || ''} onChange={(e) => handleDescriptionChange(setting.topic, e.target.value)} placeholder={t('Description')} style={{ width: 150 }}/> <Input size="small" value={setting.unit || ''} onChange={(e) => handleUnitChange(setting.topic, e.target.value)} placeholder={t('Unit')} style={{ width: 60 }}/> <Popconfirm title={t('confirmDeleteTopic')} onConfirm={() => handleDeleteLoggingSetting(setting.topic)} okText={t('yes')} cancelText={t('no')}> <Button size="small" danger icon={<DeleteOutlined />} /> </Popconfirm> </div> ), key: `topic-${setting.topic}-${page}`, isLeaf: true, })), })); }, [t, tempPages, handleDeletePage, handleToggleLoggingSetting, handleColorChange, handlePageChange, handleDescriptionChange, handleUnitChange, handleDeleteLoggingSetting]);
  const loggingTreeData = useMemo(() => generateLoggingTreeData(tempLoggingSettings, tempPages), [generateLoggingTreeData, tempLoggingSettings, tempPages]);

  // --- Callbacks für Rules-Tab ---
  const handleSaveVisibilityRules = useCallback((updatedRules) => { console.log("[MenuConfigModal] Saving visibility rules:", updatedRules); setIsLoadingRules(true); socket.emit('update-visibility-rules', updatedRules); }, []);

  // --- Callbacks für Alarm-Tab ---
  const handleAddAlarmConfig = useCallback(() => { setEditingAlarmConfig({ id: null, mqtt_topic: '', description: '', definitions: [] }); alarmConfigForm.resetFields(); alarmConfigForm.setFieldsValue({ definitions: Array(16).fill(null).map((_, i) => ({ bit_number: i, alarm_text_key: '', priority: 'info', enabled: false })) }); setIsAlarmConfigModalVisible(true); }, [alarmConfigForm]);
  const handleEditAlarmConfig = useCallback((record) => { const existingDefs = new Map(); (record.definitions || []).forEach(def => existingDefs.set(def.bit_number, def)); const fullDefinitions = Array(16).fill(null).map((_, i) => { return existingDefs.get(i) || { id: null, config_id: record.id, bit_number: i, alarm_text_key: '', priority: 'info', enabled: false }; }); /* Add id: null */ setEditingAlarmConfig({ ...record, definitions: fullDefinitions }); alarmConfigForm.resetFields(); alarmConfigForm.setFieldsValue({ mqtt_topic: record.mqtt_topic, description: record.description, definitions: fullDefinitions }); setIsAlarmConfigModalVisible(true); }, [alarmConfigForm]);
  const handleDeleteAlarmConfig = useCallback((configIdToDelete) => { setIsLoadingAlarms(true); const updatedConfigs = alarmConfigs.filter(conf => conf.id !== configIdToDelete); socket.emit('update-alarm-configs', updatedConfigs); }, [alarmConfigs]);
  const handleSaveAlarmConfig = useCallback(async () => { try { const values = await alarmConfigForm.validateFields();
        // DEBUG LOG
        console.log('--- DEBUG: Saving Alarm Config ---');
        console.log('Form values:', values);
        console.log('Editing existing config:', editingAlarmConfig);
        console.log('Definitions array length:', Array.isArray(values.definitions) ? values.definitions.length : 'Not an array');
        if (Array.isArray(values.definitions) && values.definitions.length > 0) { console.log('First definition object:', values.definitions[0]); }
        // END DEBUG LOG
        setIsLoadingAlarms(true); let updatedConfigs; const configToSave = { id: editingAlarmConfig?.id, mqtt_topic: values.mqtt_topic, description: values.description, definitions: values.definitions }; if (editingAlarmConfig?.id) { updatedConfigs = alarmConfigs.map(conf => conf.id === editingAlarmConfig.id ? configToSave : conf ); } else { updatedConfigs = [...alarmConfigs, configToSave]; } console.log("[MenuConfigModal] Sending update-alarm-configs event with data:", updatedConfigs); socket.emit('update-alarm-configs', updatedConfigs); setIsAlarmConfigModalVisible(false); setEditingAlarmConfig(null); } catch (errorInfo) { console.log('Alarm Config Validate Failed:', errorInfo); message.error(t('validationFailed')); setIsLoadingAlarms(false); } }, [alarmConfigForm, editingAlarmConfig, alarmConfigs, t]);

  // --- Callbacks für CSV-Tab ---
  const handleExportVariables = useCallback(() => { console.log("Exportiere Variablen..."); window.location.href = `${BACKEND_BASE_URL}/db/export/variables.csv`; }, []);
  const uploadProps = useMemo(() => ({ name: 'csvfile', action: `${BACKEND_BASE_URL}/db/import/variables`, accept: '.csv', showUploadList: false, beforeUpload: (file) => { const isCsv = file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv'); if (!isCsv) { message.error(t('uploadErrorNotCsv', 'Sie können nur CSV-Dateien hochladen!')); } const isLt10M = file.size / 1024 / 1024 < 10; if (!isLt10M) { message.error(t('uploadErrorSizeLimit', 'Datei muss kleiner als 10MB sein!')); } if (isCsv && isLt10M) { setIsUploading(true); } return isCsv && isLt10M ? true : Upload.LIST_IGNORE; }, onChange: (info) => { if (info.file.status === 'uploading') { return; } setIsUploading(false); if (info.file.status === 'done') { if (info.file.response?.message) { if (info.file.response.errors && info.file.response.errors.length > 0) { message.warning(`${info.file.response.message} (${t('detailsInConsole', 'Details in Konsole')})`, 6); console.warn("Importfehler Details:", info.file.response.errors); } else { message.success(`${info.file.response.message} (I: ${info.file.response.inserted || 0}, U: ${info.file.response.updated || 0}, S: ${info.file.response.skipped || 0})`, 5); } socket.emit('request-settings', { user: null }); } else { message.success(t('uploadSuccess', '{filename} erfolgreich hochgeladen.', { filename: info.file.name })); socket.emit('request-settings', { user: null }); } } else if (info.file.status === 'error') { console.error("Upload fehlgeschlagen:", info.file.response, info.file.error); let errorMsg = t('uploadError', '{filename} Upload fehlgeschlagen.', { filename: info.file.name }); if (info.file.response?.error) { errorMsg = `${errorMsg} ${t('reason', 'Grund')}: ${info.file.response.error}`; if(info.file.response.details) { errorMsg += ` ${t('details', 'Details')}: ${info.file.response.details}`; } } else if (info.xhr?.statusText) { errorMsg += ` Status: ${info.xhr.statusText}`; } else if (info.file.error?.message) { errorMsg += ` ${t('error', 'Fehler')}: ${info.file.error.message}`; } message.error(errorMsg, 7); } }, }), [t]);


  // --- Render-Methode ---
  return (
    <Modal
      title={t('Configuration')}
      open={visible}
      onCancel={onClose}
      footer={null}
      width={1100}
      centered
      destroyOnClose
      style={{ top: 20 }}
      styles={{ body: { backgroundColor: '#141414', color: '#fff', padding: '20px', minHeight: '70vh', maxHeight: '85vh', overflowY: 'hidden' } }}
    >
      <Tabs defaultActiveKey="1" style={{ color: '#fff', height: '100%', display: 'flex', flexDirection: 'column' }}>

        {/* --- Tab: Menu Settings --- */}
        <TabPane tab={t('Menu Settings', 'Menü Einstellungen')} key="1" style={{ flexGrow: 1, overflow: 'hidden' }}>
           {isLoadingMenu && <div style={{ textAlign: 'center', padding: 20 }}><Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} /></div>}
           {!isLoadingMenu && (
                <div style={{ display: 'flex', gap: '20px', height: 'calc(100% - 40px)' }}>
                   {/* Linke Spalte */}
                   <div style={{ flex: '0 0 350px', display: 'flex', flexDirection: 'column' }}>
                       <div style={{ marginBottom: '10px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}> <Button icon={<PlusOutlined />} onClick={addNewItem} disabled={isLoadingMenu}>{t('addItem', 'Eintrag hinzufügen')}</Button> <Button type="default" icon={<PlusOutlined />} onClick={addSubMenu} disabled={!selectedNode || isLoadingMenu}>{t('addSubMenu', 'Untermenü hinzufügen')}</Button> </div>
                       <Divider style={{ backgroundColor: '#434343', margin: '10px 0' }} />
                       <div style={{ flexGrow: 1, overflowY: 'auto', border: '1px solid #434343', borderRadius: '4px', background: '#1f1f1f' }}> <Tree treeData={treeData} onSelect={onSelect} selectedKeys={selectedNodeKey ? [selectedNodeKey] : []} style={{ backgroundColor: 'transparent', color: '#fff', padding: '5px' }} blockNode autoExpandParent /> </div>
                   </div>
                   {/* Rechte Spalte */}
                   <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                     {selectedNode ? ( <> <div style={{ flexGrow: 1, overflowY: 'auto', paddingRight: '10px' }}> <Form form={menuForm} layout="vertical" name="menuItemForm" onFinish={onFinishMenuItem} style={{ color: '#fff' }}> {/* Formularinhalt */} </Form> </div> <div style={{ borderTop: '1px solid #434343', paddingTop: '10px', background: '#141414', flexShrink: 0 }}> <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}> <Button icon={<CopyOutlined />} onClick={duplicateItem} /*...*/ /> <Popconfirm /*...*/><Button danger icon={<DeleteOutlined />} /*...*/ /></Popconfirm> <Button type="primary" onClick={() => menuForm.submit()} /*...*/ /> </div> </div> </> ) : ( <p style={{ textAlign: 'center', marginTop: '20px' }}>{t('selectMenuItemToEdit', 'Menüeintrag zum Bearbeiten auswählen.')}</p> )}
                   </div>
                </div>
            )}
        </TabPane>

        {/* --- Tab: Visibility Rules --- */}
        <TabPane tab={t('Rules', 'Regeln')} key="3" style={{ flexGrow: 1, overflowY: 'auto' }}>
             {isLoadingRules && <div style={{ textAlign: 'center', padding: 20 }}><Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} /></div>}
            {!isLoadingRules && <RulesConfigTab rules={visibilityRules} onSave={handleSaveVisibilityRules} />}
        </TabPane>

        {/* --- Tab: Logging Settings --- */}
        <TabPane tab={t('Logging Settings', 'Logging Einstellungen')} key="2" style={{ flexGrow: 1, overflowY: 'auto', padding: '20px' }}>
             {isLoadingLogging && <div style={{ textAlign: 'center', padding: 20, flexGrow: 1 }}><Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} /></div>}
            {!isLoadingLogging && (<>
                <div style={{ flexShrink: 0 }}>
                    <Form layout="inline" onFinish={handleAddPage} style={{ marginBottom: '10px', padding: '10px', background: '#1f1f1f', borderRadius: '4px' }}> <Form.Item><Input placeholder={t('New Page', 'Neue Seite')} value={newPage} onChange={(e) => setNewPage(e.target.value)} style={{ width: '200px' }} /></Form.Item> <Form.Item><Button type="primary" htmlType="submit" style={{ backgroundColor: '#ffb000', borderColor: '#ffb000' }}>{t('Add Page', 'Seite hinzufügen')}</Button></Form.Item> </Form>
                    <Form layout="inline" onFinish={handleAddLoggingSetting} style={{ marginBottom: '10px', padding: '10px', background: '#1f1f1f', borderRadius: '4px' }}> <Form.Item><Input placeholder={t('New Topic', 'Neuer Topic')} value={newLoggingTopic} onChange={(e) => setNewLoggingTopic(e.target.value)} style={{ width: '250px' }} /></Form.Item> <Form.Item><Select placeholder={t('Select Page', 'Seite auswählen')} value={selectedPageForTopic} onChange={(value) => setSelectedPageForTopic(value)} style={{ width: '180px' }} allowClear>{tempPages.map(page => (<Option key={page} value={page}>{page}</Option>))}</Select></Form.Item> <Form.Item><Button type="primary" htmlType="submit" style={{ backgroundColor: '#ffb000', borderColor: '#ffb000' }}>{t('Add Topic', 'Topic hinzufügen')}</Button></Form.Item> </Form>
                </div>
                <div style={{ flexGrow: 1, border: '1px solid #434343', borderRadius: '4px', background: '#1f1f1f', padding: '5px', marginTop: '10px', overflow: 'hidden' }}> {/* Overflow hidden hier */}
                    <div style={{ height: '100%', overflowY: 'auto' }}> {/* Innerer scrollbarer Container */}
                         <Tree treeData={loggingTreeData} defaultExpandAll style={{ backgroundColor: 'transparent' }} blockNode />
                    </div>
                </div>
                <div style={{ marginTop: '10px', textAlign: 'right', flexShrink: 0, borderTop: '1px solid #434343', paddingTop: '10px', background: '#141414', position: 'sticky', bottom: '-20px', marginLeft: '-20px', marginRight: '-20px', padding: '10px 20px' }}>
                 <Button type="primary" icon={<SaveOutlined />} onClick={handleSaveLoggingSettings} loading={isLoadingLogging} style={{ backgroundColor: '#ffb000', borderColor: '#ffb000' }}>
                   {t('Save Logging Settings', 'Logging Einstellungen speichern')}
                 </Button>
               </div>
             </>)}
        </TabPane>

        {/* --- Tab: Data Management (CSV) --- */}
        <TabPane tab={t('Data Management', 'Datenverwaltung')} key="4" style={{ flexGrow: 1, overflowY: 'auto', padding: '20px' }}>
             <Space direction="vertical" size="large" style={{ width: '100%' }}>
                 <div> <h3 style={{ color: '#fff' }}>{t('Export Variables', 'Variablen Exportieren')}</h3> <p style={{ color: '#ccc' }}>{t('ExportDesc', 'Exportieren Sie alle aktuellen Variablen-Einstellungen als CSV-Datei.')}</p> <Button icon={<DownloadOutlined />} onClick={handleExportVariables} style={{ backgroundColor: '#333', borderColor: '#555', color: '#fff' }}> {t('Export CSV', 'CSV Exportieren')} </Button> </div>
                 <Divider style={{ backgroundColor: '#434343' }} />
                 <div> <h3 style={{ color: '#fff' }}>{t('Import Variables', 'Variablen Importieren')}</h3> <p style={{ color: '#ccc' }}>{t('ImportDesc', 'Importieren Sie Variablen-Einstellungen aus einer CSV-Datei. Bestehende Variablen mit demselben Namen werden aktualisiert, neue werden hinzugefügt.')}</p> <Upload {...uploadProps}> <Button icon={<UploadOutlined />} loading={isUploading} style={{ backgroundColor: '#333', borderColor: '#555', color: '#fff' }}> {isUploading ? t('Uploading...', 'Lädt hoch...') : t('Import CSV', 'CSV Importieren')} </Button> </Upload> <p style={{ color: '#aaa', marginTop: '10px', fontSize: '12px' }}> {t('ImportNote', 'Hinweis: Die CSV muss die Spalte "NAME" als eindeutigen Schlüssel enthalten. Spaltenüberschriften müssen mit den Datenbankspalten übereinstimmen.')} </p> </div>
            </Space>
        </TabPane>

        {/* --- Tab: Alarms --- */}
        <TabPane tab={t('Alarms', 'Alarme')} key="5" style={{ flexGrow: 1, overflowY: 'auto', padding: '20px' }}>
             <Spin spinning={isLoadingAlarms}>
                 <Button type="primary" icon={<PlusOutlined />} onClick={handleAddAlarmConfig} style={{ marginBottom: 16, backgroundColor: '#ffb000', borderColor: '#ffb000' }}> {t('addAlarmTopic', 'Alarm-Topic hinzufügen')} </Button>
                 <Table columns={alarmConfigColumns(handleEditAlarmConfig, handleDeleteAlarmConfig, t)} dataSource={alarmConfigs} rowKey="id" pagination={{ pageSize: 10 }} style={{ backgroundColor: '#1f1f1f' }} locale={{ emptyText: t('noAlarmConfigs', 'Keine Alarm-Topics konfiguriert') }} size="small" />
             </Spin>
        </TabPane>

      </Tabs>

      {/* --- Alarm Configuration Detail Modal --- */}
      <Modal
          title={editingAlarmConfig?.id ? t('editAlarmConfig', 'Alarmkonfiguration bearbeiten') : t('addAlarmConfig', 'Alarmkonfiguration hinzufügen')}
          open={isAlarmConfigModalVisible}
          onOk={handleSaveAlarmConfig}
          onCancel={() => setIsAlarmConfigModalVisible(false)}
          okText={t('save', 'Speichern')}
          cancelText={t('cancel', 'Abbrechen')}
          width={900}
          maskClosable={false}
          destroyOnClose
          styles={{ body: { backgroundColor: '#1f1f1f', color: '#fff', maxHeight: '70vh', overflowY: 'auto' }, header: { backgroundColor: '#1f1f1f', color: '#fff', borderBottom: '1px solid #434343' }, footer: { borderTop: '1px solid #434343' } }}
      >
          <Form form={alarmConfigForm} layout="vertical" name="alarmConfigDetailForm">
              <Item name="mqtt_topic" label={t('alarm_identifier', 'Alarm Wort Identifier / Key')} rules={[{ required: true, message: t('validation_identifier_required', 'Bitte geben Sie den Identifier an!') }]} tooltip={t('alarm_identifier_tooltip', 'Dieser Name muss mit dem "topic"-Feld in den Nachrichten auf modbus/data übereinstimmen.')}>
                  <Input placeholder="z.B. Alarme_Heizung_1" />
              </Item>
              <Item name="description" label={t('description', 'Beschreibung')}>
                  <Input.TextArea rows={2} placeholder="Optionale Beschreibung für dieses Alarm Wort" />
              </Item>
              <Divider orientation="left" style={{ color: '#aaa', borderColor: '#434343' }}>{t('bitDefinitions', 'Bit-Definitionen (0-15)')}</Divider>
              <div style={{ maxHeight: 'calc(70vh - 250px)', overflowY: 'auto', border: '1px solid #333', borderRadius: '4px', padding: '0 8px' }}>
              <Form.List name="definitions">
                  {(fields) => (
                       <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                           <thead style={{ position: 'sticky', top: 0, background: '#1f1f1f', zIndex: 1 }}>
                               <tr>
                                   <th style={{ width: '6%', textAlign: 'center', padding: '8px 4px' }}>{t('bit', 'Bit')}</th>
                                   <th style={{ width: '40%', paddingLeft: '8px' }}>{t('alarmTextKey', 'Alarmtext-Schlüssel')} <Tooltip title={t('alarmTextKeyTooltip', 'Dieser Schlüssel wird für die Übersetzung des Alarmtexts verwendet (z.B. ALARM_PUMP1_LOW_PRESSURE). Fügen Sie die Übersetzungen in i18n.js hinzu.')}><QuestionCircleOutlined style={{ marginLeft: 4, color: '#aaa', cursor: 'help'}} /></Tooltip></th>
                                   <th style={{ width: '27%' }}>{t('priority', 'Priorität')}</th>
                                   <th style={{ width: '17%', textAlign: 'center' }}>{t('enabled', 'Aktiviert')}</th>
                                   <th style={{ width: '10%', textAlign: 'center' }}></th>
                               </tr>
                           </thead>
                           <tbody>
                               {fields.map(({ key, name, ...restField }, index) => (
                                   <tr key={key} style={{ borderBottom: '1px solid #333', verticalAlign: 'top' }}>
                                       <td style={{ textAlign: 'center', fontWeight: 'bold', padding: '8px 4px' }}>
                                            {index}
                                            <Item {...restField} name={[name, 'bit_number']} initialValue={index} noStyle><Input type="hidden" /></Item>
                                            <Item {...restField} name={[name, 'id']} noStyle><Input type="hidden" /></Item>
                                        </td>
                                       <td style={{ padding: '8px 4px' }}>
                                           <Item {...restField} name={[name, 'alarm_text_key']} rules={[{ required: alarmConfigForm.getFieldValue(['definitions', name, 'enabled']), message: t('validation_textKey_required', 'Schlüssel benötigt, wenn Bit aktiviert') }]} style={{ marginBottom: 0 }}>
                                               <Input placeholder="z.B. ALARM_XYZ" size="small" />
                                           </Item>
                                       </td>
                                       <td style={{ padding: '8px 4px' }}>
                                           <Item {...restField} name={[name, 'priority']} initialValue="info" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                                               <Select size="small" style={{ width: '100%' }}>{alarmPriorities.map(prio => (<Option key={prio} value={prio}>{t(`priority_${prio}`, prio)}</Option>))} </Select>
                                           </Item>
                                       </td>
                                       <td style={{ textAlign: 'center', padding: '12px 4px' }}>
                                            <Item {...restField} name={[name, 'enabled']} valuePropName="checked" initialValue={false} style={{ marginBottom: 0 }}>
                                                <Switch size="small" />
                                            </Item>
                                       </td>
                                       <td></td>
                                   </tr>
                               ))}
                           </tbody>
                       </table>
                   )}
              </Form.List>
              </div>
          </Form>
      </Modal>

    </Modal>
  );
};

export default MenuConfigModal;