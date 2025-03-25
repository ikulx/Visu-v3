// src/PinLogin.js
import React, { useState } from 'react';
import { Button, Modal } from 'antd';

const PinLogin = ({ visible, onSuccess, onCancel, validUsers }) => {
  const [enteredPIN, setEnteredPIN] = useState('');

  const handleNumberClick = (num) => {
    setEnteredPIN(prev => prev + num.toString());
  };

  const handleClear = () => {
    setEnteredPIN('');
  };

  const handleSubmit = () => {
    if (validUsers[enteredPIN]) {
      onSuccess(validUsers[enteredPIN]);
      setEnteredPIN('');
    } else {
      alert("Ungültiger PIN");
    }
  };

  return (
    <Modal
      title="Login"
      open={visible}
      onCancel={() => { onCancel(); setEnteredPIN(''); }}
      footer={null}
      centered
    >
      <div style={{ textAlign: 'center' }}>
        <div style={{ marginBottom: '10px', fontSize: '18px' }}>PIN: {enteredPIN}</div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '10px'
        }}>
          {[1,2,3,4,5,6,7,8,9,0].map(num => (
            <Button key={num} onClick={() => handleNumberClick(num)}>
              {num}
            </Button>
          ))}
        </div>
        <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'space-around' }}>
          <Button onClick={handleClear}>Clear</Button>
          <Button type="primary" onClick={handleSubmit}>Submit</Button>
        </div>
      </div>
    </Modal>
  );
};

export default PinLogin;
