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
  const [chartData, setChartData] = useState([]); // Format: [{ id, label, color, unit, data: [{x, y}] }]
  const [loading, setLoading] = useState(false);
  const [startTime, setStartTime] = useState(() => dayjs().subtract(1, 'hour'));
  const [endTime, setEndTime] = useState(() => dayjs());
  const [selectedInterval, setSelectedInterval] = useState('1h');
  const [isLiveMode, setIsLiveMode] = useState(true);
  const [windowDimensions, setWindowDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [visibleSeries, setVisibleSeries] = useState({});

  const hasRequestedInitialData = useRef(false);
  const shouldFetchData = useRef(false);
  const intervalIdRef = useRef(null);

  const isMobile = windowDimensions.width < 768;

  // Effect to handle window resize
  useEffect(() => {
    const handleResize = () => setWindowDimensions({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Callback to fetch data, includes language parameter
  const fetchData = useCallback((start, end, liveMode, page) => {
    // Prevent unnecessary fetches, especially in range mode when not triggered explicitly
    if (!shouldFetchData.current && hasRequestedInitialData.current && !liveMode) return;

    if (!start) { console.warn('fetchData: No start time selected.'); return; }
    if (!liveMode && !end) { console.warn('fetchData: No end time selected.'); return; }
    if (!liveMode && start.isAfter(end)) { message.error(t('startTimeBeforeEndTimeError', 'Startzeit muss vor Endzeit liegen.')); return; }

    setLoading(true);
    const params = {
      start: start.toISOString(),
      end: liveMode ? 'now()' : (dayjs.isDayjs(end) ? end.toISOString() : dayjs().toISOString()),
      page: page,
      lang: i18n.language // Send current language
    };
    // console.log('[ChartPopup] Requesting chart data with params:', params); // Uncomment for debugging
    socket.emit('request-chart-data', params);
  }, [i18n.language, t, currentPage]); // Dependencies for useCallback

  // Effect for Socket.IO listeners
  useEffect(() => {
     const handleChartDataUpdate = (data) => {
       // console.log('[ChartPopup] Received chart data update length:', data?.length); // Log length
       if (!data || !Array.isArray(data) || data.length === 0) {
         setChartData([]); setLoading(false); console.log('[ChartPopup] Received empty data, clearing chart.'); return;
       }

       const seriesMap = new Map();
       data.forEach(item => {
         if (!item || typeof item.data !== 'object' || item.data === null) return;
         const timestamp = new Date(item.time);
         Object.entries(item.data).forEach(([topic, topicData]) => {
            if (!topicData) return;
            if (!seriesMap.has(topic)) {
               seriesMap.set(topic, {
                 id: topic,
                 label: topicData.label || topic,
                 color: topicData.color || '#ffffff',
                 unit: (topicData.unit !== null && topicData.unit !== undefined) ? String(topicData.unit) : '',
                 data: []
               });
            }
            const value = topicData.value;
            seriesMap.get(topic).data.push({
              x: timestamp,
              y: (value !== null && value !== undefined && !isNaN(Number(value))) ? Number(value) : null
            });
         });
       });

       const formattedData = Array.from(seriesMap.values());
       // console.log('[ChartPopup] Formatted data state set:', formattedData); // Uncomment for debugging
       setChartData(formattedData);

       setVisibleSeries(prev => {
         const newVisible = { ...prev };
         formattedData.forEach(series => { if (!(series.id in newVisible)) newVisible[series.id] = true; });
         return newVisible;
       });
       setLoading(false);
     };

    const handleChartDataError = (error) => { message.error(`${t('chartDataErrorPrefix', 'Fehler')}: ${error.message}`); console.error('[ChartPopup] Chart data error:', error); setChartData([]); setLoading(false); };
    const handleChartDataWarning = (warning) => { message.warning(warning.message); console.warn('[ChartPopup] Chart data warning:', warning); };

    socket.on('connect', () => console.log('[ChartPopup] Socket verbunden'));
    socket.on('disconnect', () => console.log('[ChartPopup] Socket getrennt'));
    socket.on('chart-data-update', handleChartDataUpdate);
    socket.on('chart-data-error', handleChartDataError);
    socket.on('chart-data-warning', handleChartDataWarning);

    return () => {
      socket.off('connect'); socket.off('disconnect'); socket.off('chart-data-update', handleChartDataUpdate);
      socket.off('chart-data-error', handleChartDataError); socket.off('chart-data-warning', handleChartDataWarning);
    };
  }, [t]); // Dependency t for error messages

  // --- Time range control functions (setIntervalRange, shiftTimeRange, toggleLiveMode) ---
  const setIntervalRange = (interval) => {
      const now = dayjs(); let start;
      switch (interval) { case '1d': start = now.subtract(1, 'day'); break; case '1w': start = now.subtract(1, 'week'); break; default: start = now.subtract(1, 'hour'); }
      setSelectedInterval(interval); setStartTime(start); setEndTime(now); setIsLiveMode(true);
      shouldFetchData.current = true; fetchData(start, now, true, currentPage);
  };

  const shiftTimeRange = (direction) => {
      if (isLiveMode && direction === 'forward') { message.info(t('cannotShiftForwardInLiveMode', 'Im "Echtzeit"-Modus kann nicht in die Zukunft verschoben werden.')); return; }
      let durationMillis; const currentDuration = endTime.diff(startTime); durationMillis = currentDuration > 0 ? currentDuration : 60 * 60 * 1000; if (durationMillis < 60 * 60 * 1000) durationMillis = 60 * 60 * 1000;
      const shift = direction === 'forward' ? durationMillis : -durationMillis; const newStart = dayjs(startTime.valueOf() + shift); let newEnd = dayjs(endTime.valueOf() + shift);
      if (!isLiveMode && newEnd.isAfter(dayjs())) { newEnd = dayjs(); if (newStart.isAfter(newEnd)) { message.warning(t('invalidTimeRangeShift', 'Ungültiger Zeitraum nach Verschiebung.')); return; } }
      setStartTime(newStart); setEndTime(newEnd); setIsLiveMode(false);
      shouldFetchData.current = true; fetchData(newStart, newEnd, false, currentPage);
  };

  const toggleLiveMode = (enableLiveMode) => {
      setIsLiveMode(enableLiveMode);
      if (enableLiveMode) {
          const now = dayjs(); let start;
          switch (selectedInterval) { case '1d': start = now.subtract(1, 'day'); break; case '1w': start = now.subtract(1, 'week'); break; default: start = now.subtract(1, 'hour'); }
          setStartTime(start); setEndTime(now);
          shouldFetchData.current = true; fetchData(start, now, true, currentPage);
      } else {
          const currentEndTime = dayjs();
          setEndTime(currentEndTime);
          shouldFetchData.current = true; fetchData(startTime, currentEndTime, false, currentPage);
      }
  };

  const toggleSeriesVisibility = (seriesId) => { setVisibleSeries(prev => ({ ...prev, [seriesId]: !prev[seriesId] })); };

  // Effect for initial data fetch / reset on visibility change
  useEffect(() => {
    if (visible) {
       if (!hasRequestedInitialData.current) {
            shouldFetchData.current = true;
            console.log('[ChartPopup] Visible: Requesting initial data...');
            fetchData(startTime, endTime, isLiveMode, currentPage);
            hasRequestedInitialData.current = true;
       }
    } else {
      const now = dayjs(); setChartData([]); setSelectedInterval('1h');
      setIsLiveMode(true); setStartTime(now.subtract(1, 'hour')); setEndTime(now);
      setVisibleSeries({}); hasRequestedInitialData.current = false;
      shouldFetchData.current = false;
      if (intervalIdRef.current) { clearInterval(intervalIdRef.current); intervalIdRef.current = null; }
      console.log('[ChartPopup] Closed: Resetting state.');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]); // fetchData added back as dependency via eslint suggestion

  // Effect for live mode refresh interval
   useEffect(() => {
     let intervalHandle = null;
     if (visible && isLiveMode) {
       shouldFetchData.current = true; // Ensure fetches are allowed
       // Optional: Fetch immediately when switching to live mode if needed, but careful not to double-fetch with 'visible' effect
       // fetchData(startTime, endTime, true, currentPage);

       intervalHandle = setInterval(() => {
         if(shouldFetchData.current && isLiveMode){ // Double check inside interval
             console.log('[ChartPopup] Live mode interval: Fetching data...');
             fetchData(startTime, endTime, true, currentPage);
         }
       }, 30 * 1000);
       intervalIdRef.current = intervalHandle;
       console.log('[ChartPopup] Live mode interval started.');
     }
     return () => {
       if (intervalHandle) { clearInterval(intervalHandle); intervalIdRef.current = null; console.log('[ChartPopup] Live mode interval cleared.'); }
     };
   // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [visible, isLiveMode, startTime, endTime, currentPage]); // fetchData added back as dependency

  // Memoized chart content
  const chartContent = useMemo(() => {
    // console.log('[ChartPopup] Recalculating chartContent.'); // Less verbose log
    if (loading && chartData.length === 0) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#fff', fontSize: isMobile ? '14px' : '18px' }}>{t('loadingChartData', 'Lade Diagrammdaten...')}</div>;
    if (!loading && chartData.length === 0 && hasRequestedInitialData.current) return <div style={{ color: '#aaa', textAlign: 'center', padding: '20px', height: '100%', fontSize: isMobile ? '14px' : '18px' }}>{t('noChartDataAvailable', 'Keine Daten verfügbar für den ausgewählten Zeitraum.')}</div>;
    if (chartData.length === 0) return <div style={{ color: '#aaa', textAlign: 'center', padding: '20px', height: '100%', fontSize: isMobile ? '14px' : '18px' }}>{t('noChartData', 'Keine Diagrammdaten.')}</div>;

    const visibleChartData = chartData.filter(series => visibleSeries[series.id]);
    // console.log('[ChartPopup] visibleChartData for render:', visibleChartData.length); // Log count

    const legendData = chartData.map(series => ({ id: series.id, label: series.label, color: series.color }));
    const maxLabelLength = legendData.reduce((max, item) => Math.max(max, (item.label || '').length), 0);
    const baseCharWidth = isMobile ? 7 : 8; const symbolAndPadding = 40; const minWidth = isMobile ? 100 : 140; const maxWidth = isMobile ? 180 : 300;
    const calculatedWidth = maxLabelLength * baseCharWidth + symbolAndPadding; const itemWidth = Math.min(Math.max(calculatedWidth, minWidth), maxWidth);
    const legendPadding = isMobile ? 15 : 15;
    const commonAxisProps = { tickSize: 5, tickPadding: 5 };

    // *** Achsenlegenden-Konfiguration ***
    const tempAxisProps = {
      ...commonAxisProps,
      legend: '°C',
      legendOffset: -40, // Angepasst für Position oben
      legendPosition: 'middle', // Oben an der Achse
    };
    const percentAxisProps = {
      ...commonAxisProps,
      legend: '%',
      legendOffset: 40,  // Angepasst für Position oben
      legendPosition: 'middle', // Oben an der Achse
    };
    // *** ENDE Achsenlegenden-Konfiguration ***

    let hasTemp = false; let hasPercent = false;
    visibleChartData.forEach(series => { if (series.unit === '°C') hasTemp = true; if (series.unit === '%') hasPercent = true; });
    // console.log(`[ChartPopup] Axis Flags: hasTemp=${hasTemp}, hasPercent=${hasPercent}`);

    return (
      <div style={{ height: '100%', width: '100%' }}>
        <ResponsiveLine
          data={visibleChartData}
          // *** Theme mit korrekter Legenden-Textfarbe ***
          theme={{
            background: '#141414', textColor: '#ffffff', fontSize: isMobile ? 10 : 11,
            axis: { domain: { line: { stroke: '#777777', strokeWidth: 1 } }, ticks: { line: { stroke: '#777777', strokeWidth: 1 }, text: { fill: '#ffffff' } }, legend: { text: { fill: '#ffffff', fontSize: isMobile ? 10 : 21 } } },
            grid: { line: { stroke: '#444444', strokeWidth: 1 } },
            legends: { text: { fill: '#ffffff', fontSize: isMobile ? 10 : 15 } }, // Basis-Textfarbe für Legende
            tooltip: { container: { background: '#333333', color: '#ffffff', fontSize: 12 } },
            crosshair: { line: { stroke: '#ffffff', strokeWidth: 1, strokeOpacity: 0.75 } },
          }}
          margin={{ top: 20, right: itemWidth + legendPadding, bottom: isMobile ? 70 : 50, left: 50 }}
          xScale={{ type: 'time', format: 'native', precision: 'second' }}
          yScale={{ type: 'linear', min: 'auto', max: 'auto' }}
          axisBottom={{ format: (value) => { const d=new Date(value); const dM=endTime.diff(startTime,'m'); const dH=endTime.diff(startTime,'h'); const dD=endTime.diff(startTime,'d'); if(dD>7)return dayjs(d).format('DD.MM'); if(dD>1)return dayjs(d).format('DD.MM HH:mm'); if(dH>1)return dayjs(d).format('HH:mm'); return dayjs(d).format('HH:mm'); }, tickSize: 5, tickPadding: 5, tickRotation: isMobile ? -90 : -45 }}
          axisLeft={hasTemp ? tempAxisProps : null}
          axisRight={hasPercent ? percentAxisProps : null}
          colors={d => d.color}
          lineWidth={2} enablePoints={false} enableGridX={true} enableGridY={true} gridXValues={5} gridYValues={5}
          useMesh={true} enableSlices="x" crosshairType="x"
          sliceTooltip={({ slice }) => { const ts=slice.points[0]?.data.x; if(!ts) return null; const dM=endTime.diff(startTime,'m'); const tF=dM<120?'HH:mm':'HH:mm'; const dF=endTime.diff(startTime,'d')>0?'DD.MM.YY ':''; const tS=dayjs(ts).format(`${dF}${tF}`); return (<div style={{background:'rgba(51,51,51,0.9)',color:'#fff',padding:'8px 12px',borderRadius:'3px',boxShadow:'0 2px 4px rgba(0,0,0,0.5)',fontSize:'11px'}}><strong>{tS}</strong>{slice.points.map(p=>{const sI=chartData.find(s=>s.id===p.serieId);if(!sI||p.data.y===null)return null;const l=sI.label;const u=sI.unit||'';const vF=typeof p.data.y==='number'?p.data.y.toFixed(1):'N/A';return(<div key={p.id} style={{marginTop:'4px',display:'flex',alignItems:'center'}}><span style={{display:'inline-block',width:8,height:8,backgroundColor:p.serieColor,marginRight:5,borderRadius:'50%'}}/>{l}: {vF} {u}</div>);})}</div>);}}
          legends={[
            {
              anchor: 'top-right', direction: 'column', justify: false,  translateX: itemWidth + legendPadding + 10, translateY: 0,
              itemsSpacing: 2, itemWidth: itemWidth, itemHeight: 18, symbolSize: 10, symbolShape: 'circle',
              data: legendData,
              onClick: (datum) => toggleSeriesVisibility(datum.id),
              // itemTextColor entfernt (kommt vom theme)
              itemOpacity: (datum) => (visibleSeries[datum.id] ? 1 : 0.4), // Steuert Sichtbarkeit über Opazität
            },
          ]}
          motionConfig="basic" enableArea={false} enablePointLabel={false} pointSize={0} animate={true}
        />
      </div>
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, chartData, windowDimensions, endTime, startTime, isMobile, visibleSeries, t]);


  return (
    <Modal
      open={visible}
      onCancel={onClose}
      footer={null}
      width="100vw"
      style={{ top: 0, left: 0, padding: 0, margin: 0, maxWidth: 'none' }}
      styles={{
        body: { height: '100vh', padding: 0, backgroundColor: '#141414', display: 'flex', flexDirection: 'column', overflow: 'hidden', width: '100%' },
        content: { padding: 0, margin: 0, height: '100%', display: 'flex', flexDirection: 'column' },
        mask: { backgroundColor: 'rgba(0, 0, 0, 0.65)' },
        wrapper: { padding: 0, margin: 0, width: '100vw', height: '100vh' },
        header: { backgroundColor: '#1f1f1f', borderBottom: '1px solid #333' },
        close: { color: '#fff', fontSize: '18px'},
        closeIcon: { color: '#fff' }
      }}
      wrapClassName="fullscreen-modal"
      title={null} closable={true} keyboard={true} maskClosable={true}
    >
      {/* Steuerleiste */}
      <div style={{ padding: '8px 16px', backgroundColor: '#1f1f1f', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, width: '100%' }}>
        <Space size={isMobile ? 4 : "small"} align="center" wrap>
          <Button size={isMobile ? 'small' : 'middle'} icon={<LeftOutlined />} onClick={() => shiftTimeRange('backward')} style={{ backgroundColor: '#333333', borderColor: '#434343', color: '#fff' }} title={t('shiftBackward', 'Zeit zurück')} />
          <Button size={isMobile ? 'small' : 'middle'} onClick={() => setIntervalRange('1h')} type={selectedInterval === '1h' && isLiveMode ? 'primary' : 'default'} style={{ backgroundColor: selectedInterval === '1h' && isLiveMode ? '#ffb000' : '#333333', borderColor: '#434343', color: '#fff', minWidth: isMobile ? 40 : 60 }}>1h</Button>
          <Button size={isMobile ? 'small' : 'middle'} onClick={() => setIntervalRange('1d')} type={selectedInterval === '1d' && isLiveMode ? 'primary' : 'default'} style={{ backgroundColor: selectedInterval === '1d' && isLiveMode ? '#ffb000' : '#333333', borderColor: '#434343', color: '#fff', minWidth: isMobile ? 40 : 60 }}>1d</Button>
          <Button size={isMobile ? 'small' : 'middle'} onClick={() => setIntervalRange('1w')} type={selectedInterval === '1w' && isLiveMode ? 'primary' : 'default'} style={{ backgroundColor: selectedInterval === '1w' && isLiveMode ? '#ffb000' : '#333333', borderColor: '#434343', color: '#fff', minWidth: isMobile ? 40 : 60 }}>1w</Button>
          <Button size={isMobile ? 'small' : 'middle'} icon={<RightOutlined />} onClick={() => shiftTimeRange('forward')} style={{ backgroundColor: '#333333', borderColor: '#434343', color: '#fff' }} disabled={isLiveMode} title={t('shiftForward', 'Zeit vorwärts')} />
        
           <Button size={isMobile ? 'small' : 'middle'} onClick={() => toggleLiveMode(true)} type={isLiveMode ? 'primary' : 'default'} style={{ backgroundColor: isLiveMode ? '#ffb000' : '#333333', borderColor: '#434343', color: '#fff' }}>{t('Realtime')}</Button>
           <Button size={isMobile ? 'small' : 'middle'} onClick={() => toggleLiveMode(false)} type={isLiveMode ? 'default' : 'primary'} style={{ backgroundColor: isLiveMode ? '#333333' : '#ffb000', borderColor: '#434343', color: '#fff' }}>{t('Range')}</Button>
          <Space size={2} align="center" style={{ marginLeft: isMobile ? 0 : 10 }}>
             <span style={{ color: '#ccc', fontSize: isMobile ? 10: 12 }}>{t('from')}:</span>
            <DatePicker
              showTime={{ format: 'HH:mm' }} format="YYYY-MM-DD HH:mm" value={startTime}
              onChange={(date) => { if (date && (!endTime || !date.isAfter(endTime))) { setStartTime(date); setIsLiveMode(false); shouldFetchData.current = true; fetchData(date, endTime, false, currentPage); } else if (date) { message.warning(t('startTimeAfterEndTimeWarning', 'Startzeit darf nicht nach der Endzeit liegen.')); } }}
              disabled={isLiveMode} allowClear={false} size="small" style={{ width: isMobile ? 130 : 150 }} popupStyle={{ backgroundColor: '#1f1f1f', color: '#fff' }}
            />
             <span style={{ color: '#ccc', fontSize: isMobile ? 10: 12, marginLeft: 5 }}>{t('to')}:</span>
            <DatePicker
              showTime={{ format: 'HH:mm' }} format="YYYY-MM-DD HH:mm" value={endTime}
              onChange={(date) => { if (date && !date.isBefore(startTime)) { setEndTime(date); setIsLiveMode(false); shouldFetchData.current = true; fetchData(startTime, date, false, currentPage); } else if (date) { message.warning(t('endTimeBeforeStartTimeWarning', 'Endzeit darf nicht vor der Startzeit liegen.')); } }}
              disabled={isLiveMode} allowClear={false} size="small" style={{ width: isMobile ? 130 : 150 }} popupStyle={{ backgroundColor: '#1f1f1f', color: '#fff' }}
            />
          </Space>
        </Space>
      </div>
      {/* Chart-Container */}
      <div style={{ flex: 1, overflow: 'hidden', width: '100%', padding: isMobile ? '5px' : '1px' }}>
        {chartContent}
      </div>
    </Modal>
  );
};

export default ChartPopup;