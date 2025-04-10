import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Modal, DatePicker, Button, Space, message } from 'antd';
import { ResponsiveLine } from '@nivo/line';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import socket from './socket';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { useTranslation } from 'react-i18next';

dayjs.extend(customParseFormat);

const ChartPopup = ({ visible, onClose, currentPage }) => {
  const { t, i18n } = useTranslation();
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [startTime, setStartTime] = useState(() => dayjs().subtract(1, 'hour'));
  const [endTime, setEndTime] = useState(() => dayjs());
  const [selectedInterval, setSelectedInterval] = useState('1h');
  const [isLiveMode, setIsLiveMode] = useState(true);
  const [loggingSettings, setLoggingSettings] = useState([]);
  const [windowDimensions, setWindowDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [visibleSeries, setVisibleSeries] = useState({});

  const hasRequestedInitialData = useRef(false);
  const shouldFetchData = useRef(false);
  const intervalIdRef = useRef(null);

  const isMobile = windowDimensions.width < 768;

  const updateLanguage = useCallback(() => {
    socket.emit('set-language', { language: i18n.language });
  }, [i18n.language]);

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
      updateLanguage();
      socket.emit('request-logging-settings');
    }
  }, [visible, updateLanguage]);

  useEffect(() => {
    updateLanguage();
    if (visible) {
      socket.emit('request-logging-settings');
    }
  }, [i18n.language, visible, updateLanguage]);

  useEffect(() => {
    const handleChartDataUpdate = (data) => {
      if (!data || data.length === 0) {
        setChartData([]);
        setLoading(false);
        return;
      }

      const formattedData = [];
      const topics = new Set();
      data.forEach(item => {
        Object.keys(item).forEach(key => {
          if (key !== 'time') topics.add(key);
        });
      });

      topics.forEach(topic => {
        const setting = loggingSettings.find(s => s.topic === topic);
        const series = {
          id: topic,
          data: data.map(item => ({
            x: new Date(item.time),
            y: item[topic] !== null && item[topic] !== undefined ? Number(item[topic]) : null,
          })),
        };
        formattedData.push(series);
      });

      setChartData(formattedData);
      setVisibleSeries(prev => {
        const newVisible = { ...prev };
        formattedData.forEach(series => {
          if (!(series.id in newVisible)) {
            newVisible[series.id] = true;
          }
        });
        return newVisible;
      });
      setLoading(false);
    };

    const handleChartDataError = (error) => {
      message.error(`Fehler: ${error.message}`);
      setLoading(false);
    };

    const handleChartDataWarning = (warning) => {
      message.warning(warning.message);
    };

    const handleLoggingSettingsUpdate = (data) => {
      setLoggingSettings(data);
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
  }, [loggingSettings]);

  const fetchData = useCallback((start, end, liveMode, page) => {
    if (!shouldFetchData.current) return;

    if (!start) {
      message.error('Bitte wählen Sie eine Startzeit aus.');
      return;
    }
    if (!liveMode && !end) {
      message.error('Bitte wählen Sie eine Endzeit aus.');
      return;
    }
    if (!liveMode && start.isAfter(end)) {
      message.error('Startzeit muss vor Endzeit liegen.');
      return;
    }

    setLoading(true);
    const params = {
      start: start.toISOString(),
      end: liveMode ? 'now()' : (dayjs.isDayjs(end) ? end.toISOString() : dayjs().toISOString()),
      page: page,
    };
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
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
      }
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
      setStartTime(now.subtract(1, 'hour'));
      setEndTime(now);
      hasRequestedInitialData.current = false;
      shouldFetchData.current = false;
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
      }
    }
  }, [visible, fetchData, currentPage]);

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
    shouldFetchData.current = true;
    fetchData(start, now, isLiveMode, currentPage);
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
    shouldFetchData.current = true;
    fetchData(newStart, newEnd, isLiveMode, currentPage);
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
      shouldFetchData.current = true;
      fetchData(start, now, true, currentPage);
    } else {
      const now = dayjs();
      setEndTime(now);
      shouldFetchData.current = true;
      fetchData(startTime, now, false, currentPage);
    }
  };

  const toggleSeriesVisibility = (seriesId) => {
    setVisibleSeries(prev => ({
      ...prev,
      [seriesId]: !prev[seriesId],
    }));
  };

  const chartContent = useMemo(() => {
    if (loading) {
      return (
        <div style={{ color: '#fff', textAlign: 'center', padding: '20px', height: '100%' }}>
          Lade Diagrammdaten...
        </div>
      );
    }
    if (chartData.length === 0) {
      return (
        <div style={{ color: '#fff', textAlign: 'center', padding: '20px', height: '100%' }}>
          Keine Daten verfügbar
        </div>
      );
    }

    const visibleChartData = chartData.filter(series => visibleSeries[series.id]);

    const legendData = chartData.map(d => {
      const setting = loggingSettings.find(s => s.topic === d.id);
      return {
        id: d.id,
        label: setting?.description || d.id,
        color: setting?.color || '#ffffff',
      };
    });

    const maxLabelLength = legendData.reduce((max, item) => {
      const labelLength = item.label.length;
      return Math.max(max, labelLength);
    }, 0);
    const itemWidth = Math.min(Math.max(maxLabelLength * 8, isMobile ? 60 : 100), isMobile ? 150 : 250);
    const legendPadding = isMobile ? 20 : 30;

    return (
      <div style={{ height: '100%', width: '100%' }}>
        <ResponsiveLine
          data={visibleChartData}
          theme={{
            background: '#141414',
            textColor: '#ffffff',
            fontSize: isMobile ? 12 : 14,
            axis: {
              domain: { line: { stroke: '#777777', strokeWidth: 1 } },
              ticks: { line: { stroke: '#777777', strokeWidth: 1 }, text: { fill: '#ffffff' } },
              legend: { text: { fill: '#ffffff' } },
            },
            grid: { line: { stroke: '#444444', strokeWidth: 1 } },
            legends: { text: { fill: '#ffffff' } },
            tooltip: { container: { background: '#333333', color: '#ffffff', fontSize: 12 } },
            crosshair: { line: { stroke: '#ffffff', strokeWidth: 1, strokeOpacity: 0.75 } },
          }}
          margin={{ top: 20, right: itemWidth + legendPadding, bottom: 40, left: 50 }}
          xScale={{ type: 'time', format: 'native' }}
          yScale={{ type: 'linear', min: 'auto', max: 'auto' }}
          axisBottom={{
            format: (value) => {
              const date = new Date(value);
              const diffDays = endTime.diff(startTime, 'day');
              const diffHours = endTime.diff(startTime, 'hour');
              if (diffDays >= 7) return `${date.getDate()}.${(date.getMonth() + 1).toString().padStart(2, '0')}`;
              if (diffDays >= 1) return `${date.getDate()}.${(date.getMonth() + 1).toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
              if (diffHours >= 1) return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
              return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
            },
            tickSize: 5,
            tickPadding: 5,
            tickRotation: isMobile ? -90 : -45,
          }}
          axisLeft={{
            tickSize: 5,
            tickPadding: 5,
            legend: '°C',
            legendOffset: -40,
            legendPosition: 'top',
          }}
          axisRight={{
            tickSize: 5,
            tickPadding: 5,
            legend: '%',
            legendOffset: 40,
            legendPosition: 'top',
          }}
          colors={d => loggingSettings.find(s => s.topic === d.id)?.color || '#ffffff'}
          lineWidth={2}
          enablePoints={false}
          enableGridX={true}
          enableGridY={true}
          gridXValues={5}
          gridYValues={5}
          useMesh={true}
          enableSlices="x"
          crosshairType="x"
          sliceTooltip={({ slice }) => {
            const timestamp = slice.points[0]?.data.x;
            if (!timestamp) return null;
            const timeString = dayjs(timestamp).format(
              endTime.diff(startTime, 'day') >= 7
                ? 'DD.MM'
                : endTime.diff(startTime, 'hour') >= 1
                ? 'DD.MM HH:mm'
                : 'HH:mm:ss'
            );
            return (
              <div
                style={{
                  background: '#333333',
                  color: '#ffffff',
                  padding: '10px',
                  borderRadius: '3px',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.5)',
                }}
              >
                <strong>{timeString}</strong>
                {slice.points.map(point => {
                  const setting = loggingSettings.find(s => s.topic === point.serieId);
                  const unit = setting ? setting.unit : '°C';
                  return (
                    <div key={point.id} style={{ marginTop: '5px', display: 'flex', alignItems: 'center' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 10,
                          height: 10,
                          backgroundColor: point.serieColor,
                          marginRight: 5,
                        }}
                      />
                      {setting?.description || point.serieId}: {point.data.yFormatted} {unit}
                    </div>
                  );
                })}
              </div>
            );
          }}
          legends={[
            {
              anchor: 'right',
              direction: 'column',
              justify: false,
              translateX: itemWidth + 30,
              translateY: 0,
              itemsSpacing: 5,
              itemWidth: itemWidth,
              itemHeight: 20,
              itemTextColor: '#ffffff',
              symbolSize: 10,
              symbolShape: 'circle',
              data: legendData,
              onClick: (datum) => toggleSeriesVisibility(datum.id),
              effects: [
                {
                  on: 'hover',
                  style: {
                    itemTextColor: '#fff',
                    itemOpacity: 1,
                  },
                },
              ],
              itemOpacity: (datum) => (visibleSeries[datum.id] ? 1 : 0.3),
            },
          ]}
          motionConfig="none"
        />
      </div>
    );
  }, [loading, chartData, loggingSettings, windowDimensions, endTime, startTime, isMobile, visibleSeries]);

  return (
    <Modal
      visible={visible}
      onCancel={onClose}
      footer={null}
      width="100vw"
      style={{
        top: 0,
        left: 0,
        padding: 0,
        margin: 0,
        width: '100vw',
        height: '100vh',
        maxWidth: 'none',
      }}
      styles={{
        body: {
          height: '100vh',
          padding: 0,
          backgroundColor: '#141414',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          width: '100%',
        },
        content: {
          padding: 0,
          margin: 0,
          width: '100vw',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
        },
        mask: {
          width: '100vw',
          height: '100vh',
        },
        wrapper: {
          width: '100vw',
          height: '100vh',
          padding: 0,
          margin: 0,
        },
      }}
      wrapClassName="fullscreen-modal"
    >
      <div
        style={{
          padding: '8px 16px',
          backgroundColor: '#1f1f1f',
          borderBottom: '1px solid #333',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
          width: '100%',
        }}
      >
        <Space size="middle" align="center" wrap>
          <Button
            size={isMobile ? 'large' : 'middle'}
            icon={<LeftOutlined />}
            onClick={() => shiftTimeRange('backward')}
            style={{ backgroundColor: '#333333', borderColor: '#434343', color: '#fff' }}
          />
          <Button
            size={isMobile ? 'large' : 'middle'}
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
            size={isMobile ? 'large' : 'middle'}
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
            size={isMobile ? 'large' : 'middle'}
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
            size={isMobile ? 'large' : 'middle'}
            onClick={() => toggleLiveMode(true)}
            type={isLiveMode ? 'primary' : 'default'}
            style={{
              backgroundColor: isLiveMode ? '#ffb000' : '#333333',
              borderColor: '#434343',
              color: '#fff',
            }}
          >
            {t('Realtime')}
          </Button>
          <Button
            size={isMobile ? 'large' : 'middle'}
            onClick={() => toggleLiveMode(false)}
            type={isLiveMode ? 'default' : 'primary'}
            style={{
              backgroundColor: isLiveMode ? '#333333' : '#ffb000',
              borderColor: '#434343',
              color: '#fff',
            }}
          >
            {t('Range')}
          </Button>
          <Space size={4} align="center">
            <span style={{ color: '#fff', fontSize: isMobile ? 12 : 14 }}>{t('from')}:</span>
            <DatePicker
              showTime={{ format: 'HH:mm' }}
              format="YYYY-MM-DD HH:mm"
              value={startTime}
              onChange={(date) => {
                if (date) {
                  setStartTime(date);
                  shouldFetchData.current = true;
                  fetchData(date, endTime, isLiveMode, currentPage);
                } else {
                  const now = dayjs();
                  setStartTime(now.subtract(1, 'hour'));
                  shouldFetchData.current = true;
                  fetchData(now.subtract(1, 'hour'), endTime, isLiveMode, currentPage);
                }
              }}
              allowClear={false}
              size="small"
              style={{ width: isMobile ? 120 : 150 }}
              popupStyle={{ backgroundColor: '#141414', color: '#fff' }}
            />
            {!isLiveMode && (
              <>
                <span style={{ color: '#fff', fontSize: isMobile ? 12 : 14 }}>{t('to')}:</span>
                <DatePicker
                  showTime={{ format: 'HH:mm' }}
                  format="YYYY-MM-DD HH:mm"
                  value={endTime}
                  onChange={(date) => {
                    if (date) {
                      setEndTime(date);
                      shouldFetchData.current = true;
                      fetchData(startTime, date, isLiveMode, currentPage);
                    } else {
                      const now = dayjs();
                      setEndTime(now);
                      shouldFetchData.current = true;
                      fetchData(startTime, now, isLiveMode, currentPage);
                    }
                  }}
                  allowClear={false}
                  size="small"
                  style={{ width: isMobile ? 120 : 150 }}
                  popupStyle={{ backgroundColor: '#141414', color: '#fff' }}
                />
              </>
            )}
          </Space>
          <Button
            size={isMobile ? 'large' : 'middle'}
            icon={<RightOutlined />}
            onClick={() => shiftTimeRange('forward')}
            style={{ backgroundColor: '#333333', borderColor: '#434343', color: '#fff' }}
          />
        </Space>
        <Space size="large" wrap />
      </div>
      <div style={{ flex: 1, overflow: 'hidden', width: '100%' }}>{chartContent}</div>
    </Modal>
  );
};

export default ChartPopup;