// src/loggingHandler.js
const { InfluxDB, Point } = require('@influxdata/influxdb-client');

class LoggingHandler {
  constructor(io, sqliteDB, mqttHandler) {
    this.io = io;
    this.sqliteDB = sqliteDB;
    this.mqttHandler = mqttHandler;
    this.influxClient = this.setupInfluxClient();
    this.activeTopics = new Set();
    this.valueCache = new Map(); // Zwischenspeicher für Werte pro Topic
    this.loadLoggingSettings();
    this.setupMqttListener();
    this.startMinuteInterval();
  }

  setupInfluxClient() {
    const influxDB = new InfluxDB({
      url: 'http://192.168.10.31:8086', // Ihre InfluxDB-URL
      token: 'VB4OadT3sVDTkKApno6dZaKbmZhNdBzHn93YDyH41fXRNVHuw49-R1sFL0IYrP6ysoPQAq3QNFVt165MqbjsAg==' // Ihr InfluxDB-Token
    });
    return influxDB.getWriteApi('YgnisAG', 'dev-bucket', 'ms');
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
    }, 60 * 1000); // Jede Minute (60 Sekunden)
  }

  writeAveragesToInflux() {
    if (this.valueCache.size === 0) {
      return; // Keine Daten zum Schreiben
    }

    const points = [];
    for (const [topic, values] of this.valueCache.entries()) {
      if (values.length === 0) continue;

      const average = values.reduce((sum, val) => sum + val, 0) / values.length;
      const point = new Point('mqtt_logs')
        .tag('topic', topic)
        .floatField('average', average)
        .timestamp(new Date());

      points.push(point);
      console.log(`Mittelwert für ${topic}: ${average} (basierend auf ${values.length} Werten)`);
    }

    if (points.length > 0) {
      this.influxClient.writePoints(points);
      this.influxClient.flush().catch(err => {
        console.error('Fehler beim Schreiben der Mittelwerte in InfluxDB:', err);
      });
    }

    // Zwischenspeicher zurücksetzen
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
        this.valueCache.delete(topic); // Zwischenspeicher für deaktivierte Topics löschen
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

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      socket.on('update-logging-setting', ({ topic, enabled }) => {
        this.updateLoggingSettings(topic, enabled);
      });

      socket.on('request-logging-settings', () => {
        this.broadcastSettings();
      });
    });
  }
}

function setupLogging(io, sqliteDB, mqttHandler) {
  const logger = new LoggingHandler(io, sqliteDB, mqttHandler);
  logger.setupSocketHandlers();
  return logger;
}

module.exports = { setupLogging };