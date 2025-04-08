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
    this.connectedClients = new Map();
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

    // Topics aus der SQLite-Datenbank abrufen
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

    // Flux-Abfrage für zeitlich synchronisierte Daten
    const topicFilter = filteredTopics
      .map(topic => `r.topic == "${topic}"`)
      .join(' or ');

    const fluxQuery = `
      from(bucket: "dev-bucket")
        |> range(start: ${start}, stop: ${end})
        |> filter(fn: (r) => r._measurement == "mqtt_logs")
        |> filter(fn: (r) => r._field == "average")
        ${topicFilter ? `|> filter(fn: (r) => ${topicFilter})` : ''}
        |> window(every: 1m)
        |> mean()
        |> duplicate(column: "_stop", as: "_time")
        |> window(every: inf)
        |> sort(columns: ["_time"], desc: true)
        |> limit(n: ${maxPoints})
        |> pivot(rowKey: ["_time"], columnKey: ["topic"], valueColumn: "_value")
    `;

    console.log('Flux-Abfrage:', fluxQuery);

    try {
      const data = [];
      await this.queryApi.collectRows(fluxQuery, (row, tableMeta) => {
        const timestamp = new Date(tableMeta.get(row, '_time')).getTime();
        const entry = { time: timestamp };
        filteredTopics.forEach(topic => {
          const value = tableMeta.get(row, topic);
          entry[topic] = value !== undefined && value !== null ? parseFloat(value) : null;
        });
        if (Object.keys(entry).length > 1) {
          data.push(entry);
        }
      });

      // Sortiere die Daten aufsteigend nach Zeitstempel für das Frontend
      data.sort((a, b) => a.time - b.time);

      // console.log('Abgerufene Daten:', data);
      if (data.length === 0) {
        console.warn('Keine Daten zurückgegeben von InfluxDB');
      }
      socket.emit('chart-data-update', data);
    } catch (error) {
      console.error('Fehler bei der Abfrage:', error);
      socket.emit('chart-data-error', { message: 'Fehler beim Laden der Daten', error: error.message });
    }
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

      socket.on('disconnect', () => {
        console.log('Client getrennt:', socket.id);
        this.connectedClients.delete(socket.id);
      });
    });
  }
}

function setupLogging(io, sqliteDB, mqttHandler) {
  const logger = new LoggingHandler(io, sqliteDB, mqttHandler);
  return logger;
}

module.exports = { setupLogging };