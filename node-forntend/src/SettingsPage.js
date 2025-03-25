import React, { useEffect, useState, useMemo } from 'react';
import { Modal, Table, Menu } from 'antd';
import { useTranslation } from 'react-i18next';
import socket from './socket';

const SettingsPage = ({ visible, onClose, user }) => {
  const { t, i18n } = useTranslation();
  const [settingsData, setSettingsData] = useState([]);
  const [selectedMain, setSelectedMain] = useState(null);
  const [selectedSub, setSelectedSub] = useState(null);

  // Daten anfordern, wenn das Modal sichtbar wird und ein Benutzer vorhanden ist
  useEffect(() => {
    if (visible && user) {
      socket.emit('request-settings', { user });
    }
  }, [visible, user]);

  // Socket-Listener für Echtzeit-Updates
  useEffect(() => {
    const handleSettingsUpdate = (data) => {
      console.log("Received settings-update: ", data);
      setSettingsData(prevData => {
        // Mergen der neuen Daten und Entfernen von Einträgen, die nicht mehr im Update enthalten sind
        const updatedDataMap = new Map(prevData.map(row => [row.NAME, row]));
        data.forEach(newRow => {
          updatedDataMap.set(newRow.NAME, { ...updatedDataMap.get(newRow.NAME), ...newRow });
        });
        return Array.from(updatedDataMap.values());
      });
    };
    socket.on("settings-update", handleSettingsUpdate);
    return () => {
      socket.off("settings-update", handleSettingsUpdate);
    };
  }, []);

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
        subItems.push({ key: `${mainKey}___nosub`, label: t('Sonstiges') });
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

  // Auswahl aktualisieren, wenn sich die Gruppenstruktur ändert
  useEffect(() => {
    const mainKeys = Object.keys(groupedData);
    if (mainKeys.length === 0) {
      setSelectedMain(null);
      setSelectedSub(null);
      return;
    }

    if (!selectedMain || !groupedData[selectedMain]) {
      // Wenn die aktuelle Hauptgruppe nicht mehr existiert, auf die erste gültige setzen
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
      // Prüfen, ob die Untergruppe noch existiert
      const subKeys = Object.keys(groupedData[selectedMain].withSub);
      const hasNoSub = groupedData[selectedMain].noSub.length > 0;

      if (selectedSub === 'nosub' && !hasNoSub) {
        // Wenn 'nosub' ausgewählt war, aber keine Einträge ohne Untergruppe mehr existieren
        setSelectedSub(subKeys.length > 0 ? subKeys[0] : null);
      } else if (selectedSub && selectedSub !== 'nosub' && !groupedData[selectedMain].withSub[selectedSub]) {
        // Wenn die Untergruppe nicht mehr existiert
        setSelectedSub(hasNoSub ? 'nosub' : subKeys.length > 0 ? subKeys[0] : null);
      } else if (!selectedSub) {
        // Wenn keine Untergruppe ausgewählt ist, aber welche existieren
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
      render: (_, record) => record[nameField] && record[nameField].trim() ? record[nameField] : record['NAME'],
    },
    { title: t('Wert'), dataIndex: 'VAR_VALUE', key: 'VAR_VALUE' },
  ];

  const onMenuClick = (e) => {
    const parts = e.key.split('___');
    setSelectedMain(parts[0]);
    setSelectedSub(parts.length > 1 ? parts[1] : null);
  };

  return (
    <Modal
      visible={visible}
      onCancel={onClose}
      footer={null}
      title={t('Settings')}
      width="100%"
      style={{ top: 0 }}
      bodyStyle={{ maxHeight: 'calc(100vh - 100px)', overflowY: 'auto' }}
      maskProps={{ style: { backgroundColor: 'rgba(0,0,0,0.7)' } }}
    >
      <div style={{ display: 'flex', flexDirection: 'row' }}>
        <div style={{ width: '250px', borderRight: '1px solid #ccc', paddingRight: '10px' }}>
          <Menu
            mode="inline"
            selectedKeys={[
              selectedSub
                ? `${selectedMain}___${selectedSub}`
                : groupedData[selectedMain] && groupedData[selectedMain].noSub.length > 0
                ? `${selectedMain}___nosub`
                : selectedMain,
            ]}
            onClick={onMenuClick}
            items={menuItems}
          />
        </div>
        <div style={{ flex: 1, paddingLeft: '10px' }}>
          <Table dataSource={filteredData} columns={columns} pagination={false} rowKey={(record) => record.NAME} />
        </div>
      </div>
    </Modal>
  );
};

export default SettingsPage;