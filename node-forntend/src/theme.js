// src/theme.js
export const DIMENSIONS = {
    headerHeight: '64px',
    footerHeight: '48px',
    homeButtonSize: '64px',
  };
  
  export const theme = {
    headerStyle: {
      textAlign: 'center',
      color: '#fff',
      height: DIMENSIONS.headerHeight,
      paddingInline: 48,
      lineHeight: DIMENSIONS.headerHeight,
      backgroundColor: '#383838', // dunkles Grau/Blau für den Header
    },
    contentStyle: {
      textAlign: 'center',
      minHeight: 120,
      lineHeight: '120px',
      color: '#fff',
      backgroundColor: '#000', // schwarzer Hintergrund für den Content
    },
    siderStyle: {
      textAlign: 'center',
      lineHeight: '120px',
      color: '#fff',
      backgroundColor: '#383838', // dunkles Grau/Blau für den Sider
    },
    footerStyle: {
      textAlign: 'center',
      color: '#fff',
      backgroundColor: '#383838',
      height: DIMENSIONS.footerHeight,
      lineHeight: DIMENSIONS.footerHeight,
    },
    layoutStyle: {
      borderRadius: 8,
      overflow: 'hidden',
      margin: 8,
      width: 'calc(100% - 16px)',
    },
    iconSizes: {
      default: '32px',
      hamburger: '32px',
    },
    buttonStyle: {
      ghost: true,
      style: { fontSize: '32px', color: '#fff' },
    },
    menuStyle: {
      fontSize: '20px',
      backgroundColor: '#383838',
      color: '#fff',
    },
  };
  