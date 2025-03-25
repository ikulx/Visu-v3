import React, { useState } from 'react';
import { Button } from 'antd';

const SwissKeyboard = ({
  onInput,
  onDelete,
  onCursorLeft,
  onCursorRight,
  mode,
  setMode,
  onToggleCase,
  isUppercase
}) => {
  // Layout für den Buchstabenmodus (Schweizer Tastatur)
  const letterRows = [
    ['Q', 'W', 'E', 'R', 'T', 'Z', 'U', 'I', 'O', 'P', 'Ü'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ö', 'Ä'],
    ['Y', 'X', 'C', 'V', 'B', 'N', 'M']
  ];

  // Layout für den Zahlen-/Sonderzeichenmodus
  const numberRows = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['!', '"', '§', '$', '%', '&', '/', '(', ')', '=']
  ];

  // Container-Stil für die Tastatur
  const keyboardContainerStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    width: '100%',
  };

  // Gemeinsames Styling für alle Tasten
  const keyStyle = {
    height: '50px',
    fontSize: '16px',
    borderRadius: '6px',
    // boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
    // backgroundColor: '#434343',
    color: 'white',
    border: '1px solid #555555',
    transition: 'background-color 0.2s, transform 0.1s',
    width: '100%',
  };

  // Spezielles Styling für die Leertaste (breiter)
  const spaceKeyStyle = {
    ...keyStyle,
     flex: 4, // nimmt mehr Platz ein
  };
  const arrowKeyStyle = {
    ...keyStyle,
    width: '15%', // nimmt mehr Platz ein
  };

  // Spezielles Styling für den Löschen-Button
  const deleteKeyStyle = {
    ...keyStyle,
    width: '25%',
    backgroundColor: '#ff4d4f',
  };

  // Transform-Funktion für Buchstaben (abhängig von der Groß-/Kleinschaltung)
  const transformKey = (key) => (isUppercase ? key.toUpperCase() : key.toLowerCase());

  // Rendern einer Zeile als Grid (Flexbox-Zeile)
  const renderRow = (row, transform = (k) => k) => (
    <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
      {row.map((key) => (
        <Button
          key={key}
          style={keyStyle}
          onClick={() => onInput(transform(key))}
          onMouseDown={(e) => (e.currentTarget.style.transform = 'translateY(2px)')}
          onMouseUp={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
        >
          {transform(key)}
        </Button>
      ))}
    </div>
  );

  // Space-Zeile: links Pfeil (Cursor Left), in der Mitte Leertaste und rechts Pfeil (Cursor Right)
  const renderSpaceRow = () => (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}>
      <Button
        style={arrowKeyStyle}
        onClick={onCursorLeft}
        onMouseDown={(e) => (e.currentTarget.style.transform = 'translateY(2px)')}
        onMouseUp={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
      >
        ←
      </Button>
      <Button
        style={spaceKeyStyle}
        onClick={() => onInput(' ')}
        onMouseDown={(e) => (e.currentTarget.style.transform = 'translateY(2px)')}
        onMouseUp={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
      >
        ␣
      </Button>
      <Button
        style={arrowKeyStyle}
        onClick={onCursorRight}
        onMouseDown={(e) => (e.currentTarget.style.transform = 'translateY(2px)')}
        onMouseUp={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
      >
        →
      </Button>
    </div>
  );

  // Steuerzeile: Groß-/Kleinschaltung und Löschen auf derselben Zeile
  const renderControlRow = () => (
    <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
      <Button
        style={keyStyle}
        onClick={onToggleCase}
        onMouseDown={(e) => (e.currentTarget.style.transform = 'translateY(2px)')}
        onMouseUp={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
      >
        {isUppercase ? 'abc' : 'ABC'}
      </Button>
      <Button
        style={keyStyle}
        onClick={() => setMode(mode === 'letters' ? 'numbers' : 'letters')}
        onMouseDown={(e) => (e.currentTarget.style.transform = 'translateY(2px)')}
        onMouseUp={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
      >
        {mode === 'letters' ? '123' : 'ABC'}
      </Button>
      <Button
        style={deleteKeyStyle}
        onClick={onDelete}
        onMouseDown={(e) => (e.currentTarget.style.transform = 'translateY(2px)')}
        onMouseUp={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
      >
        ⌫
      </Button>
    </div>
  );



  return (
    <div style={keyboardContainerStyle}>
      {mode === 'letters'
        ? letterRows.map((row, index) => renderRow(row, transformKey))
        : numberRows.map((row, index) => renderRow(row))}
      {renderSpaceRow()}
      {renderControlRow()}
    </div>
  );
};

export default SwissKeyboard;
