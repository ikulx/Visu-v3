// src/loggingHandler.js
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
          'SELECT topic FROM logging_settings WHERE enabled = 1',
          [],
          (err, rows) => err ? reject(err) : resolve(rows)
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
      console.log('MQTT message received:', { topic, value });
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
    console.log(`Stored value for ${topic}: ${numericValue}`);
  }

  startMinuteInterval() {
    setInterval(() => {
      this.writeAveragesToInflux();
    }, 60 * 1000);
  }

  writeAveragesToInflux() {
    if (this.valueCache.size === 0) {
      console.log('No data in valueCache to write');
      return;
    }

    const points = [];
    for (const [topic, values] of this.valueCache.entries()) {
      if (values.length === 0) continue;

      const average = Number(values.reduce((sum, val) => sum + val, 0) / values.length).toFixed(1); // Eine Nachkommastelle
      const point = new Point('mqtt_logs')
        .tag('topic', topic)
        .floatField('average', parseFloat(average)) // Als Float speichern
        .timestamp(new Date());

      points.push(point);
      console.log(`Mittelwert für ${topic}: ${average} (basierend auf ${values.length} Werten)`);
    }

    if (points.length > 0) {
      this.influxClient.writePoints(points);
      this.influxClient.flush().then(() => {
        console.log('Data written to InfluxDB:', points.map(p => p.toString()));
      }).catch(err => {
        console.error('Fehler beim Schreiben der Mittelwerte in InfluxDB:', err);
      });
    }

    this.valueCache.clear();
  }

  async updateLoggingSettings(topic, enabled) {
    try {
      await new Promise((resolve, reject) => {
        this.sqliteDB.run(
          `INSERT OR REPLACE INTO logging_settings (topic, enabled, updated_at) 
           VALUES (?, ?, strftime('%Y-%m-%dT%H:%M','now', 'localtime'))`,
          [topic, enabled ? 1 : 0],
          (err) => err ? reject(err) : resolve()
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
      'SELECT topic, enabled, description FROM logging_settings',
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

  async fetchChartData(socket) {
    console.log('fetchChartData: Starting data fetch');
    try {
      const topicFilter = Array.from(this.activeTopics)
        .map(topic => `r.topic == "${topic}"`)
        .join(' or ');
      const fluxQuery = `
        from(bucket: "dev-bucket")
          |> range(start: -1h)
          |> filter(fn: (r) => r._measurement == "mqtt_logs")
          |> filter(fn: (r) => r._field == "average")
          ${topicFilter ? `|> filter(fn: (r) => ${topicFilter})` : ''}
          |> pivot(rowKey: ["_time"], columnKey: ["topic"], valueColumn: "_value")
      `;
      console.log('fetchChartData: Executing Flux query:', fluxQuery);

      const data = [];
      await this.queryApi.collectRows(fluxQuery, (row, tableMeta) => {
        console.log('Raw row from InfluxDB:', row);
        const timestamp = new Date(tableMeta.get(row, '_time')).getTime();
        const entry = { time: timestamp };
        this.activeTopics.forEach(topic => {
          const value = tableMeta.get(row, topic);
          if (value !== undefined && value !== null) {
            entry[topic] = parseFloat(value);
          }
        });
        if (Object.keys(entry).length > 1) {
          data.push(entry);
        }
      });

      console.log('fetchChartData: Processed data:', data);
      if (data.length === 0) {
        console.warn('fetchChartData: No data returned from InfluxDB');
      }
      socket.emit('chart-data-update', data);
    } catch (error) {
      console.error('fetchChartData: Error fetching chart data:', error);
      socket.emit('chart-data-error', { message: 'Fehler beim Laden der Daten', error: error.message });
    }
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log('Client connected:', socket.id);
      socket.on('update-logging-setting', ({ topic, enabled }) => {
        this.updateLoggingSettings(topic, enabled);
      });

      socket.on('request-logging-settings', () => {
        this.broadcastSettings();
      });

      socket.on('request-chart-data', () => {
        console.log('Received request-chart-data from client:', socket.id, 'at', new Date().toISOString());
        this.fetchChartData(socket);
      });
    });
  }
}

function setupLogging(io, sqliteDB, mqttHandler) {
  const logger = new LoggingHandler(io, sqliteDB, mqttHandler);
  return logger;
}

module.exports = { setupLogging };