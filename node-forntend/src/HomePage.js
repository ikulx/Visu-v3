import React from 'react';

const HomePage = ({ text }) => {
  const hardcodedImagePath = '/assets/home-image.png'; // Hart kodierter Bildpfad

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      color: '#fff',
      textAlign: 'center',
      backgroundColor: '#1f1f1f',
    }}>
      <img
        src={hardcodedImagePath}
        alt="Homepage Bild"
        style={{
          maxWidth: '100%',
          maxHeight: '50vh',
          marginBottom: '20px',
        }}
      />
      <div style={{ fontSize: '24px' }}>
        {text || 'Kein Text verfügbar'}
      </div>
    </div>
  );
};

export default HomePage;