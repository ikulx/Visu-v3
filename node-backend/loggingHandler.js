// src/loggingHandler.js
const { InfluxDB, Point } = require('@influxdata/influxdb-client');
const { BucketsAPI, OrgsAPI } = require('@influxdata/influxdb-client-apis');

class LoggingHandler {
  constructor(io, sqliteDB, mqttHandler) {
    this.io = io;
    this.sqliteDB = sqliteDB;
    this.mqttHandler = mqttHandler;
    this.influxUrl = process.env.INFLUXDB_URL || 'http://192.168.10.31:8086';
    this.influxToken = process.env.INFLUXDB_TOKEN || 'UFwC5hGP8PXiP5qB4fw0TXj3r4_oh4PNpEZISCssdnzmcnw0DnS9sgv76zOWjRSIrtJ5S4AHAhjaXjhr4RP9dw=='; // !! SICHERER SPEICHERN !!
    this.influxOrg = process.env.INFLUXDB_ORG || 'YgnisAG';
    this.influxBucket = process.env.INFLUXDB_BUCKET || 'Ycontrol-log-v2';
    this.influxDB = null; this.queryApi = null; this.influxWriteApi = null;
    this.activeTopics = new Set(); this.valueCache = new Map(); this.minuteIntervalId = null;
    this.initialize();
  }

  async initialize() {
    console.log("Initialisiere LoggingHandler...");
    try {
      await this.setupInfluxClient(); await this.loadLoggingSettings();
      this.setupMqttListener(); this.startMinuteInterval(); this.setupSocketHandlers();
      console.log("LoggingHandler erfolgreich initialisiert.");
    } catch (err) { console.error('FATAL: Fehler beim Initialisieren des LoggingHandlers:', err); }
  }

  async setupInfluxClient() {
    if (!this.influxToken) throw new Error("InfluxDB Token nicht konfiguriert.");
    console.log(`Verbinde mit InfluxDB unter ${this.influxUrl}...`);
    try {
      this.influxDB = new InfluxDB({ url: this.influxUrl, token: this.influxToken, timeout: 20000 });
      const orgsApi = new OrgsAPI(this.influxDB); const bucketsApi = new BucketsAPI(this.influxDB);
      console.log(`Prüfe InfluxDB Organisation "${this.influxOrg}"...`);
      const orgsResponse = await orgsApi.getOrgs({ org: this.influxOrg }); const org = orgsResponse.orgs?.find(o => o.name === this.influxOrg);
      if (!org) throw new Error(`InfluxDB Organisation "${this.influxOrg}" nicht gefunden.`); const orgID = org.id;
      console.log(`Organisation gefunden (ID: ${orgID}).`); let bucketExists = false;
      try {
        console.log(`Prüfe InfluxDB Bucket "${this.influxBucket}"...`);
        const bucketsResponse = await bucketsApi.getBuckets({ orgID, name: this.influxBucket });
        bucketExists = bucketsResponse.buckets && bucketsResponse.buckets.length > 0;
        if (bucketExists) console.log(`Bucket existiert bereits.`); else console.log(`Bucket nicht gefunden.`);
      } catch (e) { if (e.statusCode === 404 || (e.body && typeof e.body === 'string' && e.body.includes("bucket not found"))) { console.log(`Bucket nicht gefunden (Fehler).`); bucketExists = false; } else { console.error("Fehler beim Prüfen des Buckets:", e); throw e; } }
      if (!bucketExists) { console.log(`Erstelle InfluxDB Bucket "${this.influxBucket}"...`); await bucketsApi.postBuckets({ body: { orgID, name: this.influxBucket, retentionRules: [{ type: 'expire', everySeconds: 0 }] } }); console.log(`Bucket erstellt.`); }
      this.queryApi = this.influxDB.getQueryApi(this.influxOrg); this.influxWriteApi = this.influxDB.getWriteApi(this.influxOrg, this.influxBucket, 'ms'); this.influxWriteApi.useDefaultTags({ host: 'visu-backend' }); console.log('InfluxDB APIs initialisiert.');
    } catch (err) { console.error('Fehler beim Setup des InfluxDB-Clients:', err.message || err); if(err.body) console.error("InfluxDB Error Body:", err.body); this.influxDB = null; this.queryApi = null; this.influxWriteApi = null; throw err; }
  }

