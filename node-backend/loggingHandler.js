// src/loggingHandler.js
const { InfluxDB, Point } = require('@influxdata/influxdb-client');
const { BucketsAPI, OrgsAPI } = require('@influxdata/influxdb-client-apis');

class LoggingHandler {
  constructor(io, sqliteDB, mqttHandler) {
    this.io = io;
    this.sqliteDB = sqliteDB;
    this.mqttHandler = mqttHandler;
    this.influxUrl = 'http://192.168.10.31:8086'; // Konfigurierbar machen?
    this.influxToken = 'UFwC5hGP8PXiP5qB4fw0TXj3r4_oh4PNpEZISCssdnzmcnw0DnS9sgv76zOWjRSIrtJ5S4AHAhjaXjhr4RP9dw=='; // Sicherer speichern!
    this.influxOrg = 'YgnisAG';
    this.influxBucket = 'Ycontrol-log-v2';
    this.influxDB = null; // Wird in setupInfluxClient initialisiert
    this.queryApi = null; // Wird in setupInfluxClient initialisiert
    this.influxWriteApi = null; // Name geändert für Klarheit
    this.activeTopics = new Set();
    this.valueCache = new Map(); // Cache für Durchschnittsberechnung
    this.minuteIntervalId = null; // ID für das Intervall

    // Starte die Initialisierung
    this.initialize();
  }

  async initialize() {
      console.log("Initialisiere LoggingHandler...");
      try {
          await this.setupInfluxClient();
          await this.loadLoggingSettings(); // Lade Einstellungen NACH InfluxDB-Setup
          this.setupMqttListener();
          this.startMinuteInterval();
          this.setupSocketHandlers();
          console.log("LoggingHandler erfolgreich initialisiert.");
      } catch (err) {
          console.error('FATAL: Fehler beim Initialisieren des LoggingHandlers:', err);
          // Optional: Prozess beenden oder Fehler anders behandeln
          // process.exit(1);
      }
  }


  async setupInfluxClient() {
    console.log(`Verbinde mit InfluxDB unter ${this.influxUrl}...`);
    try {
        this.influxDB = new InfluxDB({
            url: this.influxUrl,
            token: this.influxToken,
        });

        const orgsApi = new OrgsAPI(this.influxDB);
        const bucketsApi = new BucketsAPI(this.influxDB);

        // Überprüfe Organisation
        const orgsResponse = await orgsApi.getOrgs({ org: this.influxOrg });
        const org = orgsResponse.orgs?.find(o => o.name === this.influxOrg);
        if (!org) {
            throw new Error(`InfluxDB Organisation "${this.influxOrg}" nicht gefunden.`);
        }
        const orgID = org.id;
        console.log(`InfluxDB Organisation "${this.influxOrg}" gefunden (ID: ${orgID}).`);

        // Überprüfe oder erstelle Bucket
        let bucketExists = false;
        try {
            const bucketsResponse = await bucketsApi.getBuckets({ orgID, name: this.influxBucket });
            if (bucketsResponse.buckets && bucketsResponse.buckets.length > 0) {
                bucketExists = true;
                console.log(`InfluxDB Bucket "${this.influxBucket}" existiert bereits.`);
            }
        } catch (e) {
             // Fehler (z.B. 404) bedeutet wahrscheinlich, dass das Bucket nicht existiert
            if (e.statusCode === 404 || (e.body && JSON.parse(e.body).message.includes("bucket not found"))) {
                console.log(`InfluxDB Bucket "${this.influxBucket}" nicht gefunden.`);
                bucketExists = false;
            } else {
                throw e; // Anderen Fehler weiterwerfen
            }
        }


        if (!bucketExists) {
            console.log(`Erstelle InfluxDB Bucket "${this.influxBucket}"...`);
            await bucketsApi.postBuckets({
                body: {
                    orgID,
                    name: this.influxBucket,
                    retentionRules: [{ type: 'expire', everySeconds: 0 }], // Unbegrenzte Aufbewahrung (oder anpassen)
                },
            });
            console.log(`InfluxDB Bucket "${this.influxBucket}" erfolgreich erstellt.`);
        }

        // Initialisiere Query und Write API
        this.queryApi = this.influxDB.getQueryApi(this.influxOrg);
        this.influxWriteApi = this.influxDB.getWriteApi(this.influxOrg, this.influxBucket, 'ms'); // Präzision in Millisekunden
        console.log('InfluxDB Query und Write API initialisiert.');

    } catch (err) {
        console.error('Fehler beim Einrichten des InfluxDB-Clients oder Buckets:', err.message || err);
        // Optional: Detailliertere Fehlerinfo ausgeben, falls vorhanden
        if(err.body) console.error("InfluxDB Error Body:", err.body);
        throw err; // Fehler weiterwerfen, um Initialisierung abzubrechen
    }
  }


