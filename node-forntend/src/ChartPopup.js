import React, { useState, useEffect, useRef } from 'react';
import { Modal, DatePicker, Button, Space, message, Select } from 'antd';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import socket from './socket';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(customParseFormat);

const { RangePicker } = DatePicker;
const { Option } = Select;

const ChartPopup = ({ visible, onClose, currentPage }) => {
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [timeRange, setTimeRange] = useState(() => {
    const now = dayjs();
    const start = now.subtract(1, 'hour');
    console.log('Initialer Zeitbereich:', {
      start: start.format('YYYY-MM-DD HH:mm:ss'),
      end: now.format('YYYY-MM-DD HH:mm:ss'),
    });
    return [start, now];
  });
  const [selectedInterval, setSelectedInterval] = useState('1h');
  const [maxPoints, setMaxPoints] = useState(50);
  const [loggingSettings, setLoggingSettings] = useState([]);
  const [visibleLines, setVisibleLines] = useState({});
  const colors = useRef({});
  const hasRequestedInitialData = useRef(false);
  const [windowDimensions, setWindowDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  // Bildschirmgröße überwachen
  useEffect(() => {
    const handleResize = () => {
      setWindowDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Logging-Einstellungen abrufen
  useEffect(() => {
    if (visible) {
      socket.emit('request-logging-settings');
    }
  }, [visible]);

  const requestChartData = (range) => {
    const [start, end] = range || timeRange;
    if (!start || !end) {
      message.error('Bitte wählen Sie Start- und Endzeit aus.');
      console.log('Fehler: Startzeit oder Endzeit fehlt', { start, end });
      return;
    }
    if (start.isAfter(end)) {
      message.error('Startzeit muss vor Endzeit liegen.');
      console.log('Fehler: Startzeit nach Endzeit', {
        start: start.format('YYYY-MM-DD HH:mm'),
        end: end.format('YYYY-MM-DD HH:mm'),
      });
      return;
    }

    const now = dayjs();
    let adjustedStart = start;
    let adjustedEnd = end;
    if (end.isAfter(now)) {
      console.warn('Endzeitpunkt liegt in der Zukunft. Setze auf aktuellen Zeitpunkt.');
      const duration = end.diff(start);
      adjustedEnd = now;
      adjustedStart = adjustedEnd.subtract(duration);
      setTimeRange([adjustedStart, adjustedEnd]);
      console.log('Korrigierter Zeitbereich:', {
        start: adjustedStart.format('YYYY-MM-DD HH:mm:ss'),
        end: adjustedEnd.format('YYYY-MM-DD HH:mm:ss'),
      });
    }

    setLoading(true);
    const params = {
      start: adjustedStart.toISOString(),
      end: adjustedEnd.toISOString(),
      maxPoints: maxPoints,
      page: currentPage,
    };
    console.log('Sende Daten an Socket mit maxPoints:', maxPoints, params);
    socket.emit('request-chart-data', params);
  };

  useEffect(() => {
    const handleChartDataUpdate = (data) => {
      console.log('Rohdaten vom Socket empfangen:', data);
      if (!data || data.length === 0) {
        console.log('Keine Daten empfangen, setze chartData auf leeres Array');
        setChartData([]);
        setLoading(false);
        return;
      }

      const sortedData = [...data].sort((a, b) => a.time - b.time);
      const formattedData = sortedData.map(item => {
        const entry = { timestamp: Number(item.time) };
        Object.keys(item).forEach(key => {
          if (key !== 'time') {
            entry[key] = item[key] !== null && item[key] !== undefined ? Number(item[key]) : null;
          }
        });
        return entry;
      });

      console.log('Sortierte und formatierte Daten für Diagramm:', formattedData);
      console.log('Anzahl der Datenpunkte:', formattedData.length);
      setChartData(formattedData);
      setLoading(false);

      const initialVisibleLines = {};
      Object.keys(formattedData[0] || {})
        .filter(key => key !== 'timestamp')
        .forEach(topic => {
          initialVisibleLines[topic] = true;
        });
      console.log('Initialisierte sichtbare Linien:', initialVisibleLines);
      setVisibleLines(initialVisibleLines);
    };

    const handleChartDataError = (error) => {
      console.error('Fehler vom Socket:', error);
      message.error(`Fehler: ${error.message}`);
      setLoading(false);
    };

    const handleLoggingSettingsUpdate = (data) => {
      console.log('Logging-Einstellungen empfangen:', data);
      setLoggingSettings(data);
      data.forEach(setting => {
        if (setting.color) {
          colors.current[setting.topic] = setting.color;
        }
      });
    };

    socket.on('connect', () => console.log('Socket verbunden'));
    socket.on('disconnect', () => console.log('Socket getrennt'));
    socket.on('chart-data-update', handleChartDataUpdate);
    socket.on('chart-data-error', handleChartDataError);
    socket.on('logging-settings-update', handleLoggingSettingsUpdate);

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('chart-data-update', handleChartDataUpdate);
      socket.off('chart-data-error', handleChartDataError);
      socket.off('logging-settings-update', handleLoggingSettingsUpdate);
    };
  }, []);

  // Reagiere auf Änderungen von maxPoints
  useEffect(() => {
    if (visible) {
      console.log('maxPoints geändert, neue Anfrage mit maxPoints:', maxPoints);
      requestChartData();
    }
  }, [maxPoints]);

  useEffect(() => {
    if (visible && !hasRequestedInitialData.current) {
      console.log('Popup geöffnet, initiale Zeitpunkte:', {
        start: timeRange[0].format('YYYY-MM-DD HH:mm'),
        end: timeRange[1].format('YYYY-MM-DD HH:mm'),
      });
      requestChartData();
      hasRequestedInitialData.current = true;
    } else if (!visible) {
      setChartData([]);
      setSelectedInterval('1h');
      setMaxPoints(50);
      setVisibleLines({});
      hasRequestedInitialData.current = false;
    }
  }, [visible]);

  const setIntervalRange = (interval) => {
    setSelectedInterval(interval);
    const now = dayjs();
    let start;
    switch (interval) {
      case '1h':
        start = now.subtract(1, 'hour');
        break;
      case '1d':
        start = now.subtract(1, 'day');
        break;
      case '1w':
        start = now.subtract(1, 'week');
        break;
      default:
        start = now.subtract(1, 'hour');
    }
    const newRange = [start, now];
    setTimeRange(newRange);
    console.log(`Intervall ${interval} ausgewählt:`, {
      start: start.format('YYYY-MM-DD HH:mm'),
      end: now.format('YYYY-MM-DD HH:mm'),
    });
    requestChartData(newRange);
  };

  const shiftTimeRange = (direction) => {
    const [start, end] = timeRange;
    let duration;
    switch (selectedInterval) {
      case '1h':
        duration = 1 * 60 * 60 * 1000;
        break;
      case '1d':
        duration = 24 * 60 * 60 * 1000;
        break;
      case '1w':
        duration = 7 * 24 * 60 * 60 * 1000;
        break;
      default:
        duration = 1 * 60 * 60 * 1000;
    }

    const shift = direction === 'forward' ? duration : -duration;
    const newStart = dayjs(start.valueOf() + shift);
    const newEnd = dayjs(end.valueOf() + shift);
    const newRange = [newStart, newEnd];
    setTimeRange(newRange);
    console.log(`Zeitbereich verschoben (${direction}):`, {
      start: newStart.format('YYYY-MM-DD HH:mm'),
      end: newEnd.format('YYYY-MM-DD HH:mm'),
    });
    requestChartData(newRange);
  };

  const handleMaxPointsChange = (value) => {
    setMaxPoints(value);
    console.log(`Max Punkte geändert auf: ${value}`);
    // Die Anfrage wird durch useEffect ausgelöst
  };

  const formatTimeTick = (timestamp) => {
    const date = new Date(timestamp);
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const formattedTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    const [start, end] = timeRange;
    const diffDays = end.diff(start, 'day');
    const diffHours = end.diff(start, 'hour');

    if (diffDays >= 7) {
      const day = date.getDate();
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      return `${day}.${month}`;
    } else if (diffDays >= 1) {
      const day = date.getDate();
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      return `${day}.${month} ${formattedTime}`;
    } else if (diffHours >= 1) {
      return formattedTime;
    } else {
      const seconds = date.getSeconds();
      return `${formattedTime}:${seconds.toString().padStart(2, '0')}`;
    }
  };

  const getTickCount = () => {
    const dataLength = chartData.length;
    const tickCount = Math.max(5, Math.min(10, Math.floor(dataLength / 10)));
    return tickCount;
  };

  const handleLegendClick = (topic) => {
    setVisibleLines(prev => ({
      ...prev,
      [topic]: !prev[topic],
    }));
  };

  const renderLegend = () => {
    const topics = chartData.length > 0
      ? Object.keys(chartData[0]).filter(key => key !== 'timestamp')
      : [];

    return (
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          color: '#fff',
          fontSize: windowDimensions.width < 768 ? 12 : 14,
          maxWidth: windowDimensions.width < 768 ? 80 : 120,
          overflow: 'hidden',
        }}
      >
        {topics.map((topic, index) => {
          const setting = loggingSettings.find(s => s.topic === topic);
          const label = setting && setting.description ? setting.description : topic;
          const color = setting && setting.color ? setting.color : '#ffffff';
          const isVisible = visibleLines[topic];
          return (
            <li
              key={`item-${index}`}
              onClick={() => handleLegendClick(topic)}
              style={{
                cursor: 'pointer',
                opacity: isVisible ? 1 : 0.5,
                marginBottom: 5,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  backgroundColor: color,
                  marginRight: 5,
                }}
              />
              {label}
            </li>
          );
        })}
      </ul>
    );
  };

  const controlHeight = windowDimensions.width < 768 ? 140 : 100;
  const chartHeight = windowDimensions.height - controlHeight - 40;

  return (
    <Modal
      visible={visible}
      onCancel={onClose}
      footer={null}
      width="100%"
      style={{
        top: 0,
        padding: 0,
        margin: 0,
        height: '100vh',
      }}
      styles={{
        body: {
          height: '100vh',
          padding: 0,
          backgroundColor: '#141414',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        },
        content: {
          padding: 0,
          margin: 0,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
      wrapClassName="fullscreen-modal"
    >
      <div
        style={{
          padding: '10px 20px',
          backgroundColor: '#141414',
          borderBottom: '1px solid #333',
          flexShrink: 0,
        }}
      >
        <Space
          direction={windowDimensions.width < 768 ? 'vertical' : 'horizontal'}
          size="middle"
          align="center"
          style={{ width: '100%', flexWrap: 'wrap' }}
        >
          <Button
            icon={<LeftOutlined />}
            onClick={() => shiftTimeRange('backward')}
            style={{ backgroundColor: '#333333', borderColor: '#434343', color: '#fff' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ color: '#fff', marginRight: '10px' }}>Zeitbereich:</label>
            <RangePicker
              showTime={{ format: 'HH:mm' }}
              format="YYYY-MM-DD HH:mm"
              value={timeRange}
              onChange={(dates) => {
                if (dates && dates[0] && dates[1]) {
                  setTimeRange([dates[0], dates[1]]);
                  console.log('Zeitbereich ausgewählt:', {
                    start: dates[0].format('YYYY-MM-DD HH:mm'),
                    end: dates[1].format('YYYY-MM-DD HH:mm'),
                  });
                  requestChartData([dates[0], dates[1]]);
                } else {
                  const now = dayjs();
                  const defaultRange = [now.subtract(1, 'hour'), now];
                  setTimeRange(defaultRange);
                  console.log('Zurück zu Standard:', {
                    start: now.subtract(1, 'hour').format('YYYY-MM-DD HH:mm'),
                    end: now.format('YYYY-MM-DD HH:mm'),
                  });
                  requestChartData(defaultRange);
                }
              }}
              allowClear={false}
              style={{ width: windowDimensions.width < 768 ? '100%' : '300px' }}
              popupStyle={{ backgroundColor: '#141414', color: '#fff' }}
            />
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
          </Space>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ color: '#fff', marginRight: '10px' }}>Punkte pro Topic:</label>
            <Select
              value={maxPoints}
              onChange={handleMaxPointsChange}
              style={{ width: windowDimensions.width < 768 ? '100%' : '120px', backgroundColor: '#333', color: '#fff' }}
            >
              <Option value={50}>50</Option>
              <Option value={100}>100</Option>
              <Option value={150}>150</Option>
              <Option value={200}>200</Option>
              <Option value={250}>250</Option>
            </Select>
          </div>
        </Space>
      </div>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ color: '#fff', textAlign: 'center', padding: '20px' }}>
            Lade Diagrammdaten...
          </div>
        ) : chartData.length === 0 ? (
          <div style={{ color: '#fff', textAlign: 'center', padding: '20px' }}>
            Keine Daten verfügbar
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={chartHeight}>
            <LineChart
              data={chartData}
              margin={{
                top: 20,
                right: windowDimensions.width < 768 ? 80 : 120,
                left: 20,
                bottom: 40,
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#444" />
              <XAxis
                dataKey="timestamp"
                stroke="#fff"
                tickFormatter={formatTimeTick}
                tick={{ fill: '#fff', fontSize: windowDimensions.width < 768 ? 12 : 16, dy: 10 }}
                tickCount={getTickCount()}
                angle={windowDimensions.width < 768 ? -90 : -45}
                textAnchor="end"
                height={60}
              />
              <YAxis
                yAxisId="left"
                stroke="#fff"
                tick={{ fill: '#fff', fontSize: windowDimensions.width < 768 ? 12 : 16 }}
                domain={['auto', 'auto']}
                width={windowDimensions.width < 768 ? 40 : 60}
                label={{ value: '°C', angle: -90, position: 'insideLeft', fill: '#fff', fontSize: 16 }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#fff"
                tick={{ fill: '#fff', fontSize: windowDimensions.width < 768 ? 12 : 16 }}
                domain={['auto', 'auto']}
                width={windowDimensions.width < 768 ? 40 : 60}
                label={{ value: '%', angle: 90, position: 'insideRight', fill: '#fff', fontSize: 16 }}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#333', border: 'none', color: '#fff' }}
                labelFormatter={formatTimeTick}
                formatter={(value, name) => {
                  const setting = loggingSettings.find(s => s.topic === name);
                  const unit = setting ? setting.unit : '°C';
                  return [`${value} ${unit}`, setting ? setting.description : name];
                }}
              />
              <Legend
                layout="vertical"
                align="right"
                verticalAlign="middle"
                content={renderLegend}
              />
              {Object.keys(chartData[0] || {})
                .filter(key => key !== 'timestamp')
                .map(topic => {
                  const setting = loggingSettings.find(s => s.topic === topic);
                  const color = setting && setting.color ? setting.color : '#ffffff';
                  const unit = setting ? setting.unit : '°C';
                  const yAxisId = unit === '°C' ? 'left' : 'right';
                  if (!visibleLines[topic]) return null;
                  console.log(`Rendere Linie für Topic: ${topic}, Farbe: ${color}, Y-Achse: ${yAxisId}`);
                  return (
                    <Line
                      key={topic}
                      type="monotone"
                      dataKey={topic}
                      stroke={color}
                      strokeWidth={2}
                      connectNulls={true}
                      yAxisId={yAxisId}
                    />
                  );
                })}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </Modal>
  );
};

export default ChartPopup;