  async loadLoggingSettings() { /* ... unverändert ... */
    console.log("Lade aktive Logging-Einstellungen aus SQLite...");
    try {
      const rows = await new Promise((resolve, reject) => { this.sqliteDB.all('SELECT topic FROM logging_settings WHERE enabled = 1', [], (err, rows) => (err ? reject(err) : resolve(rows))); });
      this.activeTopics = new Set(rows.map(row => row.topic)); console.log(`Aktive Logging-Topics geladen (${this.activeTopics.size}):`, Array.from(this.activeTopics));
    } catch (err) { console.error('Fehler beim Laden der Logging-Einstellungen:', err); this.activeTopics = new Set(); }
  }
  setupMqttListener() { /* ... unverändert ... */
    if (!this.mqttHandler || typeof this.mqttHandler.onMessage !== 'function') { console.error("MQTT Handler ist nicht korrekt initialisiert."); return; }
    this.mqttHandler.onMessage((topic, value) => { if (this.activeTopics.has(topic)) { this.storeValue(topic, value); } }); console.log("MQTT Listener für Logging eingerichtet.");
  }
  storeValue(topic, value) { /* ... unverändert ... */
    const numericValue = parseFloat(value); if (isNaN(numericValue)) return; if (!this.valueCache.has(topic)) this.valueCache.set(topic, []); this.valueCache.get(topic).push(numericValue);
  }
  startMinuteInterval() { /* ... unverändert ... */
    if (this.minuteIntervalId) clearInterval(this.minuteIntervalId); console.log("Starte 60-Sekunden-Intervall zum Schreiben der Durchschnittswerte in InfluxDB."); this.minuteIntervalId = setInterval(() => this.writeAveragesToInflux(), 60 * 1000);
  }
  writeAveragesToInflux() { /* ... unverändert ... */
    if (!this.influxWriteApi) { console.warn("[Logging] InfluxDB Write API nicht verfügbar."); return; } if (this.valueCache.size === 0) return; const points = []; const writeTimestamp = new Date();
    for (const [topic, values] of this.valueCache.entries()) { if (values.length === 0) continue; const sum = values.reduce((acc, val) => acc + val, 0); const average = sum / values.length; const roundedAverage = parseFloat(average.toFixed(1)); points.push(new Point('mqtt_logs').tag('topic', topic).floatField('average', roundedAverage).timestamp(writeTimestamp)); }
    if (points.length > 0) { console.log(`[Logging] Schreibe ${points.length} Punkte nach InfluxDB...`); try { this.influxWriteApi.writePoints(points); this.influxWriteApi.flush().then(() => console.log(`[Logging] ${points.length} Punkte erfolgreich geschrieben.`)).catch(err => { console.error('[Logging] Fehler beim Flush nach InfluxDB:', err.message || err); if(err.body) console.error("InfluxDB Flush Error Body:", err.body); }); } catch (writeError) { console.error('[Logging] Kritischer Fehler beim Schreiben nach InfluxDB:', writeError.message || writeError); if(writeError.body) console.error("InfluxDB Write Error Body:", writeError.body); } } this.valueCache.clear();
  }
  async updatePagesAndSettings({ settings }) { /* ... unverändert ... */
     if (!Array.isArray(settings)) { console.error("updatePagesAndSettings: Ungültiges Settings-Format."); return; } console.log("Aktualisiere Logging-Einstellungen in SQLite..."); try { await new Promise((resolve, reject) => { this.sqliteDB.run('BEGIN TRANSACTION', async (beginErr) => { if (beginErr) return reject(beginErr); try { await new Promise((res, rej) => this.sqliteDB.run('DELETE FROM logging_settings', (err) => err ? rej(err) : res())); const insertStmt = this.sqliteDB.prepare(`INSERT INTO logging_settings (topic, enabled, color, page, description, unit, updated_at) VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M','now', 'localtime'))`); for (const setting of settings) { await new Promise((res, rej) => { insertStmt.run(setting.topic || null, setting.enabled ? 1 : 0, setting.color || null, setting.page || null, setting.description || null, setting.unit || null, (err) => err ? rej(err) : res()); }); } await new Promise((res, rej) => insertStmt.finalize(err => err ? rej(err) : res())); await new Promise((res, rej) => this.sqliteDB.run('COMMIT', (err) => err ? rej(err) : res())); resolve(); } catch (processErr) { console.error("Fehler während Logging-Update-Transaktion, Rollback...", processErr); this.sqliteDB.run('ROLLBACK'); reject(processErr); } }); }); console.log("Logging-Einstellungen in SQLite aktualisiert."); await this.loadLoggingSettings(); this.valueCache.clear(); this.broadcastSettings(); } catch (err) { console.error('Fehler beim Aktualisieren der Logging-Einstellungen in SQLite:', err); }
  }
  broadcastSettings() { /* ... unverändert ... */
     if (!this.io) return; console.log("Sende Logging-Einstellungen an Clients..."); this.sqliteDB.all('SELECT topic, enabled, color, page, description, unit FROM logging_settings ORDER BY page ASC, topic ASC', [], (err, rows) => { if (err) { console.error('Fehler beim Abrufen der Logging-Einstellungen:', err); return; } this.io.emit('logging-settings-update', rows || []); });
  }