  async loadLoggingSettings() {
    console.log("Lade aktive Logging-Einstellungen aus SQLite...");
    try {
      const rows = await new Promise((resolve, reject) => {
        this.sqliteDB.all(
          'SELECT topic FROM logging_settings WHERE enabled = 1', // Nur aktivierte Topics laden
          [],
          (err, rows) => (err ? reject(err) : resolve(rows))
        );
      });
      this.activeTopics = new Set(rows.map(row => row.topic));
      console.log(`Aktive Logging-Topics geladen (${this.activeTopics.size}):`, Array.from(this.activeTopics));
    } catch (err) {
      console.error('Fehler beim Laden der Logging-Einstellungen:', err);
      this.activeTopics = new Set(); // Sicherstellen, dass es ein Set ist, auch im Fehlerfall
    }
  }

  setupMqttListener() {
    if (!this.mqttHandler || typeof this.mqttHandler.onMessage !== 'function') {
        console.error("MQTT Handler ist nicht korrekt initialisiert, Listener kann nicht gesetzt werden.");
        return;
    }
    this.mqttHandler.onMessage((topic, value) => {
      if (this.activeTopics.has(topic)) {
        this.storeValue(topic, value);
      }
    });
    console.log("MQTT Listener für Logging eingerichtet.");
  }

  storeValue(topic, value) {
    const numericValue = parseFloat(value);
    if (isNaN(numericValue)) {
      // console.warn(`[Logging] Ungültiger (nicht numerischer) Wert für Topic ${topic}: ${value}`); // Ggf. weniger loggen
      return;
    }
    if (!this.valueCache.has(topic)) {
      this.valueCache.set(topic, []);
    }
    this.valueCache.get(topic).push(numericValue);
    // console.log(`[Logging] Wert für ${topic} gespeichert: ${numericValue}`); // Sehr gesprächig, nur zum Debuggen
  }

  startMinuteInterval() {
    if (this.minuteIntervalId) {
        clearInterval(this.minuteIntervalId); // Bestehendes Intervall löschen
    }
    console.log("Starte 60-Sekunden-Intervall zum Schreiben der Durchschnittswerte in InfluxDB.");
    this.minuteIntervalId = setInterval(() => {
      this.writeAveragesToInflux();
    }, 60 * 1000); // Jede Minute
  }

  writeAveragesToInflux() {
    if (!this.influxWriteApi) {
        console.warn("[Logging] InfluxDB Write API nicht verfügbar. Überspringe Schreibvorgang.");
        return;
    }
    if (this.valueCache.size === 0) return; // Nichts zu schreiben

    const points = [];
    const writeTimestamp = new Date(); // Einheitlicher Zeitstempel für diesen Batch

    console.log("[Logging] Berechne und schreibe Durchschnittswerte...");
    for (const [topic, values] of this.valueCache.entries()) {
      if (values.length === 0) continue;

      const sum = values.reduce((acc, val) => acc + val, 0);
      const average = sum / values.length;
      // Runde auf eine Nachkommastelle, um Genauigkeit zu steuern
      const roundedAverage = parseFloat(average.toFixed(1));

      // Erstelle einen InfluxDB Point
      const point = new Point('mqtt_logs') // Measurement Name
        .tag('topic', topic)                // Tag: MQTT Topic
        .floatField('average', roundedAverage) // Field: Der Durchschnittswert
        .timestamp(writeTimestamp);         // Zeitstempel

      points.push(point);
      // console.log(`[Logging] Mittelwert für ${topic}: ${roundedAverage} (basierend auf ${values.length} Werten)`); // Debugging
    }

    if (points.length > 0) {
      console.log(`[Logging] Schreibe ${points.length} Punkte nach InfluxDB...`);
      this.influxWriteApi.writePoints(points);
      // Flush auslösen, um sicherzustellen, dass Daten gesendet werden
      this.influxWriteApi.flush().then(() => {
          console.log(`[Logging] ${points.length} Punkte erfolgreich nach InfluxDB geschrieben.`);
      }).catch(err => {
        console.error('[Logging] Fehler beim Flush der Punkte nach InfluxDB:', err);
      });
    }

    // Cache für die nächste Minute leeren
    this.valueCache.clear();
  }

