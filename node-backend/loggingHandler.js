const { InfluxDB, Point } = require('@influxdata/influxdb-client');

class LoggingHandler {
  constructor(io, sqliteDB, mqttHandler) {
    this.io = io;
    this.sqliteDB = sqliteDB;
    this.mqttHandler = mqttHandler;
    this.influxDB = new InfluxDB({
      url: 'http://192.168.10.31:8086',
      token: 'VB4OadT3sVDTkKApno6dZaKbmZhNdBzHn93YDyH41fXRNVHuw49-R1sFL0IYrP6ysoPQAq3QNFVt165MqbjsAg==',
    });
    this.queryApi = this.influxDB.getQueryApi('YgnisAG');
    this.influxClient = this.setupInfluxClient();
    this.activeTopics = new Set();
    this.valueCache = new Map();
    this.loadLoggingSettings();
    this.setupMqttListener();
    this.startMinuteInterval();
    this.setupSocketHandlers();
  }

  setupInfluxClient() {
    return this.influxDB.getWriteApi('YgnisAG', 'dev-bucket', 'ms');
  }

  async loadLoggingSettings() {
    try {
      const rows = await new Promise((resolve, reject) => {
        this.sqliteDB.all(
          'SELECT topic, enabled, color, page, description, unit FROM logging_settings WHERE enabled = 1',
          [],
          (err, rows) => (err ? reject(err) : resolve(rows))
        );
      });
      this.activeTopics = new Set(rows.map(row => row.topic));
      console.log('Active topics loaded:', this.activeTopics);
    } catch (err) {
      console.error('Fehler beim Laden der Logging-Einstellungen:', err);
    }
  }

  setupMqttListener() {
    this.mqttHandler.onMessage((topic, value) => {
      if (this.activeTopics.has(topic)) {
        this.storeValue(topic, value);
      }
    });
  }

  storeValue(topic, value) {
    const numericValue = parseFloat(value);
    if (isNaN(numericValue)) {
      console.warn(`Ungültiger Wert für Topic ${topic}: ${value}`);
      return;
    }
    if (!this.valueCache.has(topic)) {
      this.valueCache.set(topic, []);
    }
    this.valueCache.get(topic).push(numericValue);
  }

  startMinuteInterval() {
    setInterval(() => {
      this.writeAveragesToInflux();
    }, 60 * 1000);
  }

  writeAveragesToInflux() {
    if (this.valueCache.size === 0) {
      return;
    }

    const points = [];
    for (const [topic, values] of this.valueCache.entries()) {
      if (values.length === 0) continue;

      const average = values.reduce((sum, val) => sum + val, 0) / values.length;
      const roundedAverage = parseFloat(average.toFixed(1));
      const point = new Point('mqtt_logs')
        .tag('topic', topic)
        .floatField('average', roundedAverage)
        .timestamp(new Date());

      points.push(point);
      console.log(`Mittelwert für ${topic}: ${roundedAverage} (basierend auf ${values.length} Werten)`);
    }

    if (points.length > 0) {
      this.influxClient.writePoints(points);
      this.influxClient.flush().catch(err => {
        console.error('Fehler beim Schreiben der Mittelwerte in InfluxDB:', err);
      });
    }

    this.valueCache.clear();
  }