  async fetchChartData(socket, { start = '-1h', end = 'now()', page }, lang = 'de') {
    console.log('[Chart] Anfrage empfangen:', { start, end, page, lang });
    if (!this.queryApi) { /* ... Fehlerbehandlung ... */ console.error("[Chart] Query API nicht initialisiert."); socket.emit('chart-data-error', { message: 'InfluxDB nicht bereit.' }); return; }
    const requestedPageLower = page ? page.toLowerCase() : null;
    if (!requestedPageLower) { /* ... Fehlerbehandlung ... */ console.warn("[Chart] Keine Seite für die Abfrage angegeben."); socket.emit('chart-data-update', []); return; }

    try {
      // 1. Metadaten holen
      const nameCol = `name_${lang || 'de'}`;
      const fallbackNameCol = 'name_de';
      const baseNameCol = 'name';
      const validLangCols = ['name_de', 'name_fr', 'name_en', 'name_it'];
      const finalNameCol = validLangCols.includes(nameCol) ? nameCol : fallbackNameCol;
      const buildCoalesce = (requestedCol, fallbackCol, baseCol, alias) => { /* ... */ const columnsInOrder = [requestedCol]; if (fallbackCol && requestedCol !== fallbackCol && validLangCols.includes(fallbackCol)) { columnsInOrder.push(fallbackCol); } if (!columnsInOrder.includes(baseCol)) { columnsInOrder.push(baseCol); } columnsInOrder.push('ls.topic'); return `COALESCE(${columnsInOrder.map(col => `NULLIF(TRIM(${col}), '')`).join(', ')}) AS ${alias}`; };
      const selectLabelField = buildCoalesce(finalNameCol, fallbackNameCol, 'qv.NAME', 'display_label');

       const metadataSql = `
          SELECT
              ls.topic,
              ls.page,
              ${selectLabelField},
              ls.unit, -- Hole Einheit NUR aus logging_settings
              ls.color
          FROM logging_settings ls
          LEFT JOIN QHMI_VARIABLES qv ON ls.topic = qv.NAME
          WHERE ls.enabled = 1 AND ls.page LIKE ?
      `;

      const allRowsForPage = await new Promise((resolve, reject) => { /* ... */ this.sqliteDB.all(metadataSql, [`%${page}%`], (err, rows) => { if (err) { console.error("[Chart] Fehler beim Abrufen der Metadaten:", err); reject(err); } else { resolve(rows || []); } }); });
      const relevantRows = allRowsForPage.filter(row => row.page && typeof row.page === 'string' && row.page.split(',').map(p => p.trim().toLowerCase()).includes(requestedPageLower) );
      const filteredTopics = relevantRows.map(row => row.topic);
      const metadataMap = new Map();
      relevantRows.forEach(row => {
        if (!metadataMap.has(row.topic)) {
          const unitFromDb = row.unit; let finalUnit = '';
          if (unitFromDb !== null && unitFromDb !== undefined) { const unitString = String(unitFromDb).trim(); if (unitString.toLowerCase() !== 'null' && unitString !== '') { finalUnit = unitString; } }
          metadataMap.set(row.topic, { label: row.display_label || row.topic, unit: finalUnit, color: row.color || '#ffffff' });
        }
      });
      console.log('[Chart] Metadata Map Content (Unit only from logging_settings):', Object.fromEntries(metadataMap));

      if (filteredTopics.length === 0) { console.log('[Chart] Keine aktiven Topics.'); socket.emit('chart-data-update', []); return; }

      // 2. InfluxDB-Abfrage mit 'contains' Filter
      // Escape double quotes within topic names for the Flux array string
      const fluxTopicSet = `[${filteredTopics.map(topic => `"${topic.replace(/"/g, '\\"')}"`).join(', ')}]`;
      const topicFilterFlux = `contains(value: r.topic, set: ${fluxTopicSet})`;
      const fluxEndTime = end === 'now()' ? 'now()' : `time(v: "${end}")`;