  // Funktion zum Aktualisieren der gesamten Logging-Konfiguration (Seiten + Topics)
  async updatePagesAndSettings({ settings }) {
      if (!Array.isArray(settings)) {
           console.error("updatePagesAndSettings: Ungültiges Settings-Format empfangen.");
           return;
      }
      console.log("Aktualisiere Logging-Einstellungen in SQLite...");
      try {
           // Verwende Transaktion für Konsistenz
           await new Promise((resolve, reject) => {
               this.sqliteDB.run('BEGIN TRANSACTION', async (beginErr) => {
                   if (beginErr) return reject(beginErr);
                   try {
                       // Lösche alle alten Einstellungen
                       await new Promise((res, rej) => this.sqliteDB.run('DELETE FROM logging_settings', (err) => err ? rej(err) : res()));

                       // Füge neue Einstellungen ein
                       const insertStmt = this.sqliteDB.prepare(
                           `INSERT INTO logging_settings (topic, enabled, color, page, description, unit, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M','now', 'localtime'))`
                       );
                       for (const setting of settings) {
                            await new Promise((res, rej) => {
                                insertStmt.run(
                                    setting.topic || null,
                                    setting.enabled ? 1 : 0,
                                    setting.color || null,
                                    setting.page || null,
                                    setting.description || null,
                                    setting.unit || null,
                                    (err) => err ? rej(err) : res()
                                );
                            });
                       }
                       await new Promise((res, rej) => insertStmt.finalize(err => err ? rej(err) : res()));

                       // Commit
                       await new Promise((res, rej) => this.sqliteDB.run('COMMIT', (err) => err ? rej(err) : res()));
                       resolve();
                   } catch (processErr) {
                       console.error("Fehler während Logging-Update-Transaktion, Rollback...", processErr);
                       this.sqliteDB.run('ROLLBACK');
                       reject(processErr);
                   }
               });
           });

           console.log("Logging-Einstellungen in SQLite aktualisiert.");

           // Aktive Topics und Cache neu laden/leeren
           await this.loadLoggingSettings();
           this.valueCache.clear(); // Cache leeren, da sich Topics geändert haben könnten

           // Aktualisierte Einstellungen an alle Clients senden
           this.broadcastSettings();

       } catch (err) {
           console.error('Fehler beim Aktualisieren der Logging-Einstellungen in SQLite:', err);
           // Optional: Fehler an Client zurückmelden
       }
  }


  // Sendet die aktuellen Logging-Einstellungen an alle Clients oder einen spezifischen Client
  broadcastSettings() {
    if (!this.io) return; // Sicherstellen, dass io verfügbar ist
    console.log("Sende Logging-Einstellungen an Clients...");
    this.sqliteDB.all(
      'SELECT topic, enabled, color, page, description, unit FROM logging_settings ORDER BY page ASC, topic ASC', // Sortierung hinzufügen
      [],
      (err, rows) => {
        if (err) {
          console.error('Fehler beim Abrufen der Logging-Einstellungen für Broadcast:', err);
          return;
        }
        this.io.emit('logging-settings-update', rows || []); // Leeres Array senden, falls keine Daten
      }
    );
  }

