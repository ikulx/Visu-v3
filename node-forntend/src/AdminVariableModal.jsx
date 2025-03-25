import React, { useState, useEffect } from 'react';
import { Modal, Checkbox } from 'antd';
import socket from './socket';
import pinMapping from './pinMapping.json';
import { useUser } from './UserContext';

const AdminVariableModal = ({ visible, record, onCancel, onUpdateSuccess }) => {
  // Extrahiere alle verfügbaren Benutzer (eindeutige Werte) aus pinMapping.json
  const allAvailableUsers = Array.from(new Set(Object.values(pinMapping)));
  const { currentUser } = useUser();

  // Wenn currentUser "fachmann" ist, sollen "admin" und "fachmann" nicht auswählbar sein
  const availableUsers =
    currentUser === 'fachmann'
      ? allAvailableUsers.filter((u) => u !== 'admin' && u !== 'fachmann')
      : allAvailableUsers;

  // Ursprüngliche Benutzerzuordnung aus record.benutzer als Array
  const originalUsers =
    record && record.benutzer ? record.benutzer.split(',').map((u) => u.trim()) : [];

  const [assignedUsers, setAssignedUsers] = useState(originalUsers);

  useEffect(() => {
    if (record) {
      const orig = record.benutzer ? record.benutzer.split(',').map((u) => u.trim()) : [];
      setAssignedUsers(orig);
    }
  }, [record]);

  const handleUpdate = () => {
    // Berechne, welche Benutzer hinzugefügt und welche entfernt werden sollen
    const usersToAdd = assignedUsers.filter((u) => !originalUsers.includes(u));
    const usersToRemove = originalUsers.filter((u) => !assignedUsers.includes(u));

    const payload = {
      key: 'NAME',
      search: record.NAME,
      usersToAdd: usersToAdd,
      usersToRemove: usersToRemove,
    };

    // Sende die differenzielle Aktualisierung über Socket.IO
    socket.emit("update-users-diff", payload, (response) => {
      if (response && response.error) {
        console.error("Fehler beim Update der Benutzer:", response.error);
      } else {
        onUpdateSuccess(record, assignedUsers.join(', '));
      }
    });
  };

  return (
    <Modal
      visible={visible}
      title={`Benutzer Zuordnung ändern: ${record ? record.NAME : ''}`}
      onCancel={onCancel}
      onOk={handleUpdate}
      centered
      okText="Speichern"
      cancelText="Abbrechen"
      width="50vw"
      styles={{
        body: {
          backgroundColor: '#141414',
          color: '#fff',
          padding: '20px',
          minHeight: '40vh',
          overflowY: 'auto',
        },
      }}
    >
      <div style={{ marginBottom: '10px', fontWeight: 'bold', color: '#fff' }}>
        Verfügbare Benutzer:
      </div>
      <Checkbox.Group
        options={availableUsers.map((user) => ({ label: user, value: user }))}
        value={assignedUsers}
        onChange={(checkedValues) => setAssignedUsers(checkedValues)}
        style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}
      />
    </Modal>
  );
};

export default AdminVariableModal;
