import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Modal, DatePicker, Button, Space, message, Select } from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  TimeScale,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import socket from './socket';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';

ChartJS.register(LineElement, PointElement, LinearScale, TimeScale, Title, Tooltip, Legend);

dayjs.extend(customParseFormat);

const { Option } = Select;

const ChartPopup = ({ visible, onClose, currentPage }) => {
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [startTime, setStartTime] = useState(() => {
    const now = dayjs();
    return now.subtract(1, 'hour');
  });
  const [endTime, setEndTime] = useState(() => {
    const now = dayjs();
    return now;
  });
  const [selectedInterval, setSelectedInterval] = useState('1h');
  const [isLiveMode, setIsLiveMode] = useState(true);
  const [maxPoints, setMaxPoints] = useState(50);
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

  // Socket-Handler für Datenempfang
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

    const handleChartDataWarning = (warning) => {
      console.warn('Warnung vom Socket:', warning);
      message.warning(warning.message);
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
    socket.on('chart-data-warning', handleChartDataWarning);
    socket.on('logging-settings-update', handleLoggingSettingsUpdate);

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('chart-data-update', handleChartDataUpdate);
      socket.off('chart-data-error', handleChartDataError);
      socket.off('chart-data-warning', handleChartDataWarning);
      socket.off('logging-settings-update', handleLoggingSettingsUpdate);
    };
  }, []);

  // Zentrale Funktion zum Abrufen der Daten (ohne Abhängigkeiten)
  const fetchData = useCallback(() => {
    if (!shouldFetchData.current) {
      console.log('Datenabruf abgebrochen: shouldFetchData ist false');
      return;
    }

    if (!startTime) {
      message.error('Bitte wählen Sie eine Startzeit aus.');
      console.log('Fehler: Startzeit fehlt', { startTime });
      return;
    }
    if (!isLiveMode && !endTime) {
      message.error('Bitte wählen Sie eine Endzeit aus.');
      console.log('Fehler: Endzeit fehlt', { endTime });
      return;
    }
    if (!isLiveMode && startTime.isAfter(endTime)) {
      message.error('Startzeit muss vor Endzeit liegen.');
      console.log('Fehler: Startzeit nach Endzeit', {
        start: startTime.format('YYYY-MM-DD HH:mm'),
        end: endTime.format('YYYY-MM-DD HH:mm'),
      });
      return;
    }

    setLoading(true);
    const params = {
      start: startTime.toISOString(),
      end: isLiveMode ? 'now()' : (dayjs.isDayjs(endTime) ? endTime.toISOString() : dayjs().toISOString()),
      maxPoints: maxPoints,
      page: currentPage,
    };
    console.log('Sende Datenanfrage an Socket:', params);
    socket.emit('request-chart-data', params);
  }, []);

  // Automatische Aktualisierung im Echtzeit-Modus
  useEffect(() => {
    if (visible && isLiveMode) {
      intervalIdRef.current = setInterval(() => {
        console.log('Automatische Aktualisierung im Echtzeit-Modus');
        shouldFetchData.current = true;
        fetchData();
      }, 30 * 1000);
    }

    return () => {
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
      }
    };
  }, [visible, isLiveMode]);

  // Initiale Datenanfrage und Reset beim Öffnen/Schließen des Popups
  useEffect(() => {
    if (visible && !hasRequestedInitialData.current) {
      console.log('Popup geöffnet, initiale Zeitpunkte:', {
        start: startTime.format('YYYY-MM-DD HH:mm'),
        end: isLiveMode ? 'Jetzt' : endTime.format('YYYY-MM-DD HH:mm'),
      });
      shouldFetchData.current = true;
      fetchData();
      hasRequestedInitialData.current = true;
    } else if (!visible) {
      const now = dayjs();
      setChartData([]);
      setSelectedInterval('1h');
      setIsLiveMode(true);
      setMaxPoints(50);
      setVisibleLines({});
      setStartTime(now.subtract(1, 'hour'));
      setEndTime(now);
      hasRequestedInitialData.current = false;
      shouldFetchData.current = false;
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
      }
    }
  }, [visible]);

  const setIntervalRange = (interval) => {
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
    setSelectedInterval(interval);
    setStartTime(start);
    setEndTime(now);
    console.log(`Intervall ${interval} ausgewählt:`, {
      start: start.format('YYYY-MM-DD HH:mm'),
      end: now.format('YYYY-MM-DD HH:mm'),
    });
    shouldFetchData.current = true;
    fetchData();
  };

  const shiftTimeRange = (direction) => {
    if (isLiveMode && direction === 'forward') {
      message.info('Im "Echtzeit"-Modus kann nicht in die Zukunft verschoben werden.');
      return;
    }

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
    const newStart = dayjs(startTime.valueOf() + shift);
    const newEnd = isLiveMode ? dayjs() : dayjs(endTime.valueOf() + shift);
    setStartTime(newStart);
    setEndTime(newEnd);
    console.log(`Zeitbereich verschoben (${direction}):`, {
      start: newStart.format('YYYY-MM-DD HH:mm'),
      end: isLiveMode ? 'Jetzt' : newEnd.format('YYYY-MM-DD HH:mm'),
    });
    shouldFetchData.current = true;
    fetchData();
  };

  const handleMaxPointsChange = (value) => {
    setMaxPoints(value);
    console.log(`Max Punkte geändert auf: ${value}`);
    shouldFetchData.current = true;
    fetchData();
  };

  const toggleLiveMode = (enableLiveMode) => {
    setIsLiveMode(enableLiveMode);
    if (enableLiveMode) {
      const now = dayjs();
      const start = now.subtract(
        selectedInterval === '1h' ? 1 : selectedInterval === '1d' ? 24 : 7 * 24,
        'hour'
      );
      setStartTime(start);
      setEndTime(now);
      console.log('Echtzeit-Modus aktiviert:', {
        start: start.format('YYYY-MM-DD HH:mm'),
        end: 'Jetzt',
      });
    } else {
      const now = dayjs();
      setEndTime(now);
      console.log('Von-Bis-Modus aktiviert:', {
        start: startTime.format('YYYY-MM-DD HH:mm'),
        end: now.format('YYYY-MM-DD HH:mm'),
      });
    }
    shouldFetchData.current = true;
    fetchData();
  };

  // Daten für Chart.js formatieren
  const prepareChartData = () => {
    if (!chartData || chartData.length === 0) {
      console.log('Keine Daten für Chart.js verfügbar');
      return {
        datasets: [],
      };
    }

    const topics = Object.keys(chartData[0]).filter(key => key !== 'timestamp');
    console.log('Verfügbare Topics:', topics);
    console.log('Aktuelle visibleLines:', visibleLines);

    const datasets = topics
      .filter(topic => {
        const isVisible = visibleLines[topic] !== false;
        console.log(`Topic ${topic} sichtbar: ${isVisible}`);
        return isVisible;
      })
      .map(topic => {
        const setting = loggingSettings.find(s => s.topic === topic);
        const color = setting && setting.color ? setting.color : '#ffffff';
        const unit = setting ? setting.unit : '°C';
        const yAxisID = unit === '°C' ? 'yLeft' : 'yRight';

        const data = chartData
          .map(item => ({
            x: item.timestamp,
            y: item[topic],
          }))
          .filter(point => {
            const isValid = typeof point.x === 'number' && !isNaN(point.x) && point.y != null && !isNaN(point.y);
            if (!isValid) {
              console.log(`Ungültiger Datenpunkt für Topic ${topic}:`, point);
            }
            return isValid;
          });

        console.log(`Daten für Topic ${topic}:`, data);

        return {
          label: setting && setting.description ? setting.description : topic,
          data: data,
          borderColor: color,
          backgroundColor: color,
          borderWidth: 2,
          fill: false,
          pointRadius: 0,
          yAxisID: yAxisID,
        };
      })
      .filter(dataset => dataset.data.length > 0); // Entferne Datasets ohne gültige Daten

    console.log('Erstellte Datasets für Chart.js:', datasets);

    return {
      datasets,
    };
  };

  // Chart.js-Optionen mit vollständiger Deaktivierung aller Animationen
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 0,
    },
    transitions: {
      active: {
        animation: {
          duration: 0,
        },
      },
      show: {
        animation: {
          duration: 0,
        },
      },
      hide: {
        animation: {
          duration: 0,
        },
      },
    },
    scales: {
      x: {
        type: 'time',
        time: {
          unit: endTime.diff(startTime, 'day') >= 7 ? 'day' :
                endTime.diff(startTime, 'day') >= 1 ? 'hour' :
                endTime.diff(startTime, 'hour') >= 1 ? 'minute' : 'second',
          displayFormats: {
            second: 'HH:mm:ss',
            minute: 'HH:mm',
            hour: 'DD.MM HH:mm',
            day: 'DD.MM',
          },
        },
        ticks: {
          maxTicksLimit: 10,
          color: '#fff',
          font: {
            size: windowDimensions.width < 768 ? 12 : 16,
          },
        },
        grid: {
          display: false,
        },
      },
      yLeft: {
        position: 'left',
        title: {
          display: true,
          text: '°C',
          color: '#fff',
          font: {
            size: 16,
          },
        },
        ticks: {
          color: '#fff',
          font: {
            size: windowDimensions.width < 768 ? 12 : 16,
          },
        },
        grid: {
          color: '#444',
          borderDash: [3, 3],
        },
      },
      yRight: {
        position: 'right',
        title: {
          display: true,
          text: '%',
          color: '#fff',
          font: {
            size: 16,
          },
        },
        ticks: {
          color: '#fff',
          font: {
            size: windowDimensions.width < 768 ? 12 : 16,
          },
        },
        grid: {
          display: false,
        },
      },
    },
    plugins: {
      legend: {
        position: 'right',
        labels: {
          color: '#fff',
          font: {
            size: windowDimensions.width < 768 ? 12 : 14,
          },
          boxWidth: 10,
          boxHeight: 10,
          padding: 5,
          filter: (legendItem) => {
            return visibleLines[legendItem.text] !== false;
          },
        },
        onClick: (e, legendItem) => {
          setVisibleLines(prev => ({
            ...prev,
            [legendItem.text]: !prev[legendItem.text],
          }));
        },
      },
      tooltip: {
        animation: {
          duration: 0,
        },
        backgroundColor: '#333',
        titleColor: '#fff',
        bodyColor: '#fff',
        callbacks: {
          label: (context) => {
            const topic = context.dataset.label;
            const setting = loggingSettings.find(s => (s.description || s.topic) === topic);
            const unit = setting ? setting.unit : '°C';
            return `${topic}: ${context.parsed.y} ${unit}`;
          },
          title: (tooltipItems) => {
            const timestamp = tooltipItems[0].parsed.x;
            const date = new Date(timestamp);
            const hours = date.getHours();
            const minutes = date.getMinutes();
            const formattedTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
            const diffDays = endTime.diff(startTime, 'day');
            const diffHours = endTime.diff(startTime, 'hour');

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
          },
        },
      },
    },
    hover: {
      animationDuration: 0,
    },
    elements: {
      line: {
        tension: 0,
      },
      point: {
        radius: 0,
      },
    },
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
      bodyStyle={{ padding: 0 }}
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
            <label style={{ color: '#fff', marginRight: '10px' }}>Von:</label>
            <DatePicker
              showTime={{ format: 'HH:mm' }}
              format="YYYY-MM-DD HH:mm"
              value={startTime}
              onChange={(date) => {
                if (date) {
                  setStartTime(date);
                  console.log('Startzeit ausgewählt:', date.format('YYYY-MM-DD HH:mm'));
                  shouldFetchData.current = true;
                  fetchData();
                } else {
                  const now = dayjs();
                  setStartTime(now.subtract(1, 'hour'));
                  console.log('Startzeit zurückgesetzt:', now.subtract(1, 'hour').format('YYYY-MM-DD HH:mm'));
                  shouldFetchData.current = true;
                  fetchData();
                }
              }}
              allowClear={false}
              style={{ width: windowDimensions.width < 768 ? '100%' : '150px' }}
              popupStyle={{ backgroundColor: '#141414', color: '#fff' }}
            />
            {!isLiveMode && (
              <>
                <label style={{ color: '#fff', marginLeft: '10px', marginRight: '10px' }}>Bis:</label>
                <DatePicker
                  showTime={{ format: 'HH:mm' }}
                  format="YYYY-MM-DD HH:mm"
                  value={endTime}
                  onChange={(date) => {
                    if (date) {
                      setEndTime(date);
                      console.log('Endzeit ausgewählt:', date.format('YYYY-MM-DD HH:mm'));
                      shouldFetchData.current = true;
                      fetchData();
                    } else {
                      const now = dayjs();
                      setEndTime(now);
                      console.log('Endzeit zurückgesetzt:', now.format('YYYY-MM-DD HH:mm'));
                      shouldFetchData.current = true;
                      fetchData();
                    }
                  }}
                  allowClear={false}
                  style={{ width: windowDimensions.width < 768 ? '100%' : '150px' }}
                  popupStyle={{ backgroundColor: '#141414', color: '#fff' }}
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
              type={isLiveMode ? 'default' : 'primary'}
              style={{
                backgroundColor: isLiveMode ? '#333333' : '#ffb000',
                borderColor: '#434343',
                color: '#fff',
              }}
            >
              Von-Bis
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
          <div style={{ height: chartHeight, padding: '20px' }}>
            <Line data={prepareChartData()} options={chartOptions} />
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ChartPopup;