  async updatePagesAndSettings({ pages, settings }) {
    try {
      await new Promise((resolve, reject) => {
        this.sqliteDB.run('DELETE FROM logging_settings', [], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      for (const setting of settings) {
        await new Promise((resolve, reject) => {
          this.sqliteDB.run(
            `INSERT OR REPLACE INTO logging_settings (topic, enabled, color, page, description, unit, updated_at) 
             VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M','now', 'localtime'))`,
            [setting.topic, setting.enabled ? 1 : 0, setting.color, setting.page, setting.description, setting.unit],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
      }

      this.activeTopics.clear();
      this.valueCache.clear();
      settings.forEach(setting => {
        if (setting.enabled) {
          this.activeTopics.add(setting.topic);
        }
      });

      this.broadcastSettings();
    } catch (err) {
      console.error('Fehler beim Aktualisieren der Seiten und Logging-Einstellungen:', err);
    }
  }

  broadcastSettings() {
    this.sqliteDB.all(
      'SELECT topic, enabled, color, page, description, unit FROM logging_settings ORDER BY page ASC',
      [],
      (err, rows) => {
        if (err) {
          console.error('Fehler beim Abrufen der Logging-Einstellungen:', err);
          return;
        }
        console.log('Broadcasting logging settings:', rows);
        this.io.emit('logging-settings-update', rows);
      }
    );
  }

  async fetchChartData(socket, { start = '-1h', end = 'now()', maxPoints = 50, page }) {
    console.log('Erhaltene Parameter:', { start, end, maxPoints, page });

    const rows = await new Promise((resolve, reject) => {
      this.sqliteDB.all(
        'SELECT topic, page FROM logging_settings WHERE enabled = 1',
        [],
        (err, rows) => (err ? reject(err) : resolve(rows))
      );
    });

    const filteredTopics = rows
      .filter(row => row.page && row.page.split(',').map(p => p.trim()).includes(page))
      .map(row => row.topic);

    console.log('Gefilterte Topics für Seite', page, ':', filteredTopics);

    if (filteredTopics.length === 0) {
      console.log('Keine passenden Topics gefunden, sende leeres Array');
      socket.emit('chart-data-update', []);
      return;
    }

    // Berechne die Zeitdauer des Bereichs in Sekunden
    let startTime, endTime;
    if (start.startsWith('-')) {
      startTime = new Date(dayjs().add(parseInt(start), 'second').valueOf());
      endTime = new Date(dayjs().valueOf());
    } else {
      startTime = new Date(start);
      endTime = new Date(end);
    }

    const timeRangeSeconds = (endTime - startTime) / 1000; // Zeitdauer in Sekunden
    console.log('Zeitbereich:', { startTime, endTime, timeRangeSeconds });

    // Daten für alle Topics abrufen
    const topicFilter = filteredTopics
      .map(topic => `r.topic == "${topic}"`)
      .join(' or ');

    const fluxQuery = `
      from(bucket: "dev-bucket")
        |> range(start: ${start}, stop: ${end})
        |> filter(fn: (r) => r._measurement == "mqtt_logs")
        |> filter(fn: (r) => r._field == "average")
        ${topicFilter ? `|> filter(fn: (r) => ${topicFilter})` : ''}
        |> sort(columns: ["_time"])
    `;

    console.log('Flux-Abfrage:', fluxQuery);

    const rawData = [];
    await this.queryApi.collectRows(fluxQuery, (row, tableMeta) => {
      const timestamp = new Date(tableMeta.get(row, '_time')).getTime();
      const topic = tableMeta.get(row, 'topic');
      const value = parseFloat(tableMeta.get(row, '_value'));
      rawData.push({ time: timestamp, topic, value });
    });

    console.log('Abgerufene Rohdaten:', rawData);

    // Gruppiere die Daten nach Zeitstempel
    const groupedByTime = {};
    rawData.forEach(({ time, topic, value }) => {
      // Runde den Zeitstempel auf die nächste Sekunde, um Millisekundenunterschiede zu eliminieren
      const roundedTime = Math.round(time / 1000) * 1000;
      if (!groupedByTime[roundedTime]) {
        groupedByTime[roundedTime] = { time: roundedTime };
        filteredTopics.forEach(t => {
          groupedByTime[roundedTime][t] = null;
        });
      }
      groupedByTime[roundedTime][topic] = value;
    });

    let allData = Object.values(groupedByTime).sort((a, b) => a.time - b.time);
    console.log('Gruppiert nach Zeitstempel:', allData);

    // Wähle bis zu maxPoints Datenpunkte aus, die gleichmäßig verteilt sind
    if (allData.length > maxPoints) {
      const step = allData.length / maxPoints;
      const selectedData = [];
      for (let i = 0; i < maxPoints; i++) {
        const index = Math.floor(i * step);
        selectedData.push(allData[index]);
      }
      allData = selectedData;
    }

    console.log(`Ausgewählte Daten (${allData.length} Punkte):`, allData);

    // Zähle die Anzahl der Datenpunkte pro Topic
    const pointsPerTopic = {};
    filteredTopics.forEach(topic => {
      pointsPerTopic[topic] = 0;
    });
    allData.forEach(item => {
      filteredTopics.forEach(topic => {
        if (item[topic] !== null) {
          pointsPerTopic[topic]++;
        }
      });
    });

    console.log('Anzahl der Datenpunkte pro Topic:', pointsPerTopic);

    // Formatiere die Daten für das Frontend
    const formattedData = allData;

    console.log('Formatierte Daten für Frontend:', formattedData);
    if (formattedData.length === 0) {
      console.warn('Keine Daten zurückgegeben von InfluxDB');
    }
    socket.emit('chart-data-update', formattedData);
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log('Client verbunden:', socket.id);

      socket.on('update-pages-and-settings', (data) => {
        this.updatePagesAndSettings(data);
      });

      socket.on('request-logging-settings', () => {
        this.broadcastSettings();
      });

      socket.on('request-chart-data', (params) => {
        console.log('Received request-chart-data with params:', params);
        this.fetchChartData(socket, params);
      });
    });
  }
}

function setupLogging(io, sqliteDB, mqttHandler) {
  const logger = new LoggingHandler(io, sqliteDB, mqttHandler);
  return logger;
}

module.exports = { setupLogging };