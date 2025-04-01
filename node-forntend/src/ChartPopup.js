import React, { useState, useEffect, useRef } from 'react';
import { Modal, DatePicker } from 'antd';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import socket from './socket'; // Socket.IO-Instanz
import moment from 'moment';

const { RangePicker } = DatePicker;

const ChartPopup = ({ visible, onClose }) => {
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState([moment().subtract(1, 'hour'), moment()]);
  const colorMap = useRef({});

  // Socket.IO-Event-Listener für Diagrammdaten
  useEffect(() => {
    const handleChartDataUpdate = (data) => {
      const formattedData = data.map(item => ({
        timestamp: Number(item.time),
        ...item,
      }));
      setChartData(formattedData);
      setLoading(false);

      // Farben für jede Datenreihe zufällig generieren
      formattedData.forEach(item => {
        Object.keys(item).forEach(key => {
          if (key !== 'timestamp' && !colorMap.current[key]) {
            colorMap.current[key] = `#${Math.floor(Math.random() * 16777215).toString(16)}`;
          }
        });
      });
    };

    socket.on('chart-data-update', handleChartDataUpdate);
    return () => socket.off('chart-data-update', handleChartDataUpdate);
  }, []);

  // Daten anfordern, wenn sich der Zeitraum ändert
  useEffect(() => {
    if (visible) {
      const [start, end] = dateRange;
      socket.emit('request-chart-data', {
        start: start.toISOString(),
        end: end.toISOString(),
      });
    }
  }, [dateRange, visible]);

  // Zeitformatierung für die X-Achse
  const formatTimeTick = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <Modal
      visible={visible}
      onCancel={onClose}
      footer={null}
      width="100%"
      style={{ top: 0, padding: 0 }}
      styles={{ body: { height: '100vh', padding: 0, backgroundColor: '#141414' } }}
    >
      <div style={{ padding: '10px', backgroundColor: '#141414' }}>
        <RangePicker
          showTime
          format="YYYY-MM-DD HH:mm:ss"
          onChange={(dates) => setDateRange(dates)}
          defaultValue={dateRange}
          style={{ marginBottom: '20px' }}
        />
      </div>
      {loading ? (
        <div style={{ color: '#fff', textAlign: 'center', padding: '20px' }}>
          Lade Diagrammdaten...
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="90%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#444" />
            <XAxis
              dataKey="timestamp"
              stroke="#fff"
              tickFormatter={formatTimeTick}
              tick={{ fill: '#fff', fontSize: 16, dy: 10 }}
              interval="preserveStartEnd"
              angle={-45}
              textAnchor="end"
            />
            <YAxis stroke="#fff" tick={{ fill: '#fff', fontSize: 16 }} domain={['auto', 'auto']} />
            <Tooltip
              contentStyle={{ backgroundColor: '#333', border: 'none', color: '#fff' }}
              labelFormatter={formatTimeTick}
            />
            <Legend wrapperStyle={{ color: '#fff', paddingTop: 10 }} />
            {chartData.length > 0 &&
              Object.keys(chartData[0])
                .filter(key => key !== 'timestamp')
                .map(topic => (
                  <Line
                    key={topic}
                    type="monotone"
                    dataKey={topic}
                    stroke={colorMap.current[topic] || '#ffffff'}
                    strokeWidth={2}
                  />
                ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </Modal>
  );
};

export default ChartPopup;