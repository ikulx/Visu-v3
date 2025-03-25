import React, { useState } from 'react';
import { Button, Modal } from 'antd';
import { DeleteOutlined, CheckOutlined } from '@ant-design/icons';

const PinLogin = ({ visible, onSuccess, onCancel, validUsers }) => {
  const [enteredPIN, setEnteredPIN] = useState('');

  const handleNumberClick = (num) => {
    if (enteredPIN.length < 4) {
      setEnteredPIN(prev => prev + num.toString());
    }
  };

  const handleClear = () => {
    setEnteredPIN('');
  };

  const handleSubmit = () => {
    if (enteredPIN.length !== 4) {
      alert("Bitte 4-stelligen PIN eingeben");
      return;
    }
    if (validUsers[enteredPIN]) {
      onSuccess(validUsers[enteredPIN]);
      setEnteredPIN('');
    } else {
      alert("Ungültiger PIN");
      setEnteredPIN('');
    }
  };

  // Darstellung der PIN-Eingabe als vier Kästchen, in denen bei Eingabe Punkte angezeigt werden
  const renderPinDisplay = () => {
    const placeholders = Array(4).fill('');
    const digits = enteredPIN.split('');
    return (
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
        {placeholders.map((_, index) => (
          <div
            key={index}
            style={{
              width: '40px',
              height: '40px',
              margin: '0 5px',
              borderRadius: '4px',
              backgroundColor: '#333',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '24px',
              color: '#fff',
              border: '2px solid #555'
            }}
          >
            {digits[index] ? '•' : ''}
          </div>
        ))}
      </div>
    );
  };

  return (
    <Modal
      title="Login"
      open={visible}
      onCancel={() => { onCancel(); setEnteredPIN(''); }}
      footer={null}
      centered  // Das Modal wird dadurch mittig im Bildschirm angezeigt
      // bodyStyle={{ backgroundColor: '#141414', color: '#fff' }}
    >
      <div style={{ textAlign: 'center' }}>
        {renderPinDisplay()}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '10px',
            marginBottom: '20px'
          }}
        >
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map(num => (
            <Button
              key={num}
              onClick={() => handleNumberClick(num)}
              style={{
                backgroundColor: '#1f1f1f',
                color: '#fff',
                border: 'none',
                height: '50px',
                fontSize: '18px'
              }}
            >
              {num}
            </Button>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-around' }}>
          <Button
            onClick={handleClear}
            style={{ backgroundColor: '#333', height: '50px',  width: '70px', color: '#fff', border: 'none' }}
          >
            <DeleteOutlined style={{ fontSize: '20px' }} />
          </Button>
          <Button
            
            onClick={handleSubmit}
            style={{ backgroundColor: '#ffb000', height: '50px', width: '70px', border: 'none' }}
          >
            <CheckOutlined style={{ fontSize: '20px' }} />
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default PinLogin;
