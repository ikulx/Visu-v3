// src/Layout/AlarmsPopup.js
import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Tabs, Table, Tag, Spin, Empty, Pagination, Tooltip, Alert, Button, message, Space, Typography } from 'antd'; // Typography hinzugefügt
import {
    BellOutlined,
    MutedOutlined, // Ersetzt BellSlashOutlined
    HistoryOutlined,
    ReloadOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import socket from '../socket'; // Importiere die Socket-Instanz
import dayjs from 'dayjs';

const { TabPane } = Tabs;
const { Text } = Typography; // Text-Komponente von Ant Design

// Prioritäten für Filter und Tags
const alarmPriorities = ['prio1', 'prio2', 'prio3', 'warning', 'info'];
// Mapping für Sortierung
const prioMap = { 'prio1': 5, 'prio2': 4, 'prio3': 3, 'warning': 2, 'info': 1 };

const AlarmsPopup = ({ visible, onClose, mqttNotificationsEnabled, onToggleMqttNotifications }) => {
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
    // mqttNotificationsEnabled kommt jetzt über Props

    // Callback zum Abrufen der Historie
    const fetchHistory = useCallback((page = 1, pageSize = 20) => {
        setLoadingHistory(true);
        setHistoryError(null);
        const offset = (page - 1) * pageSize;
        // console.log(`[AlarmsPopup] Requesting history: Page ${page}, PageSize ${pageSize}, Offset ${offset}`);
        socket.emit('request-alarm-history', { limit: pageSize, offset: offset });
    }, []); // Keine Abhängigkeiten

    // Effekt für Socket.IO Listener (ohne MQTT Status Listener)
    useEffect(() => {
        // console.log("[AlarmsPopup] Registering Socket Listeners (excluding mqtt status).");
        const handleAlarmsUpdate = (data) => {
            const sortedData = Array.isArray(data) ? [...data].sort((a, b) => {
                const prioA = prioMap[a.definition?.priority] || 0;
                const prioB = prioMap[b.definition?.priority] || 0;
                if (prioB !== prioA) return prioB - prioA; // Höhere Prio zuerst
                return new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime(); // Neueste zuerst
            }) : [];
            setActiveAlarms(sortedData);
            setLoadingActive(false);
            setActiveError(null);
        };
        const handleHistoryUpdate = (data) => {
            if (data && Array.isArray(data.history)) {
                setAlarmHistory(data.history);
                setHistoryPagination(prev => ({
                    ...prev,
                    total: data.total || 0,
                    current: data.offset !== undefined && data.limit > 0 ? Math.floor(data.offset / data.limit) + 1 : prev.current,
                    pageSize: data.limit || prev.pageSize
                }));
                setHistoryError(null);
            } else {
                console.warn("[AlarmsPopup] Invalid data received for 'alarm-history-update'.");
                setAlarmHistory([]);
                setHistoryPagination(prev => ({ ...prev, total: 0 }));
            }
            setLoadingHistory(false);
        };
        const handleNewHistoryEntry = (newEntry) => {
             setActiveTabKey(currentActiveTabKey => {
                 setHistoryPagination(currentPagination => {
                     let newTotal = (currentPagination.total || 0) + 1;
                     // Wenn der Benutzer gerade auf der History-Seite (Tab 2) ist UND auf der ersten Seite,
                     // dann lade die erste Seite neu, um den neuesten Eintrag anzuzeigen.
                     if (currentActiveTabKey === "2" && currentPagination.current === 1) {
                         fetchHistory(1, currentPagination.pageSize); // Lade Seite 1 neu
                         // Total wird durch das Update von fetchHistory aktualisiert, hier nicht ändern.
                         return {...currentPagination };
                     } else {
                         // Andernfalls nur die Gesamtanzahl erhöhen.
                         return { ...currentPagination, total: newTotal };
                     }
                 });
                 return currentActiveTabKey; // Aktiven Tab beibehalten
             });
        };
        const handleHistoryError = (error) => {
             console.error("[AlarmsPopup] Received 'alarm-history-error':", error);
             setHistoryError(error.message || t('errorLoadingHistory', 'Fehler beim Laden der Historie.'));
             setLoadingHistory(false);
        };
        const handleActiveError = (error) => {
             console.error("[AlarmsPopup] Received 'alarms-error':", error);
             setActiveError(error.message || t('errorLoadingActiveAlarms', 'Fehler beim Laden der aktiven Alarme.'));
             setLoadingActive(false);
        };
        const handleAckStatus = (data) => {
             // console.log("[AlarmsPopup] Received 'alarm-ack-status':", data);
             if (data && data.status === false) { // Wird gesendet, wenn Reset-Befehl verarbeitet wurde
                 setIsAcknowledging(false);
                 message.success(t('resetConfirmed', 'Reset vom System bestätigt.'));
             }
        };

        // Listener registrieren
        socket.on('alarms-update', handleAlarmsUpdate);
        socket.on('alarm-history-update', handleHistoryUpdate);
        socket.on('alarm-history-entry', handleNewHistoryEntry);
        socket.on('alarm-history-error', handleHistoryError);
        socket.on('alarms-error', handleActiveError);
        socket.on('alarm-ack-status', handleAckStatus);

        // Cleanup-Funktion
        return () => {
            // console.log("[AlarmsPopup] Unregistering Socket Listeners (excluding mqtt status).");
            socket.off('alarms-update', handleAlarmsUpdate);
            socket.off('alarm-history-update', handleHistoryUpdate);
            socket.off('alarm-history-entry', handleNewHistoryEntry);
            socket.off('alarm-history-error', handleHistoryError);
            socket.off('alarms-error', handleActiveError);
            socket.off('alarm-ack-status', handleAckStatus);
        };
    }, [fetchHistory, t]); // Abhängigkeiten

    // Effekt zum Laden von Daten bei Sichtbarkeit etc. (ohne MQTT Status Request)
    useEffect(() => {
        if (visible) {
            // console.log(`[AlarmsPopup] Effect for visible/tab change. Active Tab: ${activeTabKey}`);
            setActiveError(null); setHistoryError(null);
            if (activeTabKey === "1") {
                setLoadingActive(true); setLoadingHistory(false);
                // console.log("[AlarmsPopup] Active tab 1: Requesting current alarms.");
                socket.emit('request-current-alarms');
            } else if (activeTabKey === "2") {
                setLoadingActive(false);
                if (historyPagination.current >= 1 && historyPagination.pageSize > 0) { fetchHistory(historyPagination.current, historyPagination.pageSize); }
                else { console.warn("[AlarmsPopup] Skipping history fetch due to invalid pagination:", historyPagination); setLoadingHistory(false); }
            } else { setLoadingActive(false); setLoadingHistory(false); }
        } else {
             // Reset der States beim Schließen
             setActiveAlarms([]); setAlarmHistory([]);
             setHistoryPagination({ current: 1, pageSize: 20, total: 0 });
             setActiveTabKey("1"); setLoadingActive(false); setLoadingHistory(false);
             setActiveError(null); setHistoryError(null);
             setIsAcknowledging(false);
        }
    }, [visible, activeTabKey, historyPagination.current, historyPagination.pageSize, fetchHistory]);


    // Render-Funktionen und Spalten
    const getPriorityTag = (priority) => {
        let color = 'default';
        switch (priority) {
            case 'prio1': color = 'volcano'; break;
            case 'prio2': color = 'red'; break;
            case 'prio3': color = 'orange'; break;
            case 'warning': color = 'warning'; break;
            case 'info': color = 'blue'; break;
            default: color = 'default'; break;
        }
        return <Tag color={color}>{t(`priority_${priority}`, priority)}</Tag>;
    };
    const renderTimestamp = (ts) => ts ? dayjs(ts).format('YYYY-MM-DD HH:mm:ss') : '-';
    const renderPriority = (priority) => priority ? getPriorityTag(priority) : getPriorityTag('default');
    const renderAlarmText = (textKey) => {
        if (!textKey) return '---';
        const translated = t(textKey);
        return (translated === textKey || !translated) ? textKey : translated;
    };

    const activeColumns = [
        {
            title: t('timestamp', 'Zeitstempel'),
            dataIndex: 'timestamp',
            key: 'timestamp',
            render: renderTimestamp,
            sorter: (a, b) => dayjs(a.timestamp || 0).unix() - dayjs(b.timestamp || 0).unix(),
            defaultSortOrder: 'descend',
            width: 180,
        },
        {
            title: t('priority', 'Priorität'),
            dataIndex: ['definition', 'priority'],
            key: 'priority',
            render: renderPriority,
            sorter: (a, b) => (prioMap[a.definition?.priority] || 0) - (prioMap[b.definition?.priority] || 0),
            width: 120,
        },
        {
            title: t('alarmText', 'Alarmtext'),
            dataIndex: ['definition', 'alarm_text_key'],
            key: 'text',
            render: renderAlarmText,
            ellipsis: true,
        },
    ];
    const historyColumns = [
         {
             title: t('timestamp', 'Zeitstempel'),
             dataIndex: 'timestamp',
             key: 'timestamp',
             render: renderTimestamp,
             width: 180,
             sorter: (a, b) => dayjs(a.timestamp || 0).unix() - dayjs(b.timestamp || 0).unix(),
             defaultSortOrder: 'descend',
         },
         {
             title: t('status', 'Status'),
             dataIndex: 'status',
             key: 'status',
             render: (status) => status === 'active' ? <Tag color="error">{t('status_active', 'Aktiv')}</Tag> : (status === 'reset' ? <Tag color="blue">{t('status_reset', 'Reset')}</Tag> : <Tag color="success">{t('status_inactive', 'Inaktiv')}</Tag>),
             width: 100,
             filters: [
                 { text: t('status_active', 'Aktiv'), value: 'active' },
                 { text: t('status_inactive', 'Inaktiv'), value: 'inactive' },
                 { text: t('status_reset', 'Reset'), value: 'reset' }
             ],
             onFilter: (value, record) => record.status === value,
         },
         {
             title: t('priority', 'Priorität'),
             dataIndex: 'priority',
             key: 'priority',
             render: renderPriority,
             width: 120,
             filters: alarmPriorities.map(p => ({ text: t(`priority_${p}`, p), value: p })),
             onFilter: (value, record) => record.priority === value,
         },
         {
             title: t('alarmText', 'Alarmtext'),
             dataIndex: 'alarm_text_key',
             key: 'text',
             render: renderAlarmText,
             ellipsis: true,
         },
    ];

    // Event Handlers
    const handleHistoryPageChange = (page, pageSize) => { setHistoryPagination(prev => ({ ...prev, current: page, pageSize: pageSize })); }
    const handleTabChange = (key) => { setActiveTabKey(key); };
    const handleAlarmReset = () => { if (isAcknowledging) return; setIsAcknowledging(true); socket.emit('acknowledge-alarms', { timestamp: new Date().toISOString() }); };

    // Handler für Klick auf Notification Button (nutzt Prop)
    const handleToggleMqttNotifications = () => {
        if (onToggleMqttNotifications) {
            onToggleMqttNotifications();
        } else { console.error("onToggleMqttNotifications prop is missing in AlarmsPopup"); }
    };

    // Titel
    const renderModalTitle = () => (
        <span>{t('alarmsTitle', 'Alarme & Meldungen')}</span>
    );

    // Footer mit Buttons und Text
    const renderModalFooter = () => (
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
            {/* Linke Seite: Notification Toggle Button und Text */}
            <Space align="center"> {/* Space für Button und Text */}
                    <Button
                        key="mqtt-toggle"
                         type="primary" // Standard-Typ oder "primary" je nach Wunsch
                        icon={mqttNotificationsEnabled
                            // Icon Farbe ist jetzt immer weiß
                            ? <BellOutlined style={{ fontSize: '24px', color: '#fff' }} />
                            : <BellOutlined style={{ fontSize: '24px', color: '#fff' }} />
                        }
                        onClick={handleToggleMqttNotifications}
                        aria-label={mqttNotificationsEnabled ? t('disableMqttNotifications') : t('enableMqttNotifications')}
                        // Hintergrundfarbe basierend auf State
                        style={{
                            padding: '4px 12px',
                            height: 'auto',
                            backgroundColor: mqttNotificationsEnabled ? 'transparent' : '#1890ff ', // Grau wenn deaktiviert
                            // border: mqttNotificationsEnabled ? 'transparent 3px solid' : '#1890ff 3px solid', // Optional: Rahmen anpassen
                        }}
                    />
                
                {/* Bedingter Text wird angezeigt, wenn Notifications deaktiviert sind */}
                {!mqttNotificationsEnabled && (
                    <Text style={{ color: '#ff4d4f', marginLeft: '8px', fontWeight: 'bold' }}>
                        {t('alarmNotificationsSuppressed', 'Alarmmeldungen unterdrückt!')}
                    </Text>
                )}
            </Space>

            {/* Rechte Seite: Bestehende Buttons */}
            <Space>
                <Button key="close" onClick={onClose}> {t('close', 'Schließen')} </Button>
                {/* Reset-Button nur anzeigen, wenn im "Aktuelle Alarme"-Tab und Alarme vorhanden sind */}
                {activeTabKey === "1" && activeAlarms.length > 0 && (
                    <Button key="reset" type="primary" icon={<ReloadOutlined />} loading={isAcknowledging} onClick={handleAlarmReset} disabled={isAcknowledging}>
                        {t('reset', 'Reset')}
                    </Button>
                )}
            </Space>
        </div>
    );

    // Render Logic des Modals
    return (
        <Modal
            title={renderModalTitle()} // Titel ohne Button
            open={visible}
            onCancel={onClose}
            footer={renderModalFooter()} // Footer mit Buttons und Text
            width="85%"
            style={{ top: 20 }}
            styles={{ body: { minHeight: '60vh', maxHeight: '80vh', overflowY: 'hidden', display: 'flex', flexDirection: 'column', padding: '0' } }}
            destroyOnClose
        >
            <Tabs
                activeKey={activeTabKey}
                onChange={handleTabChange}
                style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}
                tabBarStyle={{ paddingLeft: '16px', paddingRight: '16px', flexShrink: 0, marginBottom: 0 }}
                destroyInactiveTabPane={true}
            >
                {/* Tab: Aktuelle Alarme */}
                <TabPane
                    tab={<span><BellOutlined /> {t('currentAlarms', 'Aktuelle Alarme')} ({loadingActive ? '...' : activeAlarms.length})</span>}
                    key="1"
                    style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '16px' }}
                >
                    {activeError && (<Alert message={t('error', 'Fehler')} description={activeError} type="error" showIcon style={{ marginBottom: '16px', flexShrink: 0 }}/>)}
                    <div style={{ flexGrow: 1, overflowY: 'auto', position: 'relative' }}>
                        <Spin spinning={loadingActive} style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 10 }}>
                             {!loadingActive && !activeError && activeAlarms.length === 0 && (
                                 <Empty description={t('noActiveAlarms', 'Keine aktiven Alarme')} style={{ marginTop: '50px'}}/>
                             )}
                             {!loadingActive && !activeError && activeAlarms.length > 0 && (
                                 <Table columns={activeColumns} dataSource={activeAlarms} rowKey={(record) => record.definition?.id || Math.random()} pagination={false} size="small" sticky />
                             )}
                        </Spin>
                    </div>
                </TabPane>

                {/* Tab: Alarmhistorie */}
                <TabPane
                    tab={<span><HistoryOutlined /> {t('alarmHistory', 'Historie')}</span>}
                    key="2"
                    style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '16px' }}
                >
                     {historyError && (<Alert message={t('error', 'Fehler')} description={historyError} type="error" showIcon style={{ marginBottom: '16px', flexShrink: 0 }}/>)}
                    <div style={{ flexGrow: 1, overflowY: 'auto', position: 'relative' }}>
                         <Spin spinning={loadingHistory}>
                            {!loadingHistory && !historyError ? (
                                <Table columns={historyColumns} dataSource={alarmHistory} rowKey="id" pagination={false} size="small" locale={{ emptyText: t('noAlarmHistory', 'Keine Alarmhistorie verfügbar') }} sticky />
                            ) : null }
                         </Spin>
                    </div>
                    {!historyError && (
                        <Pagination
                            style={{ marginTop: 16, textAlign: 'right', flexShrink: 0, visibility: historyPagination.total > 0 ? 'visible' : 'hidden' }}
                            current={historyPagination.current}
                            pageSize={historyPagination.pageSize}
                            total={historyPagination.total}
                            onChange={handleHistoryPageChange}
                            showSizeChanger
                            pageSizeOptions={['10', '20', '50', '100']}
                            size="small"
                            showTotal={(total, range) => t('paginationText', '{{start}}-{{end}} von {{total}} Einträgen', { start: range[0], end: range[1], total: total })}
                        />
                    )}
                </TabPane>
            </Tabs>
        </Modal>
    );
};

export default AlarmsPopup;