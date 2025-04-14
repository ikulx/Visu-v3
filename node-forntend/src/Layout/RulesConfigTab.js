// src/Layout/RulesConfigTab.js
import React, { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, Input, Select, Switch, Popconfirm, message, Space, Divider, Radio } from 'antd';
import { EditOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import socket from '../socket';

const { Option, OptGroup } = Select;

const RulesConfigTab = ({ rules: initialRules, onSave }) => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [localRules, setLocalRules] = useState([]);
  const [variableNames, setVariableNames] = useState([]);
  const [loggingTopics, setLoggingTopics] = useState([]);

  useEffect(() => {
    const rulesWithKeys = (initialRules || []).map((rule, index) => ({
      ...rule,
      conditions: rule.conditions || [],
      actions: rule.actions || [],
      clientKey: rule.id != null ? `db-${rule.id}` : `client-${index}-${Date.now()}`
    }));
    setLocalRules(rulesWithKeys);
  }, [initialRules]);

  useEffect(() => {
    const handleSettings = (settings) => {
      if (Array.isArray(settings)) {
        const names = [...new Set(settings.map(s => s.NAME).filter(Boolean))].sort();
        setVariableNames(names);
      }
    };
    const handleLoggingSettings = (settings) => {
         if (Array.isArray(settings)) {
            const topics = [...new Set(settings.map(s => s.topic).filter(Boolean))].sort();
            setLoggingTopics(topics);
         }
     };

    socket.on('settings-update', handleSettings);
    socket.on('logging-settings-update', handleLoggingSettings);

    socket.emit('request-settings', {});
    socket.emit('request-logging-settings');

    return () => {
      socket.off('settings-update', handleSettings);
      socket.off('logging-settings-update', handleLoggingSettings);
    };
  }, []);

  const showModal = (rule = null) => {
    setEditingRule(rule);
    form.resetFields();
    if (rule) {
      form.setFieldsValue({
        name: rule.name || '',
        condition_logic: rule.condition_logic || 'AND',
        enabled: rule.enabled !== false,
        conditions: (rule.conditions || []).map(cond => ({ ...cond, operator: cond.operator || '=' })),
        actions: (rule.actions || []).map(action => ({
          ...action,
          target_value_bool: (action.action_type === 'set_visibility' || action.action_type === 'set_logging_enabled') ? action.target_value === '1' : undefined
        }))
      });
    } else {
      form.setFieldsValue({
        name: '', condition_logic: 'AND', enabled: true,
        conditions: [{ trigger_variable_name: undefined, operator: '=', trigger_value: '' }],
        actions: [{ target_variable_name: undefined, action_type: 'set_visibility', target_value_bool: true }]
      });
    }
    setIsModalVisible(true);
  };

  const handleCancel = () => { setIsModalVisible(false); setEditingRule(null); };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      let updatedRules;
      const processedActions = (values.actions || []).map(action => { const { target_value_bool, ...restAction } = action; let targetValue; if (action.action_type === 'set_visibility' || action.action_type === 'set_logging_enabled') { targetValue = target_value_bool ? '1' : '0'; } else { targetValue = action.target_value; } return { ...restAction, target_value: String(targetValue ?? '') }; });
      const processedConditions = values.conditions || [];
      const ruleDataToSave = { name: values.name, condition_logic: values.condition_logic, enabled: values.enabled, conditions: processedConditions, actions: processedActions };
      if (editingRule && editingRule.clientKey != null) { updatedRules = localRules.map(rule => rule.clientKey === editingRule.clientKey ? { ...editingRule, ...ruleDataToSave } : rule ); }
      else { const newRule = { ...ruleDataToSave, clientKey: `new-${Date.now()}` }; updatedRules = [...localRules, newRule]; }
      const rulesToSend = updatedRules.map(({ clientKey, ...rest }) => rest);
      setLocalRules(updatedRules); onSave(rulesToSend); setIsModalVisible(false); setEditingRule(null);
    } catch (info) { console.log('Validate Failed:', info); message.error(t('validationFailed')); }
  };

  const handleDelete = (clientKeyToDelete) => { if (clientKeyToDelete == null) return; const updatedRules = localRules.filter(rule => rule.clientKey !== clientKeyToDelete); const rulesToSend = updatedRules.map(({ clientKey, ...rest }) => rest); setLocalRules(updatedRules); onSave(rulesToSend); };

  const columns = [
     { title: t('ID'), dataIndex: 'id', key: 'id', width: 60 },
     { title: t('Name'), dataIndex: 'name', key: 'name', width: 150, ellipsis: true },
     { title: t('Conditions'), key: 'conditions', width: 120, render: (_, r) => `${r.conditions?.length || 0} (${r.condition_logic || 'AND'})` },
     { title: t('Actions'), dataIndex: 'actions', key: 'actions', width: 100, render: (a) => `${Array.isArray(a) ? a.length : 0} ${t('Actions')}` },
     { title: t('Enabled'), dataIndex: 'enabled', key: 'enabled', render: (e) => (e !== false ? t('Yes') : t('No')), width: 80 },
     { title: t('Actions'), key: 'tableActions', fixed: 'right', width: 100, render: (_, r) => ( <Space size="middle"> <Button icon={<EditOutlined />} onClick={() => showModal(r)} /> <Popconfirm title={t('confirmDeleteRule')} onConfirm={() => handleDelete(r.clientKey)} okText={t('Yes')} cancelText={t('No')}> <Button danger icon={<DeleteOutlined />} /> </Popconfirm> </Space> ), },
   ];

  return (
    <div>
      <Button type="primary" icon={<PlusOutlined />} onClick={() => showModal()} style={{ marginBottom: 16, backgroundColor: '#ffb000', borderColor: '#ffb000' }}>{t('Add Rule')}</Button>
      <Table columns={columns} dataSource={localRules} rowKey="clientKey" pagination={{ pageSize: 10 }} style={{ backgroundColor: '#1f1f1f' }} scroll={{ x: 710 }} />
      <Modal title={editingRule ? t('Edit Rule') : t('Add Rule')} open={isModalVisible} onOk={handleSave} onCancel={handleCancel} okText={t('Save')} cancelText={t('Cancel')} width={800} styles={{ body: { backgroundColor: '#1f1f1f', color: '#fff', maxHeight: '70vh', overflowY: 'auto' }, header: { backgroundColor: '#1f1f1f', color: '#fff', borderBottom: '1px solid #434343' }, footer: { borderTop: '1px solid #434343' } }}>
        <Form form={form} layout="vertical" name="ruleForm">
          <Form.Item name="name" label={t('Rule Name (Optional)')}><Input /></Form.Item>
          <Form.Item name="enabled" label={t('Rule Enabled')} valuePropName="checked" initialValue={true}><Switch checkedChildren={t('Yes')} unCheckedChildren={t('No')} /></Form.Item>
          <Form.Item name="condition_logic" label={t('Condition Logic')} initialValue="AND"><Radio.Group><Radio value="AND">{t('AND (All true)')}</Radio><Radio value="OR">{t('OR (Any true)')}</Radio></Radio.Group></Form.Item>
          <Divider orientation="left" style={{ color: '#aaa', borderColor: '#434343' }}>{t('Conditions (IF)')}</Divider>
          <Form.List name="conditions">{(fields, { add, remove }) => (<div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}> {fields.map(({ key, name: index, ...restField }) => (<Space key={key} style={{ display: 'flex', border: '1px dashed #434343', padding: '8px', borderRadius: '4px' }} align="baseline" wrap>
              <Form.Item {...restField} name={[index, 'trigger_variable_name']} rules={[{ required: true }]} noStyle><Select showSearch placeholder={t('Select Variable')} optionFilterProp="children" virtual={false} style={{ width: 180 }}>{variableNames.map(v => <Option key={v} value={v}>{v}</Option>)}</Select></Form.Item>
              <Form.Item {...restField} name={[index, 'operator']} rules={[{ required: true }]} initialValue="=" noStyle><Select style={{ width: 80 }}><Option value="=">=</Option><Option value="!=">!=</Option><Option value=">">&gt;</Option><Option value="<">&lt;</Option><Option value=">=">&gt;=</Option><Option value="<=">&lt;=</Option></Select></Form.Item>
              <Form.Item {...restField} name={[index, 'trigger_value']} rules={[{ required: true }]} noStyle><Input placeholder={t('Value')} style={{ width: 120 }} /></Form.Item>
              <Button type="link" danger icon={<DeleteOutlined />} onClick={() => remove(index)} style={{ marginLeft: 'auto' }} />
          </Space>))} <Form.Item><Button type="dashed" onClick={() => add({ operator: '=', trigger_value: '' })} block icon={<PlusOutlined />}>{t('Add Condition')}</Button></Form.Item> </div>)}</Form.List>
          <Divider orientation="left" style={{ color: '#aaa', borderColor: '#434343' }}>{t('Actions (THEN)')}</Divider>
          <Form.List name="actions">{(fields, { add, remove }, { errors }) => (<div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}> {fields.map(({ key, name: actionIndex, ...restField }, index) => (<div key={key} style={{ border: '1px dashed #434343', padding: '8px', borderRadius: '4px' }}><Space style={{ display: 'flex' }} align="baseline" wrap>
              <Form.Item {...restField} name={[actionIndex, 'target_variable_name']} label={`${t('Target')} ${index + 1}`} rules={[{ required: true }]} style={{ marginBottom: 5, flexGrow: 1, minWidth: 200 }}>
                 <Select showSearch placeholder={t('Select Target Var/Topic')} optionFilterProp="children" virtual={false}><OptGroup label={t('QHMI Variables')}>{variableNames.map(vName => <Option key={`var-${vName}`} value={vName}>{vName}</Option>)}</OptGroup><OptGroup label={t('Logging Topics')}>{loggingTopics.map(topic => <Option key={`log-${topic}`} value={topic}>{topic}</Option>)}</OptGroup></Select>
              </Form.Item>
              <Form.Item {...restField} name={[actionIndex, 'action_type']} label={t('Action Type')} rules={[{ required: true }]} initialValue="set_visibility" style={{ marginBottom: 5, minWidth: 180 }}>
                 <Select>{/*onChange Loescht ggf alten Wert?*/}
                     <Option value="set_visibility">{t('Set Visibility')}</Option>
                     <Option value="set_logging_enabled">{t('Set Logging Enabled')}</Option>
                     {/* <Option value="set_value">{t('Set Value')}</Option> */}
                 </Select>
              </Form.Item>
              <Form.Item noStyle shouldUpdate={(prev, curr) => prev.actions?.[actionIndex]?.action_type !== curr.actions?.[actionIndex]?.action_type}>
                 {({ getFieldValue }) => { const actionType = getFieldValue(['actions', actionIndex, 'action_type']); if (actionType === 'set_visibility' || actionType === 'set_logging_enabled') { return (<Form.Item {...restField} name={[actionIndex, 'target_value_bool']} label={t('Set To')} valuePropName="checked" initialValue={true} style={{ marginBottom: 5 }}><Switch checkedChildren={actionType === 'set_visibility' ? t('Visible') : t('Enabled')} unCheckedChildren={actionType === 'set_visibility' ? t('Hidden') : t('Disabled')} /></Form.Item> ); } return <Form.Item label=" " style={{ marginBottom: 5 }}><span style={{color: '#888'}}>({t('No value needed')})</span></Form.Item>; }}
              </Form.Item>
              <Button type="link" danger icon={<DeleteOutlined />} onClick={() => remove(actionIndex)} style={{ alignSelf: 'center' }} />
            </Space></div>))} <Form.Item><Button type="dashed" onClick={() => add({ action_type: 'set_visibility', target_value_bool: true })} block icon={<PlusOutlined />}>{t('Add Action')}</Button></Form.Item> <Form.ErrorList errors={errors} /> </div>)}
          </Form.List>
        </Form>
      </Modal>
    </div>
  );
};

export default RulesConfigTab;