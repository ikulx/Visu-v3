// src/Layout/AlarmsPopup.js
import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Tabs, Table, Tag, Spin, Empty, Pagination, Tooltip, Alert, Button, message, Space } from 'antd';
import { BellOutlined, HistoryOutlined, ReloadOutlined } from '@ant-design/icons'; // Reload Icon für Reset
import { useTranslation } from 'react-i18next';
import socket from '../socket'; // Importiere die Socket-Instanz
import dayjs from 'dayjs';

const { TabPane } = Tabs;

// Prioritäten für Filter und Tags
const alarmPriorities = ['prio1', 'prio2', 'prio3', 'warning', 'info'];
// Mapping für Sortierung
const prioMap = { 'prio1': 5, 'prio2': 4, 'prio3': 3, 'warning': 2, 'info': 1 };

const AlarmsPopup = ({ visible, onClose }) => {
    const { t } = useTranslation();
    // State für Daten
    const [activeAlarms, setActiveAlarms] = useState([]);
    const [alarmHistory, setAlarmHistory] = useState([]);
    // State für Ladezustände
    const [loadingActive, setLoadingActive] = useState(false);
    const [loadingHistory, setLoadingHistory] = useState(false);
    // State für Fehler
    const [activeError, setActiveError] = useState(null);
    const [historyError, setHistoryError] = useState(null);
    // State für Paginierung der History
    const [historyPagination, setHistoryPagination] = useState({ current: 1, pageSize: 20, total: 0 });
    // State für den aktiven Tab
    const [activeTabKey, setActiveTabKey] = useState("1");
    // State für Quittierungs-/Reset-Vorgang
    const [isAcknowledging, setIsAcknowledging] = useState(false);

    // Callback zum Abrufen der Historie
    const fetchHistory = useCallback((page = 1, pageSize = 20) => {
        setLoadingHistory(true);
        setHistoryError(null);
        const offset = (page - 1) * pageSize;
        console.log(`[AlarmsPopup] Requesting history: Page ${page}, PageSize ${pageSize}, Offset ${offset}`);
        socket.emit('request-alarm-history', { limit: pageSize, offset: offset });
    }, []); // Keine Abhängigkeiten

    // Effekt für Socket.IO Listener (nur Mount/Unmount)
    useEffect(() => {
        console.log("[AlarmsPopup] Registering Socket Listeners.");
        // Handler für aktive Alarme
        const handleAlarmsUpdate = (data) => { console.log("[AlarmsPopup] Received 'alarms-update':", data ? `(${data.length} items)`: 'empty'); const sortedData = Array.isArray(data) ? [...data].sort((a, b) => { const prioA = prioMap[a.definition?.priority] || 0; const prioB = prioMap[b.definition?.priority] || 0; if (prioB !== prioA) return prioB - prioA; return new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime(); }) : []; setActiveAlarms(sortedData); setLoadingActive(false); setActiveError(null); };
        // Handler für History-Seite
        const handleHistoryUpdate = (data) => { console.log("[AlarmsPopup] Received 'alarm-history-update':", data); if (data && Array.isArray(data.history)) { setAlarmHistory(data.history); setHistoryPagination(prev => ({ ...prev, total: data.total || 0, current: data.offset !== undefined && data.limit > 0 ? Math.floor(data.offset / data.limit) + 1 : prev.current, pageSize: data.limit || prev.pageSize })); setHistoryError(null); } else { console.warn("[AlarmsPopup] Invalid data received for 'alarm-history-update'."); setAlarmHistory([]); setHistoryPagination(prev => ({ ...prev, total: 0 })); } setLoadingHistory(false); };
        // Handler für neuen History-Eintrag
        const handleNewHistoryEntry = (newEntry) => { console.log("[AlarmsPopup] Received 'alarm-history-entry':", newEntry); setActiveTabKey(currentActiveTabKey => { setHistoryPagination(currentPagination => { let newTotal = (currentPagination.total || 0) + 1; if (currentActiveTabKey === "2" && currentPagination.current === 1) { fetchHistory(1, currentPagination.pageSize); return {...currentPagination }; } else { return { ...currentPagination, total: newTotal }; } }); return currentActiveTabKey; }); };
        // Fehler-Handler
        const handleHistoryError = (error) => { console.error("[AlarmsPopup] Received 'alarm-history-error':", error); setHistoryError(error.message || t('errorLoadingHistory', 'Fehler beim Laden der Historie.')); setLoadingHistory(false); };
        const handleActiveError = (error) => { console.error("[AlarmsPopup] Received 'alarms-error':", error); setActiveError(error.message || t('errorLoadingActiveAlarms', 'Fehler beim Laden der aktiven Alarme.')); setLoadingActive(false); };
        // Handler für Reset-Bestätigung (via MQTT)
        const handleAckStatus = (data) => { console.log("[AlarmsPopup] Received 'alarm-ack-status':", data); if (data && data.status === false) { setIsAcknowledging(false); message.success(t('resetConfirmed', 'Reset vom System bestätigt.')); } };

        // Listener registrieren
        socket.on('alarms-update', handleAlarmsUpdate);
        socket.on('alarm-history-update', handleHistoryUpdate);
        socket.on('alarm-history-entry', handleNewHistoryEntry);
        socket.on('alarm-history-error', handleHistoryError);
        socket.on('alarms-error', handleActiveError);
        socket.on('alarm-ack-status', handleAckStatus); // Listener für MQTT-Bestätigung

        // Cleanup-Funktion
        return () => { console.log("[AlarmsPopup] Unregistering Socket Listeners."); socket.off('alarms-update', handleAlarmsUpdate); socket.off('alarm-history-update', handleHistoryUpdate); socket.off('alarm-history-entry', handleNewHistoryEntry); socket.off('alarm-history-error', handleHistoryError); socket.off('alarms-error', handleActiveError); socket.off('alarm-ack-status', handleAckStatus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchHistory, t]); // Abhängigkeiten für Callbacks

    // Effekt zum Laden von Daten bei Sichtbarkeit / Tab-Wechsel / Paginierungsänderung
    useEffect(() => {
        if (visible) {
            console.log(`[AlarmsPopup] Effect for visible/tab change. Active Tab: ${activeTabKey}`);
            setActiveError(null); setHistoryError(null);
            if (activeTabKey === "1") {
                setLoadingActive(true); setLoadingHistory(false);
                console.log("[AlarmsPopup] Active tab 1: Requesting current alarms.");
                socket.emit('request-current-alarms');
            } else if (activeTabKey === "2") {
                setLoadingActive(false);
                if (historyPagination.current >= 1 && historyPagination.pageSize > 0) { fetchHistory(historyPagination.current, historyPagination.pageSize); }
                else { console.warn("[AlarmsPopup] Skipping history fetch due to invalid pagination:", historyPagination); setLoadingHistory(false); }
            } else { setLoadingActive(false); setLoadingHistory(false); }
        } else {
             setActiveAlarms([]); setAlarmHistory([]);
             setHistoryPagination({ current: 1, pageSize: 20, total: 0 });
             setActiveTabKey("1"); setLoadingActive(false); setLoadingHistory(false);
             setActiveError(null); setHistoryError(null);
             setIsAcknowledging(false); // Reset acknowledge state on close
        }
    }, [visible, activeTabKey, historyPagination.current, historyPagination.pageSize, fetchHistory]);


    // --- Render-Funktionen und Spaltendefinitionen ---
    const getPriorityTag = (priority) => { let color = 'default'; switch (priority) { case 'prio1': color = 'volcano'; break; case 'prio2': color = 'red'; break; case 'prio3': color = 'orange'; break; case 'warning': color = 'warning'; break; case 'info': color = 'blue'; break; default: color = 'default'; } return <Tag color={color}>{t(`priority_${priority}`, priority)}</Tag>; };
    const renderTimestamp = (ts) => ts ? dayjs(ts).format('YYYY-MM-DD HH:mm:ss') : '-';
    const renderPriority = (priority) => priority ? getPriorityTag(priority) : getPriorityTag('default');
    const renderAlarmText = (textKey) => { if (!textKey) return '---'; const translated = t(textKey); return (translated === textKey || !translated) ? textKey : translated; } // Zeigt Key ohne Klammern
    const renderIdentifier = (text) => text ? <Tooltip title={text}>{text}</Tooltip> : '-';

    const activeColumns = [
        { title: t('timestamp', 'Zeitstempel'), dataIndex: 'timestamp', key: 'timestamp', render: renderTimestamp, sorter: (a, b) => dayjs(a.timestamp || 0).unix() - dayjs(b.timestamp || 0).unix(), defaultSortOrder: 'descend', width: 180, },
        { title: t('priority', 'Priorität'), dataIndex: ['definition', 'priority'], key: 'priority', render: renderPriority, sorter: (a, b) => (prioMap[a.definition?.priority] || 0) - (prioMap[b.definition?.priority] || 0), width: 120, },
        { title: t('alarmText', 'Alarmtext'), dataIndex: ['definition', 'alarm_text_key'], key: 'text', render: renderAlarmText, ellipsis: true, },
    ];
    const historyColumns = [
         { title: t('timestamp', 'Zeitstempel'), dataIndex: 'timestamp', key: 'timestamp', render: renderTimestamp, width: 180, sorter: (a, b) => dayjs(a.timestamp || 0).unix() - dayjs(b.timestamp || 0).unix(), defaultSortOrder: 'descend', },
         { title: t('status', 'Status'), dataIndex: 'status', key: 'status', render: (status) => status === 'active' ? <Tag color="error">{t('status_active', 'Aktiv')}</Tag> : <Tag color="success">{t('status_inactive', 'Inaktiv')}</Tag>, width: 100, filters: [ { text: t('status_active', 'Aktiv'), value: 'active' }, { text: t('status_inactive', 'Inaktiv'), value: 'inactive' }], onFilter: (value, record) => record.status === value, },
         { title: t('priority', 'Priorität'), dataIndex: 'priority', key: 'priority', render: renderPriority, width: 120, filters: alarmPriorities.map(p => ({ text: t(`priority_${p}`, p), value: p })), onFilter: (value, record) => record.priority === value, },
         { title: t('alarmText', 'Alarmtext'), dataIndex: 'alarm_text_key', key: 'text', render: renderAlarmText, ellipsis: true, },
         // Identifier und Rohwert sind entfernt
    ];

    // --- Event Handlers ---
    const handleHistoryPageChange = (page, pageSize) => { setHistoryPagination(prev => ({ ...prev, current: page, pageSize: pageSize })); }
    const handleTabChange = (key) => { setActiveTabKey(key); };
    const handleAlarmReset = () => { if (isAcknowledging) return; setIsAcknowledging(true); const eventData = { timestamp: new Date().toISOString() }; console.log(`[AlarmsPopup] Emitting 'acknowledge-alarms'`, eventData); socket.emit('acknowledge-alarms', eventData); /* Kein Timeout mehr */ };

    // --- Render Logic ---
    return (
        <Modal
            title={t('alarmsTitle', 'Alarme & Meldungen')}
            open={visible}
            onCancel={onClose}
            footer={[ // Footer mit Buttons
                 <Button key="close" onClick={onClose}> {t('close', 'Schließen')} </Button>,
                 activeTabKey === "1" && activeAlarms.length > 0 && ( <Button key="reset" type="primary" icon={<ReloadOutlined />} loading={isAcknowledging} onClick={handleAlarmReset} disabled={isAcknowledging} > {t('reset', 'Reset')} </Button> )
             ]}
            width="85%"
            style={{ top: 20 }}
            styles={{ body: { minHeight: '60vh', maxHeight: '80vh', overflowY: 'hidden', display: 'flex', flexDirection: 'column', padding: '0' } }}
            destroyOnClose
        >
            <Tabs activeKey={activeTabKey} onChange={handleTabChange} style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }} tabBarStyle={{ paddingLeft: '16px', paddingRight: '16px', flexShrink: 0, marginBottom: 0 }} destroyInactiveTabPane={true} >
                {/* Tab: Aktuelle Alarme */}
                <TabPane tab={<span><BellOutlined /> {t('currentAlarms', 'Aktuelle Alarme')} ({loadingActive ? '...' : activeAlarms.length})</span>} key="1" style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '16px' }} >
                    {activeError && (<Alert message={t('error', 'Fehler')} description={activeError} type="error" showIcon style={{ marginBottom: '16px', flexShrink: 0 }}/>)}
                    <div style={{ flexGrow: 1, overflowY: 'auto', position: 'relative' }}>
                        <Spin spinning={loadingActive} style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 10 }}>
                             {!loadingActive && !activeError && activeAlarms.length === 0 && ( <Empty description={t('noActiveAlarms', 'Keine aktiven Alarme')} style={{ marginTop: '50px'}}/> )}
                             {!loadingActive && !activeError && activeAlarms.length > 0 && ( <Table columns={activeColumns} dataSource={activeAlarms} rowKey={(record) => record.definition?.id || Math.random()} pagination={false} size="small" sticky /> )}
                        </Spin>
                    </div>
                </TabPane>

                {/* Tab: Alarmhistorie */}
                <TabPane tab={<span><HistoryOutlined /> {t('alarmHistory', 'Historie')}</span>} key="2" style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '16px' }} >
                     {historyError && (<Alert message={t('error', 'Fehler')} description={historyError} type="error" showIcon style={{ marginBottom: '16px', flexShrink: 0 }}/>)}
                    <div style={{ flexGrow: 1, overflowY: 'auto', position: 'relative' }}>
                         <Spin spinning={loadingHistory}>
                            {!loadingHistory && !historyError ? ( <Table columns={historyColumns} dataSource={alarmHistory} rowKey="id" pagination={false} size="small" locale={{ emptyText: t('noAlarmHistory', 'Keine Alarmhistorie verfügbar') }} sticky /> ) : null }
                         </Spin>
                    </div>
                    {!historyError && ( <Pagination style={{ marginTop: 16, textAlign: 'right', flexShrink: 0, visibility: historyPagination.total > 0 ? 'visible' : 'hidden' }} current={historyPagination.current} pageSize={historyPagination.pageSize} total={historyPagination.total} onChange={handleHistoryPageChange} showSizeChanger pageSizeOptions={['10', '20', '50', '100']} size="small" showTotal={(total, range) => t('paginationText', '{{start}}-{{end}} von {{total}} Einträgen', { start: range[0], end: range[1], total: total })} /> )}
                </TabPane>
            </Tabs>
        </Modal>
    );
};

export default AlarmsPopup;