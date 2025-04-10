import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Modal, Button, Space, message } from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import socket from './socket';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { LineChart, ChartsGrid, ChartsXAxis, ChartsYAxis, ChartsTooltip, ChartsLegend } from '@mui/x-charts';
import { LocalizationProvider, DateTimePicker } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { TextField, createTheme, ThemeProvider } from '@mui/material';
import { styled } from '@mui/material/styles';

dayjs.extend(customParseFormat);

// Darkmode-Theme für MUI-Komponenten
const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    background: {
      default: '#141414',
      paper: '#1f1f1f',
    },
    text: {
      primary: '#ffffff',
      secondary: '#b0b0b0',
    },
  },
  components: {
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiInputBase-root': {
            backgroundColor: '#1f1f1f',
            color: '#ffffff',
          },
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: '#434343',
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: '#ffb000',
          },
        },
      },
    },
    MuiPickersPopper: {
      styleOverrides: {
        root: {
          backgroundColor: '#1f1f1f',
          color: '#ffffff',
        },
      },
    },
  },
});

// Styled DateTimePicker für Darkmode
const DarkDateTimePicker = styled(DateTimePicker)({
  '& .MuiInputBase-root': {
    backgroundColor: '#1f1f1f',
    color: '#ffffff',
  },
  '& .MuiOutlinedInput-notchedOutline': {
    borderColor: '#434343',
  },
  '&:hover .MuiOutlinedInput-notchedOutline': {
    borderColor: '#ffb000',
  },
});

