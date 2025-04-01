import React, { useState, useEffect } from 'react';
import { Modal, Table, Button, Input, Form } from 'antd';
import socket from '../socket'; // Stellen Sie sicher, dass Socket.IO korrekt eingerichtet ist

const LoggingSettingsModal = ({ visible, onClose }) => {
  const [loggingSettings, setLoggingSettings] = useState([]); // Zustand für Logging-Einstellungen
  const [newTopic, setNewTopic] = useState(''); // Zustand für neuen Topic-Eintrag

  // Beim Öffnen des Modals Logging-Einstellungen anfordern
  useEffect(() => {
    if (visible) {
      socket.emit('request-logging-settings');
    }
  }, [visible]);

  // Auf Updates der Logging-Einstellungen lauschen
  useEffect(() => {
    socket.on('logging-settings-update', (data) => {
      setLoggingSettings(data);
    });
    return () => {
      socket.off('logging-settings-update');
    };
  }, []);

  // Neuen Logging-Topic hinzufügen
  const handleAddLoggingSetting = () => {
    if (newTopic.trim()) {
      socket.emit('update-logging-setting', { topic: newTopic, enabled: true });
      setNewTopic('');
    }
  };

  // Logging-Status umschalten (enabled/disabled)
  const handleToggleLoggingSetting = (topic, enabled) => {
    socket.emit('update-logging-setting', { topic, enabled: !enabled });
  };

  // Tabellenspalten definieren
  const columns = [
    { title: 'Topic', dataIndex: 'topic', key: 'topic' },
    {
      title: 'Enabled',
      dataIndex: 'enabled',
      key: 'enabled',
      render: (enabled, record) => (
        <Button onClick={() => handleToggleLoggingSetting(record.topic, enabled)}>
          {enabled ? 'Deaktivieren' : 'Aktivieren'}
        </Button>
      ),
    },
  ];

  return (
    <Modal
      visible={visible}
      onCancel={onClose}
      footer={null}
      title="Logging-Einstellungen"
      width="80%"
    >
      <Form layout="inline" onFinish={handleAddLoggingSetting}>
        <Form.Item>
          <Input
            placeholder="Neuer Topic"
            value={newTopic}
            onChange={(e) => setNewTopic(e.target.value)}
          />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit">
            Hinzufügen
          </Button>
        </Form.Item>
      </Form>
      <Table
        dataSource={loggingSettings}
        columns={columns}
        rowKey="topic"
        style={{ marginTop: '20px' }}
      />
    </Modal>
  );
};

export default LoggingSettingsModal;