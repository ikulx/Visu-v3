import React, { useEffect, useState, useMemo } from 'react';
import { Modal, Table, Menu, Grid, Drawer, Button } from 'antd';
import { useTranslation } from 'react-i18next';
import socket from './socket';
import EditVariableModal from './EditVariableModal';
import { useUser } from './UserContext';

const SettingsPage = ({ visible, onClose, user }) => {
  const { t, i18n } = useTranslation();
  const { xs } = Grid.useBreakpoint();
  const { loggedInUser } = useUser();

  const [settingsData, setSettingsData] = useState([]);
  const [selectedMain, setSelectedMain] = useState(null);
  const [selectedSub, setSelectedSub] = useState(null);
  const [menuDrawerVisible, setMenuDrawerVisible] = useState(false);

  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editRecords, setEditRecords] = useState([]); // Änderung zu Array

  useEffect(() => {
    if (visible && loggedInUser) {
      socket.emit('request-settings', { user: loggedInUser });
    }
  }, [visible, loggedInUser]);

  useEffect(() => {
    const handleSettingsUpdate = (data) => {
      const filteredData = data.filter(row => {
        if (!row.benutzer) return false;
        const allowedUsers = row.benutzer.split(',').map(u => u.trim().toLowerCase());
        return allowedUsers.includes(loggedInUser?.toLowerCase());
      });
      setSettingsData(filteredData);
    };
    socket.on("settings-update", handleSettingsUpdate);
    return () => {
      socket.off("settings-update", handleSettingsUpdate);
    };
  }, [loggedInUser]);

  const lang = i18n.language || 'en';
  const nameField =
    lang === 'de' ? 'NAME_de'
    : lang === 'fr' ? 'NAME_fr'
    : lang === 'it' ? 'NAME_it'
    : 'NAME_en';

  const visibleSettings = useMemo(() => {
    return settingsData.filter(row => row.visible == 1 || row.visible === '1');
  }, [settingsData]);

  const groupedData = useMemo(() => {
    const groups = {};
    visibleSettings.forEach(row => {
      const main = row.tag_top || 'Ohne Gruppe';
      if (!groups[main]) {
        groups[main] = { withSub: {}, noSub: [] };
      }
      const sub = row.tag_sub && row.tag_sub.trim() ? row.tag_sub.trim() : null;
      if (sub) {
        if (!groups[main].withSub[sub]) {
          groups[main].withSub[sub] = [];
        }
        groups[main].withSub[sub].push(row);
      } else {
        groups[main].noSub.push(row);
      }
    });
    return groups;
  }, [visibleSettings]);

  const menuItems = useMemo(() => {
    const items = [];
    Object.keys(groupedData).forEach(mainKey => {
      const group = groupedData[mainKey];
      const subItems = [];
      if (group.noSub.length > 0) {
        items.push({ key: `${mainKey}___nosub`, label: mainKey });
      }
      Object.keys(group.withSub).forEach(subKey => {
        subItems.push({ key: `${mainKey}___${subKey}`, label: subKey });
      });
      if (subItems.length > 0) {
        items.push({ key: mainKey, label: mainKey, children: subItems });
      }
    });
    return items;
  }, [groupedData, t]);

  useEffect(() => {
    const mainKeys = Object.keys(groupedData);
    if (mainKeys.length === 0) {
      setSelectedMain(null);
      setSelectedSub(null);
      return;
    }
    if (!selectedMain || !groupedData[selectedMain]) {
      const newMain = mainKeys[0];
      setSelectedMain(newMain);
      const subKeys = Object.keys(groupedData[newMain].withSub);
      if (groupedData[newMain].noSub.length > 0) {
        setSelectedSub('nosub');
      } else if (subKeys.length > 0) {
        setSelectedSub(subKeys[0]);
      } else {
        setSelectedSub(null);
      }
    } else {
      const subKeys = Object.keys(groupedData[selectedMain].withSub);
      const hasNoSub = groupedData[selectedMain].noSub.length > 0;
      if (selectedSub === 'nosub' && !hasNoSub) {
        setSelectedSub(subKeys.length > 0 ? subKeys[0] : null);
      } else if (selectedSub && selectedSub !== 'nosub' && !groupedData[selectedMain].withSub[selectedSub]) {
        setSelectedSub(hasNoSub ? 'nosub' : subKeys.length > 0 ? subKeys[0] : null);
      } else if (!selectedSub) {
        setSelectedSub(hasNoSub ? 'nosub' : subKeys.length > 0 ? subKeys[0] : null);
      }
    }
  }, [groupedData, selectedMain, selectedSub]);

  const filteredData = useMemo(() => {
    return visibleSettings.filter(row => {
      const main = row.tag_top || 'Ohne Gruppe';
      const sub = row.tag_sub && row.tag_sub.trim() ? row.tag_sub.trim() : null;
      if (main !== selectedMain) return false;
      if (selectedSub) {
        if (selectedSub === 'nosub') return !sub;
        return sub === selectedSub;
      }
      return true;
    });
  }, [visibleSettings, selectedMain, selectedSub]);

  const columns = [
    {
      title: t('Name'),
      dataIndex: 'name',
      key: 'name',
      render: (_, record) =>
        record[nameField] && record[nameField].trim() ? record[nameField] : record['NAME'],
    },
    {
      title: t('Wert'),
      dataIndex: 'VAR_VALUE',
      key: 'VAR_VALUE',
      render: (text, record) => {
        if (record.TYPE === 'drop') {
          let optionsString = '';
          if (i18n.language === 'de') {
            optionsString = record.OPTI_de;
          } else if (i18n.language === 'fr') {
            optionsString = record.OPTI_fr;
          } else if (i18n.language === 'it') {
            optionsString = record.OPTI_it;
          } else {
            optionsString = record.OPTI_en;
          }
          const options = optionsString
            .split(',')
            .filter(opt => opt.trim() !== '')
            .map(opt => {
              const [key, label] = opt.split(':').map(s => s.trim());
              return { key, label };
            });
          const found = options.find(opt => opt.key === record.VAR_VALUE);
          return found ? found.label : record.VAR_VALUE;
        } else {
          return record.VAR_VALUE;
        }
      }
    }
  ];

  const onMenuClick = (e) => {
    const parts = e.key.split('___');
    setSelectedMain(parts[0]);
    setSelectedSub(parts.length > 1 ? parts[1] : null);
    if (xs) {
      setMenuDrawerVisible(false);
    }
  };

  const handleRowClick = (record) => {
    setEditRecords([record]); // Ein Array mit einem Element
    setEditModalVisible(true);
  };

  const handleUpdateSuccess = () => {
    setEditModalVisible(false);
  };

  return (
    <Modal
      visible={visible}
      onCancel={onClose}
      footer={null}
      title={t('Settings')}
      width={xs ? "100%" : "80%"}
      style={{ top: 0 }}
      body={{ padding: 0, overflow: 'hidden', backgroundColor: '#141414', color: '#fff' }}
      maskProps={{ style: { backgroundColor: 'rgba(0,0,0,0.7)' } }}
    >
      {xs ? (
        <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 100px)' }}>
          <div style={{ display: 'flex', alignItems: 'center', backgroundColor: '#1f1f1f', padding: '10px', borderBottom: '1px solid #333' }}>
            <Button
              type="text"
              onClick={() => setMenuDrawerVisible(true)}
              style={{ color: '#fff', fontSize: '20px' }}
            >
              ☰
            </Button>
            <span style={{ marginLeft: '10px', color: '#fff', fontSize: '16px' }}>{t('Menu')}</span>
          </div>
          <div style={{ flex: 1, padding: '10px', overflowY: 'auto', backgroundColor: '#141414' }}>
            <Table
              dataSource={filteredData}
              columns={columns}
              pagination={false}
              rowKey={(record) => record.NAME}
              onRow={(record) => ({
                onClick: () => handleRowClick(record),
              })}
              style={{ backgroundColor: '#141414', color: '#fff' }}
            />
          </div>
          <Drawer
            title={t('Menu')}
            placement="left"
            onClose={() => setMenuDrawerVisible(false)}
            open={menuDrawerVisible}
            bodyStyle={{ padding: 0, backgroundColor: '#1f1f1f' }}
            headerStyle={{ backgroundColor: '#1f1f1f', color: '#fff' }}
          >
            <Menu
              mode="inline"
              selectedKeys={[selectedSub ? `${selectedMain}___${selectedSub}` : `${selectedMain}___nosub`]}
              onClick={onMenuClick}
              items={menuItems}
              style={{ backgroundColor: '#1f1f1f', color: '#fff' }}
            />
          </Drawer>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'row', height: 'calc(100vh - 100px)', backgroundColor: '#141414' }}>
          <div style={{ width: '250px', borderRight: '1px solid #333', padding: '10px', overflowY: 'auto', backgroundColor: '#1f1f1f' }}>
            <Menu
              mode="inline"
              selectedKeys={[selectedSub ? `${selectedMain}___${selectedSub}` : `${selectedMain}___nosub`]}
              onClick={onMenuClick}
              items={menuItems}
              style={{ backgroundColor: '#1f1f1f', color: '#fff' }}
            />
          </div>
          <div style={{ flex: 1, padding: '10px', overflowY: 'auto', backgroundColor: '#141414' }}>
            <Table
              dataSource={filteredData}
              columns={columns}
              pagination={false}
              rowKey={(record) => record.NAME}
              onRow={(record) => ({
                onClick: () => handleRowClick(record),
              })}
              style={{ backgroundColor: '#141414', color: '#fff' }}
            />
          </div>
        </div>
      )}
      {editRecords.length > 0 && (
        <EditVariableModal
          visible={editModalVisible}
          records={editRecords} // Übergabe als Array
          onCancel={() => setEditModalVisible(false)}
          onUpdateSuccess={handleUpdateSuccess}
        />
      )}
    </Modal>
  );
};

export default SettingsPage;