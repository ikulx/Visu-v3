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
      // Runde den Durchschnitt auf eine Nachkommastelle
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

  async updateLoggingSettings(topic, enabled, color, page, description, unit) {
    try {
      await new Promise((resolve, reject) => {
        this.sqliteDB.run(
          `INSERT OR REPLACE INTO logging_settings (topic, enabled, color, page, description, unit, updated_at) 
           VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M','now', 'localtime'))`,
          [topic, enabled ? 1 : 0, color, page, description, unit],
          (err) => (err ? reject(err) : resolve())
        );
      });

      if (enabled) {
        this.activeTopics.add(topic);
      } else {
        this.activeTopics.delete(topic);
        this.valueCache.delete(topic);
      }

      this.broadcastSettings();
    } catch (err) {
      console.error('Fehler beim Aktualisieren der Logging-Einstellungen:', err);
    }
  }

  broadcastSettings() {
    this.sqliteDB.all(
      'SELECT topic, enabled, color, page, description, unit FROM logging_settings',
      [],
      (err, rows) => {
        if (err) {
          console.error('Fehler beim Abrufen der Logging-Einstellungen:', err);
          return;
        }
        this.io.emit('logging-settings-update', rows);
      }
    );
  }

  async fetchChartData(socket, { start, end, maxPoints, page }) {
    console.log('Erhaltene Parameter:', { start, end, maxPoints, page });
    console.log('Aktive Topics:', this.activeTopics);

    if (!start || !end) {
      socket.emit('chart-data-error', { message: 'Start- oder Enddatum fehlt' });
      return;
    }
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      socket.emit('chart-data-error', { message: 'Ungültige Datumsangaben' });
      return;
    }
    if (!maxPoints || maxPoints <= 0 || isNaN(maxPoints)) {
      socket.emit('chart-data-error', { message: 'Ungültige maxPoints' });
      return;
    }

    const durationMs = endDate - startDate;
    if (durationMs <= 0) {
      socket.emit('chart-data-error', { message: 'Enddatum muss nach Startdatum liegen' });
      return;
    }

    const intervalMs = Math.max(1, Math.floor(durationMs / maxPoints));
    console.log('Berechnetes Intervall:', intervalMs);

    // Topics basierend auf der Seite filtern
    const rows = await new Promise((resolve, reject) => {
      this.sqliteDB.all(
        'SELECT topic, page FROM logging_settings WHERE enabled = 1',
        [],
        (err, rows) => (err ? reject(err) : resolve(rows))
      );
    });

    console.log('Alle aktiven Logging-Einstellungen:', rows);
    console.log('Vergleiche mit page:', page);

    const filteredTopics = rows
      .filter(row => {
        if (!row.page) {
          console.log(`Topic ${row.topic} hat keine Seiten definiert`);
          return false;
        }
        const pages = row.page.split(',').map(p => p.trim());
        const isMatch = pages.includes(page);
        console.log(`Topic ${row.topic} Seiten: ${row.page}, Match mit ${page}: ${isMatch}`);
        return isMatch;
      })
      .map(row => row.topic);

    console.log('Gefilterte Topics:', filteredTopics);

    if (filteredTopics.length === 0) {
      console.log('Keine passenden Topics gefunden, sende leeres Array');
      socket.emit('chart-data-update', []);
      return;
    }

    const topicFilter = filteredTopics
      .filter(topic => topic)
      .map(topic => `r.topic == "${topic}"`)
      .join(' or ');

    const fluxQuery = `
      from(bucket: "dev-bucket")
        |> range(start: ${start}, stop: ${end})
        |> filter(fn: (r) => r._measurement == "mqtt_logs")
        |> filter(fn: (r) => r._field == "average")
        ${topicFilter ? `|> filter(fn: (r) => ${topicFilter})` : ''}
        |> aggregateWindow(every: ${intervalMs}ms, fn: mean, createEmpty: false)
        |> pivot(rowKey: ["_time"], columnKey: ["topic"], valueColumn: "_value")
        |> sort(columns: ["_time"])
    `;
    console.log('Flux-Abfrage:', fluxQuery);

    try {
      const data = [];
      await this.queryApi.collectRows(fluxQuery, (row, tableMeta) => {
        const timestamp = new Date(tableMeta.get(row, '_time')).getTime();
        const entry = { time: timestamp };
        filteredTopics.forEach(topic => {
          const value = tableMeta.get(row, topic);
          if (value !== undefined && value !== null) {
            entry[topic] = parseFloat(value);
          } else {
            entry[topic] = null;
          }
        });
        data.push(entry);
      });

      console.log('Daten abgerufen:', data);
      socket.emit('chart-data-update', data);
    } catch (error) {
      console.error('Fehler beim Abrufen der Chart-Daten:', error);
      socket.emit('chart-data-error', { message: 'Fehler beim Laden der Daten', error: error.message });
    }
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log('Client verbunden:', socket.id);

      socket.on('update-logging-setting', ({ topic, enabled, color, page, description, unit }) => {
        this.updateLoggingSettings(topic, enabled, color, page, description, unit);
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