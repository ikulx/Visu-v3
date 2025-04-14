import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Modal, Tabs, Form, Input, Button, Select, Switch, Tree, message, Divider, Table, Popconfirm, Space, Spin } from 'antd'; // Space, Spin hinzugefügt
import { PlusOutlined, DeleteOutlined, CopyOutlined, SaveOutlined, EditOutlined, LoadingOutlined } from '@ant-design/icons'; // EditOutlined, LoadingOutlined hinzugefügt
import socket from '../socket';
import { useTranslation } from 'react-i18next';
import { produce } from 'immer'; // Immer importieren für einfachere State Updates
// RULES: Import the new component
import RulesConfigTab from './RulesConfigTab'; // Passe den Pfad ggf. an

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
  const [isLoadingMenu, setIsLoadingMenu] = useState(false); // Hinzugefügt
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedNodeKey, setSelectedNodeKey] = useState(null); // Hinzugefügt für Tree-Selektion
  const [loggingSettings, setLoggingSettings] = useState([]);
  const [isLoadingLogging, setIsLoadingLogging] = useState(false); // Hinzugefügt
  const [tempLoggingSettings, setTempLoggingSettings] = useState([]);
  const [pages, setPages] = useState([]);
  const [tempPages, setTempPages] = useState([]);
  const [newPage, setNewPage] = useState('');
  const [newTopic, setNewTopic] = useState('');
  const [selectedPageForTopic, setSelectedPageForTopic] = useState(null);
  // RULES: State für Regeln hinzugefügt
  const [visibilityRules, setVisibilityRules] = useState([]);
  const [isLoadingRules, setIsLoadingRules] = useState(false); // Hinzugefügt

  // Funktion zum Finden eines Knotens anhand seiner Daten (Referenz oder ID)
  const findNodeByReference = (items, nodeToFind) => {
        if (!Array.isArray(items) || !nodeToFind) return null;
        for (const item of items) {
            if (!item) continue;
            // ID bevorzugen, da Referenz sich ändern kann
            if ((nodeToFind.id != null && item.id === nodeToFind.id) || item === nodeToFind) {
                return item;
            }
            if (item.sub) {
                const found = findNodeByReference(item.sub, nodeToFind);
                if (found) return found;
            }
        }
        return null;
    };

  // Funktion zum Generieren eines stabilen Keys für Tree-Nodes
  const generateNodeKey = (item, index, parentKey = 'root') => {
    if (!item) return `${parentKey}-invalid-${index}`;
    const labelPart = typeof item.label === 'object' && item.label !== null
        ? (item.label.value || `item-${index}`)
        : (item.label || `item-${index}`);
    // ID bevorzugen, sonst Kombination
    return item.id != null ? `item-${item.id}` : `${parentKey}-${item.link || labelPart}-${index}`;
  };

  // Daten anfordern, wenn das Modal geöffnet wird
  useEffect(() => {
    if (visible) {
      console.log("MenuConfigModal visible: Requesting data...");
      setIsLoadingMenu(true); // Laden anzeigen
      setIsLoadingLogging(true); // Laden anzeigen
      setIsLoadingRules(true); // RULES: Laden anzeigen
      socket.emit('request-menu-config');
      socket.emit('request-logging-settings');
      socket.emit('request-visibility-rules'); // RULES: Regeln anfordern
    } else {
        // Reset states when modal is closed (optional, depends on desired behavior)
        setIsLoadingMenu(false);
        setIsLoadingLogging(false);
        setIsLoadingRules(false);
        setSelectedNode(null);
        setSelectedNodeKey(null);
        form.resetFields();
        // Temporäre Änderungen ggf. verwerfen oder beibehalten? Hier verwerfen:
        setTempLoggingSettings(loggingSettings);
        setTempPages(pages);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]); // Nur von 'visible' abhängig

  // Formular aktualisieren (Callback)
  const updateForm = useCallback((node) => {
        if (!node) { form.resetFields(); return; }
        const labelField = typeof node.label === 'object' && node.label !== null ? node.label : { value: node.label, source_type: 'static', source_key: '' };
        const properties = node.properties || {};
        const actions = node.actions || {};

        form.setFieldsValue({
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
      }, [form]);

  // Helper to find the key of a node within the current menuData structure
  const findKeyInTree = useCallback((items, nodeToFind, parentKey = 'root') => {
        if (!Array.isArray(items) || !nodeToFind) return null;
        for (let index = 0; index < items.length; index++) {
            const item = items[index];
            if (!item) continue;
            const key = generateNodeKey(item, index, parentKey);
            // ID bevorzugen für Vergleich
            if ((nodeToFind.id != null && item.id === nodeToFind.id) || item === nodeToFind) {
                return key;
            }
            if (item.sub) {
                const foundKey = findKeyInTree(item.sub, nodeToFind, key);
                if (foundKey) return foundKey;
            }
        }
        return null;
    }, [generateNodeKey]); // Hängt von generateNodeKey ab

  // Socket.IO-Listener für Updates
  useEffect(() => {
    const onMenuConfigUpdate = (data) => {
      console.log('Menu config update received:', data ? 'Data received' : 'No data');
      const newMenuData = data && Array.isArray(data.menuItems) ? data : { menuItems: [] };
      setMenuData(newMenuData);
      setIsLoadingMenu(false);
      if (selectedNode) {
           const stillSelectedNode = findNodeByReference(newMenuData.menuItems, selectedNode);
           if (stillSelectedNode) {
              setSelectedNode(stillSelectedNode); updateForm(stillSelectedNode);
              const newKey = findKeyInTree(newMenuData.menuItems, stillSelectedNode);
              setSelectedNodeKey(newKey);
           } else { setSelectedNode(null); setSelectedNodeKey(null); form.resetFields(); }
       }
    };
    const onMenuConfigSuccess = (response) => {
      console.log('Menu config save successful:', response.message);
       if (response.menu && Array.isArray(response.menu.menuItems)) {
          setMenuData(response.menu); setIsLoadingMenu(false);
           if (selectedNode) {
              const stillSelectedNode = findNodeByReference(response.menu.menuItems, selectedNode);
               if (stillSelectedNode) { setSelectedNode(stillSelectedNode); updateForm(stillSelectedNode); const newKey = findKeyInTree(response.menu.menuItems, stillSelectedNode); setSelectedNodeKey(newKey);
               } else { setSelectedNode(null); setSelectedNodeKey(null); form.resetFields(); }
           }
       } else { setIsLoadingMenu(false); }
      message.success(response.message || t('menuUpdated'));
    };
    const onMenuConfigError = (error) => { console.error('Menu config save error:', error.message); setIsLoadingMenu(false); message.error(t('menuUpdateFailed', { message: error.message })); };
    const onLoggingSettingsUpdate = (data) => {
      console.log('Logging settings received:', data ? `${data.length} settings` : 'No data');
      const validData = Array.isArray(data) ? data : [];
      setLoggingSettings(validData); setTempLoggingSettings(validData);
      const uniquePages = [...new Set(validData.filter(s => s.page).flatMap(s => s.page.split(',').map(p => p.trim())))].sort();
      setPages(uniquePages); setTempPages(uniquePages); setIsLoadingLogging(false);
    };

    // RULES: Listener für Regeln hinzugefügt
    const onVisibilityRulesUpdate = (data) => {
        console.log('Visibility rules received:', data ? `${data.length} rules` : 'No data');
        setVisibilityRules(Array.isArray(data) ? data : []);
        setIsLoadingRules(false);
    };
    const onVisibilityRulesSuccess = (response) => {
         message.success(response.message || t('rulesSaved'));
         setIsLoadingRules(false);
         // Die neuen Regeln kommen über 'visibility-rules-update'
    };
    const onVisibilityRulesError = (error) => {
         message.error(error.message || t('rulesSaveFailed'));
         setIsLoadingRules(false);
    };

    // Listener registrieren
    socket.on('menu-config-update', onMenuConfigUpdate);
    socket.on('menu-config-success', onMenuConfigSuccess);
    socket.on('menu-config-error', onMenuConfigError);
    socket.on('logging-settings-update', onLoggingSettingsUpdate);
    socket.on('visibility-rules-update', onVisibilityRulesUpdate);
    socket.on('visibility-rules-success', onVisibilityRulesSuccess);
    socket.on('visibility-rules-error', onVisibilityRulesError);

    return () => {
      // Listener deregistrieren
      socket.off('menu-config-update', onMenuConfigUpdate);
      socket.off('menu-config-success', onMenuConfigSuccess);
      socket.off('menu-config-error', onMenuConfigError);
      socket.off('logging-settings-update', onLoggingSettingsUpdate);
      socket.off('visibility-rules-update', onVisibilityRulesUpdate);
      socket.off('visibility-rules-success', onVisibilityRulesSuccess);
      socket.off('visibility-rules-error', onVisibilityRulesError);
    };
  }, [t, form, updateForm, selectedNode, findKeyInTree]); // Abhängigkeiten aktualisiert

  // --- Menu Item Tree and Form Logic ---
  const generateTreeData = useCallback((items, parentKey = 'root') => {
     if (!Array.isArray(items)) return [];
     return items.map((item, index) => {
         if (!item) return null;
         const key = generateNodeKey(item, index, parentKey);
         const labelText = typeof item.label === 'object' && item.label !== null ? (item.label.value || `Item ${index + 1}`) : (item.label || `Item ${index + 1}`);
         return { title: `${labelText} (${item.link || '-'})`, key: key, children: generateTreeData(item.sub, key), itemData: item, };
     }).filter(Boolean);
  }, [generateNodeKey]);

  const treeData = useMemo(() => generateTreeData(menuData.menuItems), [menuData.menuItems, generateTreeData]);

  const onSelect = useCallback((selectedKeys, info) => {
    if (info.node && info.node.itemData) {
      const node = info.node.itemData;
      setSelectedNode(node);
      setSelectedNodeKey(info.node.key); // Key speichern
      updateForm(node);
    } else {
      setSelectedNode(null);
      setSelectedNodeKey(null); // Key zurücksetzen
      form.resetFields();
    }
  }, [form, updateForm]);

  // --- Form Handlers ---
  const onFinishMenuItem = useCallback(async () => {
    if (!selectedNode) { message.error(t('selectMenuItem')); return; }
    try {
        const values = await form.validateFields();
        setIsLoadingMenu(true);
        const updatedMenu = produce(menuData, draft => {
            const updateNode = (items) => {
                if (!Array.isArray(items)) return false;
                for (let i = 0; i < items.length; i++) { if (!items[i]) continue; if ((selectedNode.id != null && items[i].id === selectedNode.id) || items[i] === selectedNode) { items[i] = { ...items[i], label: values.label || { value: 'Unnamed', source_type: 'static', source_key: null }, link: values.link || null, svg: values.svg || null, enable: values.enable === true, qhmiVariable: values.qhmiVariable || null, svgConditions: values.svgConditions || [], properties: (values.properties || []).reduce((acc, prop) => { if (prop && prop.key) { if (prop.source_type === 'static') { acc[prop.key] = { value: prop.value, source_type: prop.source_type, source_key: null }; } else { acc[prop.key] = { value: null, source_type: prop.source_type, source_key: prop.source_key }; } } return acc; }, {}), actions: (values.actions || []).reduce((acc, action) => { if (action && action.actionName) { acc[action.actionName] = action.qhmiNames || []; } return acc; }, {}), }; return true; } if (items[i].sub && updateNode(items[i].sub)) return true; } return false; };
            if (!updateNode(draft.menuItems)) { console.warn("Selected node not found for update!"); setIsLoadingMenu(false); } });
        // Nur senden, wenn der Knoten gefunden wurde
        if (findNodeByReference(updatedMenu.menuItems, selectedNode)) {
             socket.emit('update-menu-config', updatedMenu);
        }
      } catch (info) { console.log('Menu Item Validate Failed:', info); message.error(t('validationFailed')); setIsLoadingMenu(false); }
  }, [selectedNode, menuData, t, form]);

  const addNewItem = useCallback(() => {
    setIsLoadingMenu(true); const newItem = { label: { value: 'New Item', source_type: 'static', source_key: '' }, link: `/new-item-${Date.now()}`, svg: 'default', enable: true, qhmiVariable: null, svgConditions: [], properties: {}, actions: {}, sub: [], };
    const updatedMenu = produce(menuData, draft => { if (!draft.menuItems) draft.menuItems = []; draft.menuItems.push(newItem); });
    socket.emit('update-menu-config', updatedMenu);
  }, [menuData]);

  const addSubMenu = useCallback(() => {
    if (!selectedNode) { message.error(t('selectMenuItem')); return; }
    setIsLoadingMenu(true); const newSubMenu = { label: { value: 'New Submenu', source_type: 'static', source_key: '' }, link: `/new-submenu-${Date.now()}`, svg: 'default', enable: true, qhmiVariable: null, svgConditions: [], properties: {}, actions: {}, sub: [], };
     const updatedMenu = produce(menuData, draft => { const addSubRecursive = (items) => { if (!Array.isArray(items)) return false; for (let i = 0; i < items.length; i++) { if (!items[i]) continue; if ((selectedNode.id != null && items[i].id === selectedNode.id) || items[i] === selectedNode) { if (!items[i].sub) items[i].sub = []; items[i].sub.push(newSubMenu); return true; } if (items[i].sub && addSubRecursive(items[i].sub)) return true; } return false; }; addSubRecursive(draft.menuItems); });
    socket.emit('update-menu-config', updatedMenu);
  }, [selectedNode, menuData, t]);

  const duplicateItem = useCallback(() => {
    if (!selectedNode) { message.error(t('selectMenuItem')); return; }
    setIsLoadingMenu(true); const deepCopy = (obj) => JSON.parse(JSON.stringify(obj));
    const duplicateMenuItemRecursive = (item) => { const newItem = deepCopy(item); delete newItem.id; const labelBase = typeof newItem.label === 'object' ? newItem.label.value : newItem.label; const newLabelValue = `${labelBase || 'Item'} Copy`; if (typeof newItem.label === 'object') newItem.label.value = newLabelValue; else newItem.label = newLabelValue; newItem.link = `${item.link || 'item'}-copy-${Date.now()}`; if (Array.isArray(newItem.sub)) newItem.sub = newItem.sub.map(duplicateMenuItemRecursive); else newItem.sub = []; return newItem; };
     const updatedMenu = produce(menuData, draft => { const duplicateInList = (items) => { if (!Array.isArray(items)) return false; let inserted = false; for (let i = items.length - 1; i >= 0; i--) { if (!items[i]) continue; if ((selectedNode.id != null && items[i].id === selectedNode.id) || items[i] === selectedNode) { const duplicate = duplicateMenuItemRecursive(items[i]); items.splice(i + 1, 0, duplicate); inserted = true; break; } if (!inserted && items[i]?.sub && duplicateInList(items[i].sub)) { inserted = true; break; } } return inserted; }; duplicateInList(draft.menuItems); });
    socket.emit('update-menu-config', updatedMenu);
  }, [selectedNode, menuData, t]);

  const deleteItem = useCallback(() => {
    if (!selectedNode) { message.error(t('selectMenuItem')); return; }
    setIsLoadingMenu(true); const currentSelectedNodeId = selectedNode?.id; const currentSelectedNodeRef = selectedNode;
    const updatedMenu = produce(menuData, draft => { const deleteRecursive = (items) => { if (!Array.isArray(items)) return false; for (let i = 0; i < items.length; i++) { if (!items[i]) continue; const nodeMatches = (currentSelectedNodeId != null && items[i].id === currentSelectedNodeId) || items[i] === currentSelectedNodeRef; if (nodeMatches) { items.splice(i, 1); return true; } if (items[i].sub && deleteRecursive(items[i].sub)) return true; } return false; }; deleteRecursive(draft.menuItems); });
    setSelectedNode(null); setSelectedNodeKey(null); form.resetFields();
    socket.emit('update-menu-config', updatedMenu);
  }, [selectedNode, menuData, t, form]);


  // --- Logging Settings Handlers ---
   const handleAddPage = useCallback(() => { if (newPage.trim() && !tempPages.includes(newPage.trim())) { const updatedPages = [...tempPages, newPage.trim()].sort(); setTempPages(updatedPages); setNewPage(''); } else if (tempPages.includes(newPage.trim())) { message.error(t('pageAlreadyExists')); } }, [newPage, tempPages, t]);
   const handleDeletePage = useCallback((pageToDelete) => { const updatedPages = tempPages.filter(p => p !== pageToDelete); setTempPages(updatedPages); const updatedSettings = tempLoggingSettings.map(setting => { if (setting.page) { const pages = setting.page.split(',').map(p => p.trim()); const filteredPages = pages.filter(p => p !== pageToDelete); return { ...setting, page: filteredPages.join(',') }; } return setting; }); setTempLoggingSettings(updatedSettings); }, [tempPages, tempLoggingSettings]);
   const handleAddLoggingSetting = useCallback(() => { if (newTopic.trim() && selectedPageForTopic) { const topicToAdd = newTopic.trim(); setTempLoggingSettings(currentSettings => { const existingSettingIndex = currentSettings.findIndex(setting => setting.topic === topicToAdd); if (existingSettingIndex > -1) { const setting = currentSettings[existingSettingIndex]; const currentPages = setting.page ? setting.page.split(',').map(p => p.trim()) : []; if (!currentPages.includes(selectedPageForTopic)) { const updatedPages = [...currentPages, selectedPageForTopic].sort().join(','); const newSettings = [...currentSettings]; newSettings[existingSettingIndex] = {...setting, page: updatedPages}; return newSettings; } else { message.warning(t('topicAlreadyOnPage')); return currentSettings; } } else { return [ ...currentSettings, { topic: topicToAdd, enabled: true, color: predefinedColors[currentSettings.length % predefinedColors.length], page: selectedPageForTopic, description: '', unit: '', } ]; } }); setNewTopic(''); setSelectedPageForTopic(null); } else { message.error(t('selectPageAndTopic')); } }, [newTopic, selectedPageForTopic, t]);
   const handleDeleteLoggingSetting = useCallback((topic) => { setTempLoggingSettings(currentSettings => currentSettings.filter(setting => setting.topic !== topic)); }, []);
   const handleToggleLoggingSetting = useCallback((topic) => { setTempLoggingSettings(currentSettings => currentSettings.map(setting => setting.topic === topic ? { ...setting, enabled: !setting.enabled } : setting)); }, []);
   const handleColorChange = useCallback((topic, color) => { setTempLoggingSettings(currentSettings => currentSettings.map(setting => setting.topic === topic ? { ...setting, color } : setting)); }, []);
   const handlePageChange = useCallback((topic, pagesArray) => { setTempLoggingSettings(currentSettings => currentSettings.map(setting => setting.topic === topic ? { ...setting, page: Array.isArray(pagesArray) ? pagesArray.sort().join(',') : '' } : setting)); }, []);
   const handleDescriptionChange = useCallback((topic, description) => { setTempLoggingSettings(currentSettings => currentSettings.map(setting => setting.topic === topic ? { ...setting, description } : setting)); }, []);
   const handleUnitChange = useCallback((topic, unit) => { setTempLoggingSettings(currentSettings => currentSettings.map(setting => setting.topic === topic ? { ...setting, unit } : setting)); }, []);
   const handleSaveLoggingSettings = useCallback(() => { setIsLoadingLogging(true); socket.emit('update-pages-and-settings', { pages: tempPages, settings: tempLoggingSettings, }); }, [tempPages, tempLoggingSettings]);

   // Memoized tree data generation for logging settings
   const generateLoggingTreeData = useCallback((settings, pages) => {
       const pageMap = {}; pages.forEach(page => { pageMap[page] = new Set(); });
       settings.forEach(setting => { const assignedPages = setting.page ? setting.page.split(',').map(p => p.trim()) : []; assignedPages.forEach(page => { if (pageMap[page]) { pageMap[page].add(setting); } }); });
       return pages.map(page => ({
         title: ( <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}> <span style={{ fontWeight: 'bold' }}>{page}</span> <Popconfirm title={t('confirmDeletePage')} onConfirm={() => handleDeletePage(page)} okText={t('yes')} cancelText={t('no')}> <Button size="small" danger icon={<DeleteOutlined />} /> </Popconfirm> </div> ),
         key: `page-${page}`,
         children: Array.from(pageMap[page] || []).sort((a, b) => a.topic.localeCompare(b.topic)).map(setting => ({
           title: ( <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '2px 0' }}> <span style={{ minWidth: '150px', flexShrink: 0 }}>{setting.topic}</span> <Switch checked={setting.enabled !== false} onChange={() => handleToggleLoggingSetting(setting.topic)} checkedChildren={t('Enabled')} unCheckedChildren={t('Disabled')} size="small"/> <Select size="small" value={setting.color || predefinedColors[0]} onChange={(value) => handleColorChange(setting.topic, value)} style={{ width: 100 }}>{predefinedColors.map((colorOption) => (<Option key={colorOption} value={colorOption} style={{ padding: '4px 8px' }}><div style={{ display: 'flex', alignItems: 'center' }}><div style={{ width: 14, height: 14, backgroundColor: colorOption, marginRight: 5, border: '1px solid #555', borderRadius: '2px' }}/></div></Option>))}</Select> <Select size="small" mode="multiple" allowClear placeholder={t('Select Pages')} value={setting.page ? setting.page.split(',').map(p => p.trim()) : []} onChange={(value) => handlePageChange(setting.topic, value)} style={{ minWidth: 150, flexGrow: 1 }}>{tempPages.map(p => (<Option key={p} value={p}>{p}</Option>))}</Select> <Input size="small" value={setting.description || ''} onChange={(e) => handleDescriptionChange(setting.topic, e.target.value)} placeholder={t('Description')} style={{ width: 150 }}/> <Input size="small" value={setting.unit || ''} onChange={(e) => handleUnitChange(setting.topic, e.target.value)} placeholder={t('Unit')} style={{ width: 60 }}/> <Popconfirm title={t('confirmDeleteTopic')} onConfirm={() => handleDeleteLoggingSetting(setting.topic)} okText={t('yes')} cancelText={t('no')}> <Button size="small" danger icon={<DeleteOutlined />} /> </Popconfirm> </div> ),
           key: `topic-${setting.topic}-${page}`, isLeaf: true,
         })),
       }));
     }, [t, tempPages, handleDeletePage, handleToggleLoggingSetting, handleColorChange, handlePageChange, handleDescriptionChange, handleUnitChange, handleDeleteLoggingSetting]);
   const loggingTreeData = useMemo(() => generateLoggingTreeData(tempLoggingSettings, tempPages), [generateLoggingTreeData, tempLoggingSettings, tempPages]);
   // --- Ende Logging Handlers ---


  // RULES: Handler zum Speichern der Regeln (Implementierung)
  const handleSaveVisibilityRules = useCallback((updatedRules) => {
      console.log("[MenuConfigModal] Saving visibility rules:", updatedRules);
      setIsLoadingRules(true); // Laden anzeigen
      socket.emit('update-visibility-rules', updatedRules);
      // Erfolg/Fehler wird durch Listener oben behandelt
  }, []); // Keine Abhängigkeiten nötig


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
        <TabPane tab={t('Menu Settings')} key="1" style={{ flexGrow: 1, overflow: 'hidden' }}>
           {isLoadingMenu && <div style={{ textAlign: 'center', padding: 20 }}><Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} /></div>}
           {!isLoadingMenu && (
                <div style={{ display: 'flex', gap: '20px', height: 'calc(100% - 40px)' }}>
                   <div style={{ flex: '0 0 350px', display: 'flex', flexDirection: 'column' }}>
                     <div style={{ marginBottom: '10px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                       <Button icon={<PlusOutlined />} onClick={addNewItem} disabled={isLoadingMenu}>{t('addItem')}</Button>
                       <Button type="default" icon={<PlusOutlined />} onClick={addSubMenu} disabled={!selectedNode || isLoadingMenu}>{t('addSubMenu')}</Button>
                     </div>
                     <Divider style={{ backgroundColor: '#434343', margin: '10px 0' }} />
                     <div style={{ flexGrow: 1, overflowY: 'auto', border: '1px solid #434343', borderRadius: '4px', background: '#1f1f1f' }}>
                         <Tree treeData={treeData} onSelect={onSelect} selectedKeys={selectedNodeKey ? [selectedNodeKey] : []} style={{ backgroundColor: 'transparent', color: '#fff', padding: '5px' }} blockNode autoExpandParent />
                     </div>
                   </div>
                   <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                     {selectedNode ? (
                       <>
                         <div style={{ flexGrow: 1, overflowY: 'auto', paddingRight: '10px' }}>
                           <Form form={form} layout="vertical" name="menuItemForm" onFinish={onFinishMenuItem} /* onFinish hier geändert */ style={{ color: '#fff' }}>
                                <Form.Item label={t('label')}>
                                    <Input.Group compact>
                                    <Form.Item name={['label', 'source_type']} noStyle rules={[{ required: true }]}><Select style={{ width: '30%' }}><Option value="static">{t('static')}</Option><Option value="dynamic">{t('dynamic')}</Option><Option value="mqtt">{t('mqtt')}</Option></Select></Form.Item>
                                    <Form.Item noStyle shouldUpdate={(p, c) => p.label?.source_type !== c.label?.source_type}>{({ getFieldValue }) => getFieldValue(['label', 'source_type']) === 'static' ? (<Form.Item name={['label', 'value']} noStyle rules={[{ required: true }]}><Input style={{ width: '70%' }} placeholder={t('labelValue')} /></Form.Item>) : (<Form.Item name={['label', 'source_key']} noStyle rules={[{ required: true }]}><Input style={{ width: '70%' }} placeholder={t('labelSourceKey')} /></Form.Item>)}</Form.Item>
                                    </Input.Group>
                                </Form.Item>
                                <Form.Item name="link" label={t('link')}><Input /></Form.Item>
                                <Form.Item name="svg" label={t('defaultSvg')}><Input placeholder="Standard-SVG" /></Form.Item>
                                <Form.Item name="enable" label={t('enable')} valuePropName="checked"><Switch /></Form.Item>
                                <Form.Item name="qhmiVariable" label={t('qhmiVariableSvg')}><Input placeholder="Variable für SVG" /></Form.Item>
                                <Divider orientation="left" style={{ color: '#aaa', borderColor: '#434343' }}>{t('SVG Conditions')}</Divider>
                                <Form.List name="svgConditions">{(fields, { add, remove }) => (<>{fields.map(({ key, name, ...restField }) => (<Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline"><Form.Item {...restField} name={[name, 'value']} rules={[{ required: true }]}><Input placeholder={t('Value')} /></Form.Item><Form.Item {...restField} name={[name, 'svg']} rules={[{ required: true }]}><Input placeholder={t('SVG Name')} /></Form.Item><DeleteOutlined onClick={() => remove(name)} style={{ color: '#ff4d4f', cursor: 'pointer' }} /></Space>))}<Form.Item><Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>{t('Add SVG Condition')}</Button></Form.Item></>)}</Form.List>
                                <Divider orientation="left" style={{ color: '#aaa', borderColor: '#434343' }}>{t('Properties')}</Divider>
                                <Form.List name="properties">{(fields, { add, remove }) => (<>{fields.map(({ key, name, ...restField }) => (<Space key={key} style={{ display: 'flex', marginBottom: 8, flexWrap: 'wrap' }} align="baseline"><Form.Item {...restField} name={[name, 'key']} rules={[{ required: true }]} style={{ flex: 1, minWidth: '100px' }}><Input placeholder={t('Key')} /></Form.Item><Form.Item noStyle shouldUpdate={(p, c) => p.properties?.[name]?.source_type !== c.properties?.[name]?.source_type}>{({ getFieldValue }) => getFieldValue(['properties', name, 'source_type']) === 'static' ? (<Form.Item {...restField} name={[name, 'value']} rules={[{ required: true }]} style={{ flex: 2, minWidth: '150px' }}><Input placeholder={t('Value')} /></Form.Item>) : (<Form.Item {...restField} name={[name, 'source_key']} rules={[{ required: true }]} style={{ flex: 2, minWidth: '150px' }}><Input placeholder={t('Source Key')} /></Form.Item>)}</Form.Item><Form.Item {...restField} name={[name, 'source_type']} rules={[{ required: true }]} style={{ flex: 1, minWidth: '100px' }}><Select placeholder={t('Source Type')}><Option value="static">{t('static')}</Option><Option value="dynamic">{t('dynamic')}</Option><Option value="mqtt">{t('mqtt')}</Option></Select></Form.Item><DeleteOutlined onClick={() => remove(name)} style={{ color: '#ff4d4f', cursor: 'pointer' }} /></Space>))}<Form.Item><Button type="dashed" onClick={() => add({ key: '', value: '', source_type: 'static', source_key: '' })} block icon={<PlusOutlined />}>{t('Add Property')}</Button></Form.Item></>)}</Form.List>
                                <Divider orientation="left" style={{ color: '#aaa', borderColor: '#434343' }}>{t('Actions')}</Divider>
                                <Form.List name="actions">{(fields, { add, remove }) => (<>{fields.map(({ key, name: actionIndex, ...restField }) => (<div key={key} style={{ marginBottom: '15px', border: '1px solid #434343', padding: '10px', borderRadius: '4px' }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}><Form.Item {...restField} label={t('Action Name')} name={[actionIndex, 'actionName']} rules={[{ required: true }]} style={{ marginBottom: 0, flexGrow: 1, marginRight: '10px' }}><Input placeholder="z.B. editSettings" /></Form.Item><Button type="link" danger icon={<DeleteOutlined />} onClick={() => remove(actionIndex)} /></div><Form.List name={[actionIndex, 'qhmiNames']}>{(qhmiFields, { add: addQhmi, remove: removeQhmi }) => (<>{qhmiFields.map(({ key: qhmiKey, name: qhmiName, ...qhmiRestField }) => (<Space key={qhmiKey} style={{ display: 'flex', marginBottom: 8 }} align="baseline"><Form.Item {...qhmiRestField} name={[qhmiName]} rules={[{ required: true }]} style={{ flexGrow: 1, marginBottom: 0 }}><Input placeholder={t('QHMI Variable Name')} /></Form.Item><DeleteOutlined onClick={() => removeQhmi(qhmiName)} style={{ color: '#ff4d4f', cursor: 'pointer' }} /></Space>))}<Form.Item style={{ marginBottom: 0 }}><Button type="dashed" onClick={() => addQhmi()} block icon={<PlusOutlined />}>{t('Add QHMI Variable')}</Button></Form.Item></>)}</Form.List></div>))}<Form.Item><Button type="dashed" onClick={() => add({ actionName: '', qhmiNames: [] })} block icon={<PlusOutlined />}>{t('Add Action')}</Button></Form.Item></>)}</Form.List>
                           </Form>
                          </div>
                          <div style={{ borderTop: '1px solid #434343', paddingTop: '10px', background: '#141414', flexShrink: 0 }}>
                             <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                                <Button type="default" icon={<CopyOutlined />} onClick={duplicateItem} disabled={isLoadingMenu || !selectedNode}>{t('duplicate')}</Button>
                                <Popconfirm title={t('confirmDeleteItem')} onConfirm={deleteItem} okText={t('Yes')} cancelText={t('No')} disabled={isLoadingMenu || !selectedNode}><Button type="primary" danger icon={<DeleteOutlined />} disabled={isLoadingMenu || !selectedNode}>{t('deleteItem')}</Button></Popconfirm>
                                <Button type="primary" onClick={() => form.submit()} /* Trigger Form onFinish */ loading={isLoadingMenu} style={{ backgroundColor: '#ffb000', borderColor: '#ffb000' }} disabled={!selectedNode || isLoadingMenu}>{t('Save Menu Item Changes')}</Button>
                             </div>
                          </div>
                       </>
                     ) : ( <p style={{ textAlign: 'center', marginTop: '20px' }}>{t('selectMenuItemToEdit')}</p> )}
                   </div>
                </div>
            )}
        </TabPane>

        {/* --- Tab: Visibility Rules --- */}
        <TabPane tab={t('Rules')} key="3" style={{ flexGrow: 1, overflowY: 'auto' }}>
             {isLoadingRules && <div style={{ textAlign: 'center', padding: 20 }}><Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} /></div>}
            {!isLoadingRules && <RulesConfigTab rules={visibilityRules} onSave={handleSaveVisibilityRules} />}
        </TabPane>

        {/* --- Tab: Logging Settings --- */}
        <TabPane tab={t('Logging Settings')} key="2" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {isLoadingLogging && <div style={{ textAlign: 'center', padding: 20, flexGrow: 1 }}><Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} /></div>}
            {!isLoadingLogging && (<>
               <div style={{ flexShrink: 0 }}>
                    <Form layout="inline" onFinish={handleAddPage} style={{ marginBottom: '10px', padding: '10px', background: '#1f1f1f', borderRadius: '4px' }}>
                        <Form.Item><Input placeholder={t('New Page')} value={newPage} onChange={(e) => setNewPage(e.target.value)} style={{ width: '200px' }} /></Form.Item>
                        <Form.Item><Button type="primary" htmlType="submit" style={{ backgroundColor: '#ffb000', borderColor: '#ffb000' }}>{t('Add Page')}</Button></Form.Item>
                    </Form>
                    <Form layout="inline" onFinish={handleAddLoggingSetting} style={{ marginBottom: '10px', padding: '10px', background: '#1f1f1f', borderRadius: '4px' }}>
                        <Form.Item><Input placeholder={t('New Topic')} value={newTopic} onChange={(e) => setNewTopic(e.target.value)} style={{ width: '250px' }} /></Form.Item>
                        <Form.Item><Select placeholder={t('Select Page')} value={selectedPageForTopic} onChange={(value) => setSelectedPageForTopic(value)} style={{ width: '180px' }}>{tempPages.map(page => (<Option key={page} value={page}>{page}</Option>))}</Select></Form.Item>
                        <Form.Item><Button type="primary" htmlType="submit" style={{ backgroundColor: '#ffb000', borderColor: '#ffb000' }}>{t('Add Topic')}</Button></Form.Item>
                    </Form>
                </div>
                <div style={{ flexGrow: 1, overflowY: 'auto', border: '1px solid #434343', borderRadius: '4px', background: '#1f1f1f', padding: '5px' }}>
                    <Tree treeData={loggingTreeData} defaultExpandAll style={{ backgroundColor: 'transparent' }} blockNode />
                </div>
               <div style={{ marginTop: '10px', textAlign: 'right', flexShrink: 0, borderTop: '1px solid #434343', paddingTop: '10px', background: '#141414' }}>
                 <Button type="primary" icon={<SaveOutlined />} onClick={handleSaveLoggingSettings} loading={isLoadingLogging} style={{ backgroundColor: '#ffb000', borderColor: '#ffb000' }}>
                   {t('Save Logging Settings')}
                 </Button>
               </div>
             </>)}
        </TabPane>

      </Tabs>
    </Modal>
  );
};

export default MenuConfigModal;