const ChartPopup = ({ visible, onClose, currentPage }) => {
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [startTime, setStartTime] = useState(() => dayjs().subtract(1, 'hour'));
  const [endTime, setEndTime] = useState(() => dayjs());
  const [selectedInterval, setSelectedInterval] = useState('1h');
  const [isLiveMode, setIsLiveMode] = useState(true);
  const [loggingSettings, setLoggingSettings] = useState([]);
  const [visibleLines, setVisibleLines] = useState({});
  const [windowDimensions, setWindowDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const colors = useRef({});
  const hasRequestedInitialData = useRef(false);
  const shouldFetchData = useRef(false);
  const intervalIdRef = useRef(null);

  const isMobile = windowDimensions.width < 768;

  useEffect(() => {
    const handleResize = () => {
      setWindowDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (visible) {
      socket.emit('request-logging-settings');
    }
  }, [visible]);

  useEffect(() => {
    const handleChartDataUpdate = (data) => {
      console.log('Received chart data:', data);
      if (!data || !Array.isArray(data) || data.length === 0) {
        setChartData([]);
        setLoading(false);
        return;
      }
      const sortedData = [...data].sort((a, b) => a.time - b.time);
      const formattedData = sortedData.map((item) => {
        const entry = { timestamp: Number(item.time) };
        Object.keys(item)
          .filter((key) => key !== 'time')
          .forEach((key) => {
            entry[key] = item[key] !== null && item[key] !== undefined ? Number(item[key]) : null;
          });
        return entry;
      });
      console.log('Formatted chart data:', formattedData);
      setChartData(formattedData);
      setLoading(false);

      const initialVisibleLines = {};
      Object.keys(formattedData[0] || {})
        .filter((key) => key !== 'timestamp')
        .forEach((topic) => (initialVisibleLines[topic] = true));
      setVisibleLines(initialVisibleLines);
    };

    const handleChartDataError = (error) => {
      console.error('Chart data error:', error);
      message.error(`Fehler: ${error.message}`);
      setChartData([]);
      setLoading(false);
    };

    const handleLoggingSettingsUpdate = (data) => {
      console.log('Logging settings:', data);
      setLoggingSettings(data || []);
      (data || []).forEach((setting) => {
        if (setting.color) colors.current[setting.topic] = setting.color;
      });
    };

    socket.on('chart-data-update', handleChartDataUpdate);
    socket.on('chart-data-error', handleChartDataError);
    socket.on('logging-settings-update', handleLoggingSettingsUpdate);

    return () => {
      socket.off('chart-data-update', handleChartDataUpdate);
      socket.off('chart-data-error', handleChartDataError);
      socket.off('logging-settings-update', handleLoggingSettingsUpdate);
    };
  }, []);

  const fetchData = useCallback((start, end, liveMode, page) => {
    if (!shouldFetchData.current) return;

    if (!start || !start.isValid()) {
      message.error('Bitte wählen Sie eine gültige Startzeit aus.');
      return;
    }
    if (!liveMode && (!end || !end.isValid())) {
      message.error('Bitte wählen Sie eine gültige Endzeit aus.');
      return;
    }
    if (!liveMode && start.isAfter(end)) {
      message.error('Startzeit muss vor Endzeit liegen.');
      return;
    }

    setLoading(true);
    const params = {
      start: start.toISOString(),
      end: liveMode ? 'now()' : end.toISOString(),
      page,
    };
    console.log('Fetching data with params:', params);
    socket.emit('request-chart-data', params);
  }, []);

  useEffect(() => {
    if (visible && isLiveMode) {
      intervalIdRef.current = setInterval(() => {
        shouldFetchData.current = true;
        fetchData(startTime, endTime, isLiveMode, currentPage);
      }, 30 * 1000);
    }
    return () => {
      if (intervalIdRef.current) clearInterval(intervalIdRef.current);
    };
  }, [visible, isLiveMode, fetchData, startTime, endTime, currentPage]);

  useEffect(() => {
    if (visible && !hasRequestedInitialData.current) {
      shouldFetchData.current = true;
      fetchData(startTime, endTime, isLiveMode, currentPage);
      hasRequestedInitialData.current = true;
    } else if (!visible) {
      const now = dayjs();
      setChartData([]);
      setSelectedInterval('1h');
      setIsLiveMode(true);
      setVisibleLines({});
      setStartTime(now.subtract(1, 'hour'));
      setEndTime(now);
      hasRequestedInitialData.current = false;
      shouldFetchData.current = false;
      if (intervalIdRef.current) clearInterval(intervalIdRef.current);
    }
  }, [visible, fetchData, currentPage]);

  const setIntervalRange = (interval) => {
    const now = dayjs();
    const start = now.subtract(
      interval === '1h' ? 1 : interval === '1d' ? 24 : 7 * 24,
      'hour'
    );
    setSelectedInterval(interval);
    setStartTime(start);
    setEndTime(now);
    shouldFetchData.current = true;
    fetchData(start, now, isLiveMode, currentPage);
  };

  const shiftTimeRange = (direction) => {
    if (isLiveMode && direction === 'forward') {
      message.info('Im "Echtzeit"-Modus kann nicht in die Zukunft verschoben werden.');
      return;
    }
    const duration =
      selectedInterval === '1h'
        ? 1 * 60 * 60 * 1000
        : selectedInterval === '1d'
        ? 24 * 60 * 60 * 1000
        : 7 * 24 * 60 * 60 * 1000;
    const shift = direction === 'forward' ? duration : -duration;
    const newStart = dayjs(startTime.valueOf() + shift);
    const newEnd = isLiveMode ? dayjs() : dayjs(endTime.valueOf() + shift);
    setStartTime(newStart);
    setEndTime(newEnd);
    shouldFetchData.current = true;
    fetchData(newStart, newEnd, isLiveMode, currentPage);
  };

  const toggleLiveMode = (enableLiveMode) => {
    setIsLiveMode(enableLiveMode);
    const now = dayjs();
    if (enableLiveMode) {
      const start = now.subtract(
        selectedInterval === '1h' ? 1 : selectedInterval === '1d' ? 24 : 7 * 24,
        'hour'
      );
      setStartTime(start);
      setEndTime(now);
      shouldFetchData.current = true;
      fetchData(start, now, true, currentPage);
    } else {
      setEndTime(now);
      shouldFetchData.current = true;
      fetchData(startTime, now, false, currentPage);
    }
  };

  const formatTimeTick = (timestamp) => {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const day = date.getDate();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const diffDays = endTime.diff(startTime, 'day');
    if (diffDays >= 7) {
      return `${day}.${month}`;
    } else if (diffDays >= 1) {
      return `${day}.${month} ${hours}:${minutes}`;
    } else {
      return `${hours}:${minutes}`;
    }
  };

  const renderLegend = () => {
    const topics = chartData.length > 0
      ? Object.keys(chartData[0]).filter((key) => key !== 'timestamp')
      : [];
    return (
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, color: '#fff', fontSize: isMobile ? 12 : 14 }}>
        {topics.map((topic) => {
          const setting = loggingSettings.find((s) => s.topic === topic);
          const label = setting?.description || topic;
          const unit = setting?.unit ? ` (${setting.unit})` : '';
          const color = setting?.color || '#ffffff';
          const isVisible = visibleLines[topic];
          return (
            <li
              key={topic}
              onClick={() => setVisibleLines((prev) => ({ ...prev, [topic]: !prev[topic] }))}
              style={{ cursor: 'pointer', opacity: isVisible ? 1 : 0.5, marginBottom: 5, display: 'flex', alignItems: 'center' }}
            >
              <span style={{ width: 10, height: 10, backgroundColor: color, marginRight: 5 }} />
              {label + unit}
            </li>
          );
        })}
      </ul>
    );
  };

  const chartContent = useMemo(() => {
    if (loading) {
      return <div style={{ color: '#fff', textAlign: 'center', padding: '20px' }}>Lade Diagrammdaten...</div>;
    }
    if (!Array.isArray(chartData) || chartData.length === 0) {
      return <div style={{ color: '#fff', textAlign: 'center', padding: '20px' }}>Keine Daten verfügbar</div>;
    }

    console.log('Rendering chart with data:', chartData);
    const firstDataPoint = chartData[0] || {};
    const seriesKeys = Object.keys(firstDataPoint).filter((key) => key !== 'timestamp');

    if (seriesKeys.length === 0) {
      return <div style={{ color: '#fff', textAlign: 'center', padding: '20px' }}>Keine gültigen Datenreihen verfügbar</div>;
    }

    const series = seriesKeys.map((topic) => {
      const setting = loggingSettings.find((s) => s.topic === topic);
      return {
        dataKey: topic,
        label: setting?.description || topic,
        color: colors.current[topic] || '#ffffff',
        showMark: false,
        curve: 'monotone',
        connectNulls: true,
        visible: visibleLines[topic],
        unit: setting?.unit || '', // Einheit für spätere Verwendung
      };
    });

    // Finde die häufigste Einheit für die Y-Achse (falls mehrere Einheiten vorhanden sind)
    const units = series.map((s) => s.unit).filter((u) => u);
    const mostCommonUnit = units.length > 0 ? units.sort((a, b) => units.filter((u) => u === a).length - units.filter((u) => u === b).length).pop() : '';

    return (
      <LineChart
        dataset={chartData}
        series={series.filter((s) => s.visible)}
        xAxis={[
          {
            dataKey: 'timestamp',
            valueFormatter: formatTimeTick,
            tickLabelStyle: { fill: '#fff', fontSize: isMobile ? 12 : 16 },
            angle: isMobile ? -90 : -45,
            textAnchor: 'end',
            stroke: '#fff',
          },
        ]}
        yAxis={[
          {
            tickLabelStyle: { fill: '#fff', fontSize: isMobile ? 12 : 16 },
            label: `Wert${mostCommonUnit ? ` (${mostCommonUnit})` : ''}`,
            labelStyle: { fill: '#fff' },
            stroke: '#fff',
          },
        ]}
        width={windowDimensions.width - 40}
        height={windowDimensions.height - (isMobile ? 200 : 100) - 40}
        margin={{ top: 20, right: isMobile ? 100 : 140, left: 60, bottom: 60 }}
        sx={{
          backgroundColor: '#141414',
          '& .MuiChartsAxis-tick': { stroke: '#fff' },
          '& .MuiChartsAxis-line': { stroke: '#fff' },
        }}
      >
        <ChartsGrid horizontal vertical strokeDasharray="3 3" stroke="#444" />
        <ChartsTooltip
          slotProps={{
            popper: {
              sx: {
                '& .MuiChartsTooltip-root': {
                  backgroundColor: '#1f1f1f',
                  color: '#fff',
                  border: '1px solid #434343',
                },
              },
            },
          }}
          formatter={(item) => {
            const setting = loggingSettings.find((s) => s.topic === item.dataKey);
            const unit = setting?.unit || '';
            return {
              name: setting?.description || item.dataKey,
              value: `${item.value}${unit ? ` ${unit}` : ''}`,
            };
          }}
        />
        <ChartsLegend
          slot={renderLegend}
          position={{ vertical: 'middle', horizontal: 'right' }}
          direction="column"
          padding={{ right: 10 }}
        />
      </LineChart>
    );
  }, [loading, chartData, visibleLines, windowDimensions, loggingSettings]);

  return (
    <ThemeProvider theme={darkTheme}>
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <Modal
          open={visible}
          onCancel={onClose}
          footer={null}
          width="100%"
          style={{ top: 0, padding: 0, margin: 0, height: '100vh' }}
          styles={{
            body: {
              height: '100vh',
              padding: 0,
              backgroundColor: '#141414',
              display: 'flex',
              flexDirection: 'column',
            },
            mask: {
              backgroundColor: 'rgba(0, 0, 0, 0.85)',
            },
          }}
        >
          <div style={{ padding: '10px 20px', backgroundColor: '#141414', borderBottom: '1px solid #333' }}>
            <Space direction={isMobile ? 'vertical' : 'horizontal'} size="middle" style={{ width: '100%' }}>
              <Button
                icon={<LeftOutlined />}
                onClick={() => shiftTimeRange('backward')}
                style={{ backgroundColor: '#333333', borderColor: '#434343', color: '#fff' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ color: '#fff', marginRight: 10 }}>Von:</label>
                <DarkDateTimePicker
                  value={startTime}
                  onChange={(date) => {
                    if (date && date.isValid()) {
                      setStartTime(date);
                      shouldFetchData.current = true;
                      fetchData(date, endTime, isLiveMode, currentPage);
                    }
                  }}
                  slotProps={{ textField: { size: 'small' } }}
                />
                {!isLiveMode && (
                  <>
                    <label style={{ color: '#fff', marginLeft: 10, marginRight: 10 }}>Bis:</label>
                    <DarkDateTimePicker
                      value={endTime}
                      onChange={(date) => {
                        if (date && date.isValid()) {
                          setEndTime(date);
                          shouldFetchData.current = true;
                          fetchData(startTime, date, isLiveMode, currentPage);
                        }
                      }}
                      slotProps={{ textField: { size: 'small' } }}
                    />
                  </>
                )}
              </div>
              <Button
                icon={<RightOutlined />}
                onClick={() => shiftTimeRange('forward')}
                style={{ backgroundColor: '#333333', borderColor: '#434343', color: '#fff' }}
              />
              <Space size="small">
                <Button
                  onClick={() => setIntervalRange('1h')}
                  type={selectedInterval === '1h' ? 'primary' : 'default'}
                  style={{
                    backgroundColor: selectedInterval === '1h' ? '#ffb000' : '#333333',
                    borderColor: '#434343',
                    color: '#fff',
                  }}
                >
                  1h
                </Button>
                <Button
                  onClick={() => setIntervalRange('1d')}
                  type={selectedInterval === '1d' ? 'primary' : 'default'}
                  style={{
                    backgroundColor: selectedInterval === '1d' ? '#ffb000' : '#333333',
                    borderColor: '#434343',
                    color: '#fff',
                  }}
                >
                  1d
                </Button>
                <Button
                  onClick={() => setIntervalRange('1w')}
                  type={selectedInterval === '1w' ? 'primary' : 'default'}
                  style={{
                    backgroundColor: selectedInterval === '1w' ? '#ffb000' : '#333333',
                    borderColor: '#434343',
                    color: '#fff',
                  }}
                >
                  1w
                </Button>
                <Button
                  onClick={() => toggleLiveMode(true)}
                  type={isLiveMode ? 'primary' : 'default'}
                  style={{
                    backgroundColor: isLiveMode ? '#ffb000' : '#333333',
                    borderColor: '#434343',
                    color: '#fff',
                  }}
                >
                  Echtzeit
                </Button>
                <Button
                  onClick={() => toggleLiveMode(false)}
                  type={!isLiveMode ? 'primary' : 'default'}
                  style={{
                    backgroundColor: !isLiveMode ? '#ffb000' : '#333333',
                    borderColor: '#434343',
                    color: '#fff',
                  }}
                >
                  Von-Bis
                </Button>
              </Space>
            </Space>
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }}>{chartContent}</div>
        </Modal>
      </LocalizationProvider>
    </ThemeProvider>
  );
};

export default ChartPopup;