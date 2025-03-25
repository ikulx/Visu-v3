// src/EditVariableModal.js
import React, { useState, useEffect, useRef } from 'react';
import { Modal, Input, Select, InputNumber, Grid, Button, Checkbox } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import socket from './socket';
import SwissKeyboard from './SwissKeyboard';
import NumericKeypad from './NumericKeypad';
import { useUser } from './UserContext';
import pinMapping from './pinMapping.json';

const EditVariableModal = ({ visible, record, onCancel, onUpdateSuccess }) => {
  const { i18n } = useTranslation();
  const { xs } = Grid.useBreakpoint();
  const currentLang = i18n.language || 'en';
  const [value, setValue] = useState(record ? record.VAR_VALUE : '');
  const { loggedInUser } = useUser();

  const [keyboardMode, setKeyboardMode] = useState('letters');
  const [isUppercase, setIsUppercase] = useState(true);
  const inputRef = useRef(null);

  // State for user assignment modal
  const [userModalVisible, setUserModalVisible] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [minValue, setMinValue] = useState(record ? record.MIN : '');
  const [maxValue, setMaxValue] = useState(record ? record.MAX : '');

  const isNativeKeyboardAvailable = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  useEffect(() => {
    if (record) {
      setValue(record.VAR_VALUE);
      setSelectedUsers(record.benutzer ? record.benutzer.split(',').map(u => u.trim()) : []);
      setMinValue(record.MIN);
      setMaxValue(record.MAX);
    }
  }, [record]);

  useEffect(() => {
    if (visible && inputRef.current) {
      inputRef.current.focus();
    }
  }, [visible]);

  const getOptions = () => {
    let optionsString = '';
    if (currentLang === 'de') {
      optionsString = record.OPTI_de;
    } else if (currentLang === 'fr') {
      optionsString = record.OPTI_fr;
    } else if (currentLang === 'it') {
      optionsString = record.OPTI_it;
    } else {
      optionsString = record.OPTI_en;
    }
    return optionsString
      .split(',')
      .filter(opt => opt.trim() !== '')
      .map(opt => {
        const [key, label] = opt.split(':').map(s => s.trim());
        return { value: key, label: label };
      });
  };

  const handleUpdate = () => {
    if (record.TYPE === 'num') {
      const numValue = parseFloat(value);
      const min = parseFloat(minValue);
      const max = parseFloat(maxValue);
      if (isNaN(numValue) || numValue < min || numValue > max) {
        alert(`Der Wert muss zwischen ${min} und ${max} liegen.`);
        return;
      }
    }
    const payload = {
      key: 'NAME',
      search: record.NAME,
      target: 'VAR_VALUE',
      value: value,
    };
    socket.emit('update-variable', payload);
    onUpdateSuccess(record, value);
  };

  const insertAtCursor = (newText) => {
    if (inputRef.current && inputRef.current.input) {
      const inputEl = inputRef.current.input;
      const start = inputEl.selectionStart || 0;
      const end = inputEl.selectionEnd || 0;
      const newValue = value.substring(0, start) + newText + value.substring(end);
      if (record.TYPE === 'num') {
        const numValue = parseFloat(newValue);
        const min = parseFloat(minValue);
        const max = parseFloat(maxValue);
        if (!newValue || (numValue >= min && numValue <= max)) {
          setValue(newValue);
          const newPos = start + newText.length;
          setTimeout(() => {
            inputEl.setSelectionRange(newPos, newPos);
            inputEl.focus();
          }, 0);
        }
      } else {
        setValue(newValue);
        const newPos = start + newText.length;
        setTimeout(() => {
          inputEl.setSelectionRange(newPos, newPos);
          inputEl.focus();
        }, 0);
      }
    } else if (record.TYPE !== 'num') {
      setValue(prev => prev + newText);
    }
  };

  const deleteAtCursor = () => {
    if (inputRef.current && inputRef.current.input) {
      const inputEl = inputRef.current.input;
      const start = inputEl.selectionStart || 0;
      const end = inputEl.selectionEnd || 0;
      let newValue = value;
      if (start !== end) {
        newValue = value.substring(0, start) + value.substring(end);
      } else if (start > 0) {
        newValue = value.substring(0, start - 1) + value.substring(end);
      }
      setValue(newValue);
      const newPos = start > 0 ? start - 1 : 0;
      setTimeout(() => {
        inputEl.setSelectionRange(newPos, newPos);
        inputEl.focus();
      }, 0);
    } else {
      setValue(prev => prev.slice(0, -1));
    }
  };

  const handleKeyboardInput = (input) => {
    if (input === 'Löschen') {
      deleteAtCursor();
    } else {
      insertAtCursor(input);
    }
  };

  const moveCursor = (offset) => {
    if (inputRef.current && inputRef.current.input) {
      const inputEl = inputRef.current.input;
      const pos = inputEl.selectionStart || 0;
      const newPos = Math.max(0, pos + offset);
      inputEl.setSelectionRange(newPos, newPos);
      inputEl.focus();
    }
  };

  const handleCursorLeft = () => moveCursor(-1);
  const handleCursorRight = () => moveCursor(1);

  const handleCancel = () => {
    if (record) {
      setValue(record.VAR_VALUE);
      setMinValue(record.MIN);
      setMaxValue(record.MAX);
    }
    onCancel();
  };

  const handleUserAssignment = () => {
    const updates = [
      {
        key: 'NAME',
        search: record.NAME,
        target: 'benutzer',
        value: selectedUsers.join(','),
      },
    ];

    if (record.TYPE === 'num') {
      const minNum = parseFloat(minValue);
      const maxNum = parseFloat(maxValue);
      if (isNaN(minNum) || isNaN(maxNum) || minNum > maxNum) {
        alert('Ungültige MIN- oder MAX-Werte. MIN muss kleiner oder gleich MAX sein.');
        return;
      }

      updates.push(
        {
          key: 'NAME',
          search: record.NAME,
          target: 'MIN',
          value: minValue,
        },
        {
          key: 'NAME',
          search: record.NAME,
          target: 'MAX',
          value: maxValue,
        }
      );
    }

    updates.forEach(update => socket.emit('update-variable', update));
    setUserModalVisible(false);
  };

  const allUsers = Object.values(pinMapping);

  const isCheckboxDisabled = (user) => {
    if (loggedInUser === 'fachmann') {
      return user === 'fachmann' || user === 'admin';
    }
    return false;
  };

  const showGearButton = loggedInUser === 'admin' || loggedInUser === 'fachmann';

  let content = null;
  if (record.TYPE === 'drop') {
    content = (
      <Select
        value={value}
        onChange={setValue}
        style={{ width: '100%' }}
        options={getOptions()}
      />
    );
  } else if (record.TYPE === 'text') {
    content = (
      <div>
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Text eingeben"
          style={{ marginBottom: '15px' }}
        />
        {!isNativeKeyboardAvailable && (
          <SwissKeyboard
            onInput={handleKeyboardInput}
            onDelete={deleteAtCursor}
            onCursorLeft={handleCursorLeft}
            onCursorRight={handleCursorRight}
            mode={keyboardMode}
            setMode={setKeyboardMode}
            onToggleCase={() => {
              setIsUppercase(prev => !prev);
              if (inputRef.current) inputRef.current.focus();
            }}
            isUppercase={isUppercase}
          />
        )}
      </div>
    );
  } else if (record.TYPE === 'num') {
    content = (
      <div>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}>
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => {
              const newValue = e.target.value;
              const numValue = parseFloat(newValue);
              const min = parseFloat(minValue);
              const max = parseFloat(maxValue);
              if (!newValue || (numValue >= min && numValue <= max)) {
                setValue(newValue);
              }
            }}
            placeholder="Wert"
            style={{ width: '20%', textAlign: 'center' }}
          />
          <span style={{ color: '#fff', fontSize: '16px' }}>{record.unit}</span>
        </div>
        <div style={{ marginTop: '8px', color: '#aaa', fontSize: '14px', textAlign: 'center' }}>
          <span>Min: {minValue}</span> <span style={{ marginLeft: '16px' }}>Max: {maxValue}</span>
        </div>
        <NumericKeypad
          onInput={handleKeyboardInput}
          onDelete={deleteAtCursor}
          onClear={() => setValue('')}
        />
      </div>
    );
  } else {
    content = <div>Unbekannter Typ</div>;
  }

  const modalWidth = xs ? "100vw" : "80vw";

  return (
    <>
      <Modal
        visible={visible}
        title={
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {showGearButton && (
              <Button
                type="default"
                icon={<SettingOutlined />}
                style={{ marginRight: '10px' }}
                onClick={() => setUserModalVisible(true)}
              />
            )}
            <span>{`Wert bearbeiten: ${record ? record.NAME : ''}`}</span>
          </div>
        }
        onCancel={handleCancel}
        onOk={handleUpdate}
        centered
        okText="Speichern"
        cancelText="Abbrechen"
        width={modalWidth}
        styles={{
          body: {
            backgroundColor: '#141414',
            color: '#fff',
            padding: '20px',
            minHeight: '60vh',
            overflowY: 'auto',
          },
        }}
      >
        {content}
      </Modal>

      <Modal
        visible={userModalVisible}
        title={`Benutzer zuordnen: ${record ? record.NAME : ''}`}
        onCancel={() => setUserModalVisible(false)}
        onOk={handleUserAssignment}
        centered
        okText="Speichern"
        cancelText="Abbrechen"
        width={xs ? "100vw" : "50vw"}
        styles={{
          body: {
            backgroundColor: '#141414',
            color: '#fff',
            padding: '20px',
          },
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <h3 style={{ color: '#fff' }}>Benutzer</h3>
            <Checkbox.Group
              value={selectedUsers}
              onChange={setSelectedUsers}
              style={{ display: 'flex', flexDirection: 'column' }}
            >
              {allUsers.map(user => (
                <Checkbox
                  key={user}
                  value={user}
                  disabled={isCheckboxDisabled(user)}
                  style={{ color: '#fff', marginBottom: '10px' }}
                >
                  {user}
                </Checkbox>
              ))}
            </Checkbox.Group>
          </div>
          {record.TYPE === 'num' && (
            <div>
              <h3 style={{ color: '#fff' }}>Bereich</h3>
              <div style={{ display: 'flex', gap: '20px' }}>
                <div>
                  <label style={{ color: '#fff', marginRight: '10px' }}>Min:</label>
                  <InputNumber
                    value={minValue}
                    onChange={(val) => setMinValue(val !== null ? val.toString() : '')}
                    style={{ width: '100px', backgroundColor: '#1f1f1f', color: '#fff', borderColor: '#434343' }}
                  />
                  <label style={{ color: '#fff', marginRight: '10px' }}>{record.unit}</label>
                </div>
                <div>
                  <label style={{ color: '#fff', marginRight: '10px' }}>Max:</label>
                  <InputNumber
                    value={maxValue}
                    onChange={(val) => setMaxValue(val !== null ? val.toString() : '')}
                    style={{ width: '100px', backgroundColor: '#1f1f1f', color: '#fff', borderColor: '#434343' }}
                  />
                  <label style={{ color: '#fff', marginRight: '10px' }}>{record.unit}</label>
                </div>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
};

export default EditVariableModal;