import React, { useState, useEffect, useRef } from 'react';
import { Modal, Input, Select, InputNumber, Grid, Button, Checkbox } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import socket from './socket';
import SwissKeyboard from './SwissKeyboard';
import NumericKeypad from './NumericKeypad';
import { useUser } from './UserContext';
import pinMapping from './pinMapping.json';

const EditVariableModal = ({ visible, record, records, onCancel, onUpdateSuccess }) => {
  const { i18n } = useTranslation();
  const { xs } = Grid.useBreakpoint();
  const currentLang = i18n.language || 'en';
  const [values, setValues] = useState({});
  const { loggedInUser } = useUser();

  const [keyboardMode, setKeyboardMode] = useState('letters');
  const [isUppercase, setIsUppercase] = useState(true);
  const inputRefs = useRef({});

  const [userModalVisible, setUserModalVisible] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState({});
  const [minValues, setMinValues] = useState({});
  const [maxValues, setMaxValues] = useState({});

  // Normalisiere records: Wenn nur record übergeben wird, mache daraus ein Array
  const normalizedRecords = records || (record ? [record] : []);

  useEffect(() => {
    if (normalizedRecords.length > 0) {
      const initialValues = {};
      const initialUsers = {};
      const initialMin = {};
      const initialMax = {};
      normalizedRecords.forEach(rec => {
        initialValues[rec.NAME] = rec.VAR_VALUE;
        initialUsers[rec.NAME] = rec.benutzer ? rec.benutzer.split(',').map(u => u.trim()) : [];
        initialMin[rec.NAME] = rec.MIN;
        initialMax[rec.NAME] = rec.MAX;
      });
      setValues(initialValues);
      setSelectedUsers(initialUsers);
      setMinValues(initialMin);
      setMaxValues(initialMax);
    }
  }, [normalizedRecords]);

  useEffect(() => {
    if (visible && normalizedRecords.length > 0) {
      normalizedRecords.forEach(rec => {
        if (inputRefs.current[rec.NAME]) {
          inputRefs.current[rec.NAME].focus();
        }
      });
    }
  }, [visible, normalizedRecords]);

  // Funktion zur Bestimmung des Labels basierend auf der aktuellen Sprache
  const getLabel = (rec) => {
    switch (currentLang) {
      case 'de':
        return rec.NAME_de && rec.NAME_de.trim() ? rec.NAME_de : rec.NAME;
      case 'fr':
        return rec.NAME_fr && rec.NAME_fr.trim() ? rec.NAME_fr : (rec.NAME_de && rec.NAME_de.trim() ? rec.NAME_de : rec.NAME);
      case 'it':
        return rec.NAME_it && rec.NAME_it.trim() ? rec.NAME_it : (rec.NAME_de && rec.NAME_de.trim() ? rec.NAME_de : rec.NAME);
      case 'en':
        return rec.NAME_en && rec.NAME_en.trim() ? rec.NAME_en : (rec.NAME_de && rec.NAME_de.trim() ? rec.NAME_de : rec.NAME);
      default:
        return rec.NAME_de && rec.NAME_de.trim() ? rec.NAME_de : rec.NAME;
    }
  };

  // Funktion zur Bestimmung der Optionen basierend auf der aktuellen Sprache
  const getOptions = (rec) => {
    let optionsString = '';
    switch (currentLang) {
      case 'de':
        optionsString = rec.OPTI_de && rec.OPTI_de.trim() ? rec.OPTI_de : rec.OPTI_en;
        break;
      case 'fr':
        optionsString = rec.OPTI_fr && rec.OPTI_fr.trim() ? rec.OPTI_fr : (rec.OPTI_de && rec.OPTI_de.trim() ? rec.OPTI_de : rec.OPTI_en);
        break;
      case 'it':
        optionsString = rec.OPTI_it && rec.OPTI_it.trim() ? rec.OPTI_it : (rec.OPTI_de && rec.OPTI_de.trim() ? rec.OPTI_de : rec.OPTI_en);
        break;
      case 'en':
        optionsString = rec.OPTI_en && rec.OPTI_en.trim() ? rec.OPTI_en : (rec.OPTI_de && rec.OPTI_de.trim() ? rec.OPTI_de : rec.OPTI_en);
        break;
      default:
        optionsString = rec.OPTI_de && rec.OPTI_de.trim() ? rec.OPTI_de : rec.OPTI_en;
    }
    // Wenn optionsString leer oder undefined ist, geben wir ein leeres Array zurück
    if (!optionsString || !optionsString.trim()) return [];
    return optionsString
      .split(',')
      .filter(opt => opt.trim() !== '')
      .map(opt => {
        const [key, label] = opt.split(':').map(s => s.trim());
        return { value: key, label };
      });
  };

  const handleUpdate = () => {
    normalizedRecords.forEach(rec => {
      if (rec.TYPE === 'num') {
        const numValue = parseFloat(values[rec.NAME]);
        const min = parseFloat(minValues[rec.NAME]);
        const max = parseFloat(maxValues[rec.NAME]);
        if (isNaN(numValue) || numValue < min || numValue > max) {
          alert(`Der Wert für ${getLabel(rec)} muss zwischen ${min} und ${max} liegen.`);
          return;
        }
      }
      const payload = {
        key: 'NAME',
        search: rec.NAME,
        target: 'VAR_VALUE',
        value: values[rec.NAME],
      };
      socket.emit('update-variable', payload);
    });
    onUpdateSuccess();
  };

  const insertAtCursor = (recordName, newText) => {
    const inputEl = inputRefs.current[recordName]?.input;
    if (inputEl) {
      const start = inputEl.selectionStart || 0;
      const end = inputEl.selectionEnd || 0;
      const newValue = values[recordName].substring(0, start) + newText + values[recordName].substring(end);
      setValues(prev => ({ ...prev, [recordName]: newValue }));
      const newPos = start + newText.length;
      setTimeout(() => {
        inputEl.setSelectionRange(newPos, newPos);
        inputEl.focus();
      }, 0);
    } else {
      setValues(prev => ({ ...prev, [recordName]: prev[recordName] + newText }));
    }
  };

  const deleteAtCursor = (recordName) => {
    const inputEl = inputRefs.current[recordName]?.input;
    if (inputEl) {
      const start = inputEl.selectionStart || 0;
      const end = inputEl.selectionEnd || 0;
      let newValue = values[recordName];
      if (start !== end) {
        newValue = values[recordName].substring(0, start) + values[recordName].substring(end);
      } else if (start > 0) {
        newValue = values[recordName].substring(0, start - 1) + values[recordName].substring(end);
      }
      setValues(prev => ({ ...prev, [recordName]: newValue }));
      const newPos = start > 0 ? start - 1 : 0;
      setTimeout(() => {
        inputEl.setSelectionRange(newPos, newPos);
        inputEl.focus();
      }, 0);
    } else {
      setValues(prev => ({ ...prev, [recordName]: prev[recordName].slice(0, -1) }));
    }
  };

  const handleKeyboardInput = (recordName, input) => {
    if (input === 'Löschen') {
      deleteAtCursor(recordName);
    } else {
      insertAtCursor(recordName, input);
    }
  };

  const moveCursor = (recordName, offset) => {
    const inputEl = inputRefs.current[recordName]?.input;
    if (inputEl) {
      const pos = inputEl.selectionStart || 0;
      const newPos = Math.max(0, pos + offset);
      inputEl.setSelectionRange(newPos, newPos);
      inputEl.focus();
    }
  };

  const handleCancel = () => {
    if (normalizedRecords.length > 0) {
      const resetValues = {};
      normalizedRecords.forEach(rec => {
        resetValues[rec.NAME] = rec.VAR_VALUE;
      });
      setValues(resetValues);
    }
    onCancel();
  };

  const handleUserAssignment = () => {
    normalizedRecords.forEach(rec => {
      const updates = [
        {
          key: 'NAME',
          search: rec.NAME,
          target: 'benutzer',
          value: selectedUsers[rec.NAME].join(','),
        },
      ];

      if (rec.TYPE === 'num') {
        const minNum = parseFloat(minValues[rec.NAME]);
        const maxNum = parseFloat(maxValues[rec.NAME]);
        if (isNaN(minNum) || isNaN(maxNum) || minNum > maxNum) {
          alert(`Ungültige MIN- oder MAX-Werte für ${getLabel(rec)}.`);
          return;
        }
        updates.push(
          { key: 'NAME', search: rec.NAME, target: 'MIN', value: minValues[rec.NAME] },
          { key: 'NAME', search: rec.NAME, target: 'MAX', value: maxValues[rec.NAME] }
        );
      }

      updates.forEach(update => socket.emit('update-variable', update));
    });
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

  const modalWidth = xs ? "100vw" : "80vw";

  return (
    <>
      <Modal
        visible={visible}
        title="Variablen bearbeiten"
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
        {normalizedRecords.map(rec => (
          <div key={rec.NAME} style={{ marginBottom: '20px' }}>
            <h3>{getLabel(rec)}</h3> {/* Verwende sprachspezifisches Label */}
            {rec.TYPE === 'drop' ? (
              <Select
                value={values[rec.NAME]}
                onChange={value => setValues(prev => ({ ...prev, [rec.NAME]: value }))}
                style={{ width: '100%' }}
                options={getOptions(rec)} // Verwende sprachspezifische Optionen
              />
            ) : rec.TYPE === 'text' ? (
              <div>
                <Input
                  ref={el => (inputRefs.current[rec.NAME] = el)}
                  value={values[rec.NAME]}
                  onChange={e => setValues(prev => ({ ...prev, [rec.NAME]: e.target.value }))}
                  placeholder="Text eingeben"
                  style={{ marginBottom: '15px' }}
                />
                <SwissKeyboard
                  onInput={input => handleKeyboardInput(rec.NAME, input)}
                  onDelete={() => deleteAtCursor(rec.NAME)}
                  onCursorLeft={() => moveCursor(rec.NAME, -1)}
                  onCursorRight={() => moveCursor(rec.NAME, 1)}
                  mode={keyboardMode}
                  setMode={setKeyboardMode}
                  onToggleCase={() => setIsUppercase(prev => !prev)}
                  isUppercase={isUppercase}
                />
              </div>
            ) : rec.TYPE === 'num' ? (
              <div>
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}>
                  <Input
                    ref={el => (inputRefs.current[rec.NAME] = el)}
                    value={values[rec.NAME]}
                    onChange={e => {
                      const newValue = e.target.value;
                      const numValue = parseFloat(newValue);
                      const min = parseFloat(minValues[rec.NAME]);
                      const max = parseFloat(maxValues[rec.NAME]);
                      if (!newValue || (numValue >= min && numValue <= max)) {
                        setValues(prev => ({ ...prev, [rec.NAME]: newValue }));
                      }
                    }}
                    placeholder="Wert"
                    style={{ width: '20%', textAlign: 'center' }}
                  />
                  <span style={{ color: '#fff', fontSize: '16px' }}>{rec.unit}</span>
                </div>
                <div style={{ marginTop: '8px', color: '#aaa', fontSize: '14px', textAlign: 'center' }}>
                  <span>Min: {minValues[rec.NAME]}</span>{' '}
                  <span style={{ marginLeft: '16px' }}>Max: {maxValues[rec.NAME]}</span>
                </div>
                <NumericKeypad
                  onInput={input => handleKeyboardInput(rec.NAME, input)}
                  onDelete={() => deleteAtCursor(rec.NAME)}
                  onClear={() => setValues(prev => ({ ...prev, [rec.NAME]: '' }))}
                />
              </div>
            ) : (
              <div>Unbekannter Typ</div>
            )}
          </div>
        ))}
      </Modal>

      <Modal
        visible={userModalVisible}
        title="Benutzer zuordnen"
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
        {normalizedRecords.map(rec => (
          <div key={rec.NAME} style={{ marginBottom: '20px' }}>
            <h3 style={{ color: '#fff' }}>{getLabel(rec)}</h3> {/* Verwende sprachspezifisches Label */}
            <Checkbox.Group
              value={selectedUsers[rec.NAME]}
              onChange={users => setSelectedUsers(prev => ({ ...prev, [rec.NAME]: users }))}
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
            {rec.TYPE === 'num' && (
              <div style={{ marginTop: '20px' }}>
                <h4 style={{ color: '#fff' }}>Bereich</h4>
                <div style={{ display: 'flex', gap: '20px' }}>
                  <div>
                    <label style={{ color: '#fff', marginRight: '10px' }}>Min:</label>
                    <InputNumber
                      value={minValues[rec.NAME]}
                      onChange={val => setMinValues(prev => ({ ...prev, [rec.NAME]: val !== null ? val.toString() : '' }))}
                      style={{ width: '100px', backgroundColor: '#1f1f1f', color: '#fff', borderColor: '#434343' }}
                    />
                    <label style={{ color: '#fff', marginRight: '10px' }}>{rec.unit}</label>
                  </div>
                  <div>
                    <label style={{ color: '#fff', marginRight: '10px' }}>Max:</label>
                    <InputNumber
                      value={maxValues[rec.NAME]}
                      onChange={val => setMaxValues(prev => ({ ...prev, [rec.NAME]: val !== null ? val.toString() : '' }))}
                      style={{ width: '100px', backgroundColor: '#1f1f1f', color: '#fff', borderColor: '#434343' }}
                    />
                    <label style={{ color: '#fff', marginRight: '10px' }}>{rec.unit}</label>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </Modal>
    </>
  );
};

export default EditVariableModal;