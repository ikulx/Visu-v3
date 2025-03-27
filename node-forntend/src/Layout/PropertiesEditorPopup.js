import React, { useState, useEffect } from 'react';
import { Modal, Button, Input, Space, Radio, Typography, Select } from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';

const { Title } = Typography;
const { Option } = Select;

const PropertiesEditorPopup = ({ visible, onClose, properties, qhmiVariables, onSave }) => {
  const [localProperties, setLocalProperties] = useState([]);

  useEffect(() => {
    const initialProperties = Object.entries(properties).map(([key, prop], index) => ({
      id: `prop-${index}-${Date.now()}`,
      key,
      value: prop.source === 'static' ? prop.currentValue : null,
      qhmi_variable_id: prop.source === 'dynamic' ? prop.qhmi_variable_id : null,
      source: prop.source
    }));
    setLocalProperties(initialProperties);
  }, [properties, qhmiVariables]);

  const handleAddProperty = () => {
    const newProperty = {
      id: `newProp-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      key: '',
      value: '',
      qhmi_variable_id: null,
      source: 'static',
    };
    setLocalProperties([...localProperties, newProperty]);
  };

  const handleUpdateProperty = (id, field, newValue) => {
    const updatedProperties = localProperties.map(prop => {
      if (prop.id === id) {
        const updatedProp = { ...prop, [field]: newValue };
        if (field === 'source') {
          if (newValue === 'static') {
            updatedProp.qhmi_variable_id = null;
          } else if (newValue === 'dynamic') {
            updatedProp.value = null;
          }
        }
        return updatedProp;
      }
      return prop;
    });
    setLocalProperties(updatedProperties);
  };

  const handleDeleteProperty = (id) => {
    setLocalProperties(localProperties.filter(prop => prop.id !== id));
  };

  const handleSave = () => {
    const saveProperties = {};
    localProperties.forEach(prop => {
      if (prop.key) {
        saveProperties[prop.key] = prop.source === 'dynamic' && prop.qhmi_variable_id
          ? qhmiVariables.find(v => v.id === prop.qhmi_variable_id)?.NAME + '.VAR_VALUE'
          : prop.value;
      }
    });
    onSave(saveProperties);
  };

  return (
    <Modal
      title="Properties bearbeiten"
      open={visible}
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={onClose}>Abbrechen</Button>,
        <Button key="save" type="primary" onClick={handleSave}>Speichern</Button>,
      ]}
      width={800}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <Title level={5}>Properties</Title>
        {localProperties.map(prop => (
          <Space key={prop.id} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
            <Input
              value={prop.key}
              onChange={(e) => handleUpdateProperty(prop.id, 'key', e.target.value)}
              style={{ width: 150 }}
              placeholder="Key"
            />
            <Radio.Group
              value={prop.source}
              onChange={(e) => handleUpdateProperty(prop.id, 'source', e.target.value)}
            >
              <Radio value="static">Statisch</Radio>
              <Radio value="dynamic">Dynamisch</Radio>
            </Radio.Group>
            {prop.source === 'static' ? (
              <Input
                value={prop.value}
                onChange={(e) => handleUpdateProperty(prop.id, 'value', e.target.value)}
                style={{ width: 200 }}
                placeholder="Value"
              />
            ) : (
              <Select
                value={prop.qhmi_variable_id}
                onChange={(value) => handleUpdateProperty(prop.id, 'qhmi_variable_id', value)}
                style={{ width: 200 }}
                placeholder="Wähle eine Variable"
              >
                {qhmiVariables.map(varItem => (
                  <Option key={varItem.id} value={varItem.id}>
                    {varItem.NAME}
                  </Option>
                ))}
              </Select>
            )}
            <MinusCircleOutlined onClick={() => handleDeleteProperty(prop.id)} />
          </Space>
        ))}
        <Button
          type="dashed"
          onClick={handleAddProperty}
          block
          icon={<PlusOutlined />}
          style={{ marginTop: 8 }}
        >
          Property hinzufügen
        </Button>
      </div>
    </Modal>
  );
};

export default PropertiesEditorPopup;