      const fluxQuery = `
        from(bucket: "${this.influxBucket}")
          |> range(start: ${start}, stop: ${fluxEndTime})
          |> filter(fn: (r) => r._measurement == "mqtt_logs")
          |> filter(fn: (r) => r._field == "average")
          |> filter(fn: (r) => ${topicFilterFlux}) // <-- Geänderter Filter
          |> yield(name: "results")
      `;
      console.log('[Chart] Führe Flux-Query aus (mit contains):\n', fluxQuery);

      // 3. Daten holen und anreichern
      const results = {};
      await new Promise((resolveQuery, rejectQuery) => {
        const queryObserver = {
          next: (row, tableMeta) => {
            try {
              const o = tableMeta.toObject(row); const timestamp = new Date(o._time).getTime(); const topic = o.topic; const value = o._value;
              if (!results[timestamp]) results[timestamp] = { time: timestamp, data: {} };
              if (metadataMap.has(topic)) {
                   const metadata = metadataMap.get(topic);
                   results[timestamp].data[topic] = { value: value !== null && value !== undefined ? parseFloat(value) : null, label: metadata.label, unit: metadata.unit, color: metadata.color };
              }
            } catch (rowError) { console.error("[Chart] Fehler beim Verarbeiten einer InfluxDB-Zeile:", rowError, row); }
          },
          error: (error) => { console.error('[Chart] Fehler bei der Flux-Abfrage:', error.message || error); if(error.body) console.error("InfluxDB Query Error Body:", error.body); socket.emit('chart-data-error', { message: `InfluxDB Abfragefehler: ${error.message || 'Unbekannt'}` }); rejectQuery(error); },
          complete: () => { console.log('[Chart] Flux-Abfrage abgeschlossen.'); resolveQuery(); },
        };
        try { this.queryApi.queryRows(fluxQuery, queryObserver); }
        catch(queryError) { console.error('[Chart] Kritischer Fehler beim Starten der Flux-Abfrage:', queryError); rejectQuery(queryError); }
      });

      const finalData = Object.values(results).sort((a, b) => a.time - b.time);
      console.log(`[Chart] Sende ${finalData.length} Datenpunkte (mit Metadaten) an Client ${socket.id}.`);
      socket.emit('chart-data-update', finalData);

    } catch (error) {
      console.error('[Chart] Gesamtfehler beim Abrufen der Chart-Daten:', error);
      socket.emit('chart-data-error', { message: 'Fehler beim Laden der Chart-Daten', error: error.message || 'Unbekannter Fehler' });
    }
  }

  // setupSocketHandlers bleibt gleich
  setupSocketHandlers() {
    if (!this.io) { console.error("Socket.IO Instanz (io) ist nicht verfügbar."); return; }
    this.io.on('connection', (socket) => {
      socket.on('update-pages-and-settings', (data) => { console.log("[LoggingHandler] 'update-pages-and-settings' empfangen."); this.updatePagesAndSettings(data); });
      socket.on('request-logging-settings', () => { console.log(`[LoggingHandler] Client ${socket.id} fordert Settings.`); this.broadcastSettings(); });
      socket.on('request-chart-data', (params) => {
        const lang = params && params.lang ? params.lang : 'de';
        console.log(`[LoggingHandler] Client ${socket.id} fordert Chart-Daten (Sprache: ${lang}):`, params);
        this.fetchChartData(socket, params, lang);
      });
    });
    console.log("Socket Handler für Logging eingerichtet.");
  }
}

function setupLogging(io, sqliteDB, mqttHandler) {
  return new LoggingHandler(io, sqliteDB, mqttHandler);
}

module.exports = { setupLogging };