  // Holt Chart-Daten aus InfluxDB für eine bestimmte Seite und Zeitspanne
  // Holt Chart-Daten aus InfluxDB für eine bestimmte Seite und Zeitspanne
  async fetchChartData(socket, { start = '-1h', end = 'now()', page }) {
    console.log('[Chart] Anfrage empfangen:', { start, end, page });
    if (!this.queryApi) {
        console.error("[Chart] Query API nicht initialisiert.");
        socket.emit('chart-data-error', { message: 'InfluxDB nicht bereit.' });
        return;
    }
    // Wandle die angefragte Seite in Kleinbuchstaben um für den Vergleich
    const requestedPageLower = page ? page.toLowerCase() : null;

    if (!requestedPageLower) {
         console.warn("[Chart] Keine Seite für die Abfrage angegeben.");
         socket.emit('chart-data-update', []);
         return;
    }

    try {
        // Hole die Topics, die für die angegebene Seite aktiviert sind (SQL LIKE ist oft case-insensitive)
        const rows = await new Promise((resolve, reject) => {
            this.sqliteDB.all(
                'SELECT topic, page, unit FROM logging_settings WHERE enabled = 1 AND page LIKE ?', // Hole 'page' zum Filtern
                 [`%${page}%`], // Verwende originalen 'page' String für LIKE
                (err, rows) => (err ? reject(err) : resolve(rows || [])) // Stelle sicher, dass immer ein Array zurückgegeben wird
            );
        });

        // *** NEU: Logge die Roh-Ergebnisse der SQL-Abfrage ***
        console.log(`[Chart] SQL query returned ${rows.length} potential rows for LIKE '%${page}%':`, JSON.stringify(rows));

        // Filtere nochmals genau in JavaScript (CASE-INSENSITIVE)
        const relevantRows = rows.filter(row =>
            row.page && typeof row.page === 'string' && // Stelle sicher, dass page ein String ist
            row.page.split(',')                   // Trenne bei Kommas
                .map(p => p.trim().toLowerCase())   // Entferne Leerzeichen und konvertiere zu Kleinbuchstaben
                .includes(requestedPageLower)      // Prüfe, ob die gesuchte Seite (klein) enthalten ist
        );

        const filteredTopics = relevantRows.map(row => row.topic);

        console.log(`[Chart] Relevante Topics für Seite "${page}" (nach JS-Filter):`, filteredTopics);

        if (filteredTopics.length === 0) {
          console.log('[Chart] Keine aktiven Topics für diese Seite nach Filterung gefunden.');
          socket.emit('chart-data-update', []);
          return;
        }

        // Baue den Filter-Teil der Flux-Query dynamisch
        const topicFilter = filteredTopics
          .map(topic => `r.topic == "${topic}"`)
          .join(' or ');

        // Flux-Query (bleibt wie vorher)
        const fluxQuery = `
          from(bucket: "${this.influxBucket}")
            |> range(start: ${start}, stop: ${end})
            |> filter(fn: (r) => r._measurement == "mqtt_logs")
            |> filter(fn: (r) => r._field == "average")
            |> filter(fn: (r) => ${topicFilter})
            |> yield(name: "results")
        `;

        console.log('[Chart] Führe Flux-Query aus:\n', fluxQuery);

        const data = [];
        const results = {};

        // Daten aus InfluxDB abrufen (bleibt wie vorher)
        await new Promise((resolveQuery, rejectQuery) => {
            this.queryApi.queryRows(fluxQuery, {
              next: (row, tableMeta) => { /* ... wie vorher ... */
                 try {
                    const o = tableMeta.toObject(row);
                    const timestamp = new Date(o._time).getTime();
                    const topic = o.topic;
                    const value = o._value;
                    if (!results[timestamp]) results[timestamp] = { time: timestamp };
                    if (results[timestamp][topic] === undefined) {
                        results[timestamp][topic] = value !== null && value !== undefined ? parseFloat(value) : null;
                    }
                 } catch (rowError){ console.error("[Chart] Fehler beim Verarbeiten einer Zeile:", rowError, row); }
              },
              error: (error) => { console.error('[Chart] Fehler bei der Flux-Abfrage:', error); rejectQuery(error); },
              complete: () => { console.log('[Chart] Flux-Abfrage abgeschlossen.'); resolveQuery(); },
            });
        });

        Object.values(results).forEach(entry => data.push(entry));
        data.sort((a, b) => a.time - b.time);

        console.log(`[Chart] Sende ${data.length} Datenpunkte an Client ${socket.id}.`);
        if (data.length === 0) console.warn('[Chart] Keine Daten von InfluxDB für den Zeitraum/Filter zurückgegeben.');

        socket.emit('chart-data-update', data);

    } catch (error) {
        console.error('[Chart] Gesamtfehler beim Abrufen der Chart-Daten:', error);
        socket.emit('chart-data-error', { message: 'Fehler beim Laden der Chart-Daten', error: error.message });
    }
  }

  // Richte Socket.IO-Listener für diesen Handler ein
  setupSocketHandlers() {
    if (!this.io) {
        console.error("Socket.IO Instanz (io) ist nicht verfügbar im LoggingHandler.");
        return;
    }
    this.io.on('connection', (socket) => {
      // console.log('[LoggingHandler] Client verbunden:', socket.id); // Reduziertes Logging

      // Listener zum Aktualisieren von Seiten und Settings
      socket.on('update-pages-and-settings', (data) => {
        console.log("[LoggingHandler] 'update-pages-and-settings' empfangen.");
        this.updatePagesAndSettings(data); // Ruft die aktualisierte Funktion auf
      });

      // Listener zum Anfordern der aktuellen Logging-Settings
      socket.on('request-logging-settings', () => {
        console.log(`[LoggingHandler] Client ${socket.id} fordert Logging-Settings an.`);
        this.broadcastSettings(); // Sendet an alle, Client filtert ggf.
      });

      // Listener zum Anfordern von Chart-Daten
      socket.on('request-chart-data', (params) => {
        console.log(`[LoggingHandler] Client ${socket.id} fordert Chart-Daten an:`, params);
        this.fetchChartData(socket, params);
      });

      // Kein eigener Disconnect-Handler hier nötig, wird in server.js gemacht
    });
    console.log("Socket Handler für Logging eingerichtet.");
  }
}

// Setup-Funktion, die in server.js aufgerufen wird
function setupLogging(io, sqliteDB, mqttHandler) {
  // Erstellt und gibt die Instanz zurück (Initialisierung erfolgt im Konstruktor)
  return new LoggingHandler(io, sqliteDB, mqttHandler);
}

module.exports = { setupLogging }; // Exportiere nur die Setup-Funktion