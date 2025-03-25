import React from 'react';
import { Button } from 'antd';

const NumericKeypad = ({ onInput, onDelete, onClear }) => {
  const buttonStyle = {
    width: '80px',
    height: '60px',
    fontSize: '20px',
    margin: '5px',
  };

  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    marginTop: '15px',
  };

  const rowStyle = {
    display: 'flex',
    justifyContent: 'center',
  };

  return (
    <div style={containerStyle}>
      <div style={rowStyle}>
        <Button style={buttonStyle} onClick={() => onInput('1')}>1</Button>
        <Button style={buttonStyle} onClick={() => onInput('2')}>2</Button>
        <Button style={buttonStyle} onClick={() => onInput('3')}>3</Button>
      </div>
      <div style={rowStyle}>
        <Button style={buttonStyle} onClick={() => onInput('4')}>4</Button>
        <Button style={buttonStyle} onClick={() => onInput('5')}>5</Button>
        <Button style={buttonStyle} onClick={() => onInput('6')}>6</Button>
      </div>
      <div style={rowStyle}>
        <Button style={buttonStyle} onClick={() => onInput('7')}>7</Button>
        <Button style={buttonStyle} onClick={() => onInput('8')}>8</Button>
        <Button style={buttonStyle} onClick={() => onInput('9')}>9</Button>
      </div>
      <div style={rowStyle}>
        <Button style={buttonStyle} onClick={onClear}>Clear</Button>
        <Button style={buttonStyle} onClick={() => onInput('0')}>0</Button>
        <Button style={buttonStyle} onClick={onDelete}>⌫</Button>
      </div>
    </div>
  );
};

export default NumericKeypad;
