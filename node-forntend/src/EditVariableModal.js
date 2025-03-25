import React, { useState, useEffect, useRef } from 'react';
import { Modal, Input, Select, InputNumber, Grid } from 'antd';
import { useTranslation } from 'react-i18next';
import socket from './socket';
import SwissKeyboard from './SwissKeyboard';
import NumericKeypad from './NumericKeypad';

const EditVariableModal = ({ visible, record, onCancel, onUpdateSuccess }) => {
  const { i18n } = useTranslation();
  const { xs } = Grid.useBreakpoint();
  const currentLang = i18n.language || 'en';
  const [value, setValue] = useState(record ? record.VAR_VALUE : '');
  
  // Für den Textmodus: virtuelle Tastatur
  const [keyboardMode, setKeyboardMode] = useState('letters');
  const [isUppercase, setIsUppercase] = useState(true);
  
  // useRef für das Input-Feld
  const inputRef = useRef(null);

  const isNativeKeyboardAvailable = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  useEffect(() => {
    if (record) {
      setValue(record.VAR_VALUE);
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
    const payload = {
      key: 'NAME',
      search: record.NAME,
      target: 'VAR_VALUE',
      value: value,
    };
    socket.emit("update-variable", payload);
    onUpdateSuccess(record, value);
  };

  // Hilfsfunktionen für Einfügen und Löschen an der aktuellen Cursorposition
  const insertAtCursor = (newText) => {
    if (inputRef.current && inputRef.current.input) {
      const inputEl = inputRef.current.input;
      const start = inputEl.selectionStart || 0;
      const end = inputEl.selectionEnd || 0;
      const newValue = value.substring(0, start) + newText + value.substring(end);
      setValue(newValue);
      const newPos = start + newText.length;
      setTimeout(() => {
        inputEl.setSelectionRange(newPos, newPos);
        inputEl.focus();
      }, 0);
    } else {
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

  // Cursor-Verschiebung
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

  // Bei Abbruch: lokale Änderungen verwerfen
  const handleCancel = () => {
    if (record) {
      setValue(record.VAR_VALUE);
    }
    onCancel();
  };

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
        {/* Eingabefeld und Einheit in einem Container, zentriert */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}>
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Wert"
            style={{ width: '20%', textAlign: 'center' }}
          />
          <span style={{ color: '#fff', fontSize: '16px' }}>
            {record.unit}
          </span>
        </div>
        {/* Min- und Max-Wert unter dem Eingabefeld */}
        <div style={{ marginTop: '8px', color: '#aaa', fontSize: '14px', textAlign: 'center' }}>
          <span>Min: {record.MIN}</span> <span style={{ marginLeft: '16px' }}>Max: {record.MAX}</span>
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
    <Modal
      visible={visible}
      title={`Wert bearbeiten: ${record ? record.NAME : ''}`}
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
  );
};

export default EditVariableModal;
