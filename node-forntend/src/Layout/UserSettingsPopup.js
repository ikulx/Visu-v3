// src/Layout/UserSettingsPopup.js
import React, { useState, useEffect, useCallback } from 'react';
// Switch, Alert, Select, InputNumber hinzugefügt
import { Modal, Tabs, List, Button, Input, Checkbox, Form, Space, Popconfirm, message, Spin, Empty, Divider, Typography, Select, InputNumber, Switch, Alert } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, SaveOutlined, CloseOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
// --- useUser wird hier NICHT mehr direkt benötigt, currentUser kommt als Prop ---
// import { useUser } from '../UserContext';
import socket from '../socket';

const { TabPane } = Tabs;
const { Text, Paragraph } = Typography;

// Verfügbare Prioritäten
const ALL_PRIORITIES = ['prio1', 'prio2', 'prio3', 'warning', 'info'];

// Empfängt currentUser als Prop
const UserSettingsPopup = ({ visible, onClose, currentUser }) => { // SMS Props entfernt
    const { t } = useTranslation();
    const loggedInUser = currentUser; // Verwende die Prop
    const [targets, setTargets] = useState({ email: [], phone: [] });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [editingTargetId, setEditingTargetId] = useState(null);
    const [editForm] = Form.useForm();
    const [addEmailForm] = Form.useForm();
    const [addPhoneForm] = Form.useForm();

    // Lokaler State für SMS-Switch
    const [smsEnabledLocal, setSmsEnabledLocal] = useState(false);

    // --- DEBUGGING LOG HINZUGEFÜGT ---
    console.log('[UserSettingsPopup] Received currentUser prop:', currentUser);
    // --- ENDE DEBUGGING ---

    // Berechtigung prüfen
    const canManageSmsToggle = ['admin', 'fachmann'].includes(loggedInUser);
    // --- DEBUGGING LOG HINZUGEFÜGT ---
    console.log('[UserSettingsPopup] Check canManageSmsToggle based on received prop:', canManageSmsToggle);
    // --- ENDE DEBUGGING ---


    const priorityOptions = ALL_PRIORITIES.map(p => ({ label: t(`priority_${p}`, p), value: p }));

    // Funktion zum Laden der Targets
    const fetchTargets = useCallback(() => {
        setLoading(true);
        setError(null);
        socket.emit('request-notification-targets');
    }, []);

    // Effekt zum Laden & Listener
    useEffect(() => {
        // Handler für Target-Updates
        const handleTargetsUpdate = (data) => {
            console.log("[UserSettingsPopup] Received 'notification-targets-update'", data); // LOG
            const emailTargets = Array.isArray(data) ? data.filter(t => t.type === 'email') : [];
            const phoneTargets = Array.isArray(data) ? data.filter(t => t.type === 'phone') : [];
            setTargets({ email: emailTargets, phone: phoneTargets });
            setLoading(false); setError(null);
        };
        // Handler für Target-Fehler
        const handleTargetsError = (err) => {
             console.error("Received notification-targets-error:", err);
             setError(err.message || 'Fehler beim Laden/Speichern der Ziele.');
             setLoading(false);
         };
        // Handler für SMS-Status Update
        const handleSmsStatusUpdate = (data) => {
            if (typeof data?.enabled === 'boolean') {
                 console.log("[UserSettingsPopup] Received 'sms-notification-status-update'", data); // LOG
                 setSmsEnabledLocal(data.enabled); // Lokalen State aktualisieren
            }
        }

        if (visible) {
             console.log("[UserSettingsPopup] Opening - Requesting initial data..."); // LOG
             fetchTargets(); // Targets laden
             socket.emit('request-sms-notification-status'); // Initialen SMS-Status anfordern

             socket.on('notification-targets-update', handleTargetsUpdate);
             socket.on('notification-targets-error', handleTargetsError);
             socket.on('sms-notification-status-update', handleSmsStatusUpdate); // Auf Updates lauschen
        }

        return () => { // Cleanup
             socket.off('notification-targets-update', handleTargetsUpdate);
             socket.off('notification-targets-error', handleTargetsError);
             socket.off('sms-notification-status-update', handleSmsStatusUpdate);
             setEditingTargetId(null); setError(null);
        };
    }, [visible, fetchTargets]);

    // Handler für SMS-Switch (sendet jetzt User mit)
    const handleToggleSmsNotifications = (checked) => {
        console.log(`[UserSettingsPopup] Toggling SMS status to: ${checked} by user: ${loggedInUser}`);
        // Sende Event MIT dem aktuellen Benutzer (aus Prop erhalten)
        socket.emit('set-sms-notification-status', {
            enabled: checked,
            user: loggedInUser // Wichtig: Benutzer hier mitsenden!
        });
    };

    // Andere Handler (handleAddTarget, handleDeleteTarget, etc. wie zuvor)
    const handleAddTarget = (type, values) => {
        const { target, priorities, delay_minutes } = values;
        if (!target || !target.trim()) { message.error(t('targetCannotBeEmpty')); return; }
        if (type === 'email' && !/\S+@\S+\.\S+/.test(target)) { message.error(t('invalidEmailFormat')); return; }
        if (type === 'phone' && !/^\+?[0-9\s-()]{5,}$/.test(target)) { message.error(t('invalidPhoneFormat')); return; }
        const delay = (typeof delay_minutes === 'number') ? Math.max(0, Math.floor(delay_minutes)) : 0;
        setLoading(true);
        socket.emit('add-notification-target', { type, target: target.trim(), priorities: priorities || [], delay_minutes: delay });
        if (type === 'email') addEmailForm.resetFields();
        if (type === 'phone') addPhoneForm.resetFields();
    };
    const handleDeleteTarget = (id) => { setLoading(true); socket.emit('delete-notification-target', { id }); };
    const handleEditTarget = (target) => {
         setEditingTargetId(target.id);
         const currentPriorities = (target.priorities || '').split(',').filter(p => p && ALL_PRIORITIES.includes(p));
         editForm.setFieldsValue({
             priorities: currentPriorities,
             delay_minutes: target.delay_minutes || 0 // Delay immer setzen
         });
     };
    const handleSaveEdit = (id, type) => {
          editForm.validateFields()
             .then(values => {
                 const { priorities, delay_minutes } = values;
                 const delay = (typeof delay_minutes === 'number') ? Math.max(0, Math.floor(delay_minutes)) : 0; // Delay immer übernehmen
                 setLoading(true);
                 socket.emit('update-notification-target', { id, type: type, priorities: priorities || [], delay_minutes: delay });
                 setEditingTargetId(null);
             })
             .catch(info => { message.error(t('checkInput')); });
     };
    const handleCancelEdit = () => { setEditingTargetId(null); };


    // Funktion zum Rendern einer Liste von Zielen (Email oder Phone)
    const renderTargetList = (type, data) => (
         <Spin spinning={loading}>
            {error && <Alert message={error} type="error" showIcon style={{ marginBottom: 16 }} />}
            <List
                itemLayout="horizontal"
                dataSource={data}
                locale={{ emptyText: <Empty description={t('noTargetsConfigured')} /> }}
                renderItem={item => (
                    <List.Item
                        actions={editingTargetId === item.id ? [
                            <Button key="save" type="link" icon={<SaveOutlined />} onClick={() => handleSaveEdit(item.id, item.type)} aria-label={t('save')} />,
                            <Button key="cancel" type="link" icon={<CloseOutlined />} onClick={handleCancelEdit} aria-label={t('cancel')} />
                        ] : [
                            <Button key="edit" type="link" icon={<EditOutlined />} onClick={() => handleEditTarget(item)} aria-label={t('editPriorities')} />,
                            <Popconfirm key="delete" title={t('confirmDeleteTarget')} onConfirm={() => handleDeleteTarget(item.id)} okText={t('yes')} cancelText={t('no')} >
                                 <Button type="link" danger icon={<DeleteOutlined />} aria-label={t('delete')} />
                            </Popconfirm>
                        ]}
                    >
                        <List.Item.Meta
                            title={<Text strong style={{ wordBreak: 'break-all' }}>{item.target}</Text>}
                            description={
                                <Space direction="vertical" style={{width: '100%', marginTop: '8px'}}>
                                    {editingTargetId === item.id ? (
                                        // Bearbeitungsmodus
                                        <Form form={editForm} layout="vertical" >
                                            <Form.Item name="priorities" label={t('Prioritäten')} style={{ marginBottom: '8px' }}>
                                                <Checkbox.Group options={priorityOptions} />
                                            </Form.Item>
                                            <Form.Item name="delay_minutes" label={t('delayInMinutes')} style={{marginBottom: 0}}>
                                                <InputNumber min={0} step={1} style={{ width: '80px' }} />
                                            </Form.Item>
                                        </Form>
                                    ) : (
                                        // Ansichtsmodus
                                        <>
                                            <Checkbox.Group options={priorityOptions} value={(item.priorities || '').split(',').filter(p => p)} disabled />
                                            {item.delay_minutes > 0 && (
                                                 <Text type="secondary">({t('delayLabel')} {item.delay_minutes} {t('minutesSuffix')})</Text>
                                            )}
                                         </>
                                    )}
                                 </Space>
                            }
                        />
                    </List.Item>
                )}
            />
            <Divider />
            {/* Formular zum Hinzufügen neuer Ziele */}
            <Paragraph strong>{t('addNewTarget')}:</Paragraph>
            <Form
                form={type === 'email' ? addEmailForm : addPhoneForm}
                layout="inline"
                onFinish={(values) => handleAddTarget(type, values)}
                style={{ marginTop: '10px', flexWrap: 'wrap', gap: '8px' }}
             >
                <Form.Item name="target" rules={[{ required: true, message: t('pleaseEnterTarget') }]} style={{ flexGrow: 1, marginRight: 0, minWidth: '200px' }}>
                     <Input placeholder={type === 'email' ? t('emailAddress') : t('phoneNumber')} />
                </Form.Item>
                <Form.Item name="priorities" style={{ minWidth: '200px', marginRight: 0 }}>
                     <Select mode="multiple" allowClear style={{ width: '100%' }} placeholder={t('selectPriorities')} options={priorityOptions} maxTagCount="responsive" />
                </Form.Item>
                <Form.Item name="delay_minutes" label={t('delay')} initialValue={0} style={{ marginRight: 0 }}>
                     <InputNumber min={0} step={1} addonAfter={t('minutesSuffixShort')} style={{ width: '120px' }} />
                </Form.Item>
                <Form.Item>
                     <Button type="primary" htmlType="submit" icon={<PlusOutlined />}>
                          {t('add')}
                     </Button>
                </Form.Item>
            </Form>
        </Spin>
    );


    return (
        <Modal
            title={t('userSettingsTitle')}
            open={visible}
            onCancel={onClose}
            footer={null}
            width={700}
            destroyOnClose
        >
            <Paragraph>
                 {/* Nutzt jetzt loggedInUser (welches = currentUser ist) */}
                 {t('currentUser')}: <Text strong>{loggedInUser || t('notLoggedIn')}</Text>
             </Paragraph>
             <Divider/>
             <Paragraph>
                 {t('configureAlarmNotifications')}
                 {' '}{t('targetDelayInfo')} {/* Allgemeiner Text */}
             </Paragraph>

             <Tabs defaultActiveKey="email" destroyInactiveTabPane>
                 <TabPane tab={t('emailNotifications')} key="email">
                     {renderTargetList('email', targets.email)}
                 </TabPane>
                 <TabPane tab={t('phoneNotifications')} key="phone">
                     <div style={{ marginBottom: '16px' }}>
                         {/* Zeige Switch nur wenn canManageSmsToggle true ist */}
                         {canManageSmsToggle && (
                             <Space align="center">
                                 <Switch
                                     checked={smsEnabledLocal} // Nutzt lokalen State
                                     onChange={handleToggleSmsNotifications} // Nutzt lokalen Handler
                                     checkedChildren={t('active')}
                                     unCheckedChildren={t('inactive')}
                                 />
                                 <Text strong>{t('smsNotificationsActive')}</Text>
                             </Space>
                          )}
                     </div>

                     {smsEnabledLocal ? ( // Nutzt lokalen State
                         renderTargetList('phone', targets.phone)
                     ) : (
                         <Alert
                             message={t('smsRequiresSubscriptionTitle')}
                             description={t('smsRequiresSubscriptionText')}
                             type="info"
                             showIcon
                         />
                     )}
                 </TabPane>
             </Tabs>
        </Modal>
    );
};

export default UserSettingsPopup;