// src/loggingHandler.js
const { InfluxDB, Point } = require('@influxdata/influxdb-client');
const { BucketsAPI, OrgsAPI } = require('@influxdata/influxdb-client-apis');
const sqlite3 = require('sqlite3'); // Nur für Typ-Annotationen

// Hilfsfunktion zum Ausführen von SQLite-Abfragen als Promise.
function runDbQuery(sqliteDB, sql, params = [], method = 'all') {
    return new Promise((resolve, reject) => {
        if (!['all', 'get', 'run'].includes(method)) return reject(new Error(`Invalid DB method: ${method}`));
        if (method === 'run') {
            sqliteDB.run(sql, params, function (err) { // Benötigt 'function' für 'this'
                if (err) { console.error(`[DB RUN] Error: ${sql}`, params, err); reject(err); }
                else { resolve({ lastID: this.lastID, changes: this.changes }); }
            });
        } else {
            sqliteDB[method](sql, params, (err, result) => {
                if (err) { console.error(`[DB ${method.toUpperCase()}] Error: ${sql}`, params, err); reject(err); }
                else { resolve(result); }
            });
        }
    });
}


class LoggingHandler {
  constructor(io, sqliteDB, mqttHandler) {
    this.io = io;
    this.sqliteDB = sqliteDB;
    this.mqttHandler = mqttHandler;
    this.influxUrl = process.env.INFLUXDB_URL || 'http://192.168.10.31:8086';
    this.influxToken = process.env.INFLUXDB_TOKEN || 'UFwC5hGP8PXiP5qB4fw0TXj3r4_oh4PNpEZISCssdnzmcnw0DnS9sgv76zOWjRSIrtJ5S4AHAhjaXjhr4RP9dw=='; // !! SICHERER SPEICHERN !!
    this.influxOrg = process.env.INFLUXDB_ORG || 'YgnisAG';
    this.influxBucket = process.env.INFLUXDB_BUCKET || 'Ycontrol-log-v2';
    this.influxDB = null;
    this.queryApi = null;
    this.influxWriteApi = null;
    this.activeTopics = new Set();
    this.valueCache = new Map();
    this.minuteIntervalId = null;

    // Kein .bind(this) mehr nötig, da Arrow Functions verwendet werden
    this.initialize();
  }

  // --- Methoden als Arrow Functions ---

  initialize = async () => {
    console.log("Initialisiere LoggingHandler...");
    try {
      await this.setupInfluxClient();
      await this.loadLoggingSettings(); // Lädt initial aktive Topics
      this.setupMqttListener();
      this.startMinuteInterval();
      this.setupSocketHandlers(); // Richtet Listener für Client-Anfragen ein
      console.log("LoggingHandler erfolgreich initialisiert.");
    } catch (err) { console.error('FATAL: Fehler beim Initialisieren des LoggingHandlers:', err); }
  }

  setupInfluxClient = async () => {
    if (!this.influxToken) { console.error("InfluxDB Token nicht konfiguriert."); return; }
    console.log(`Verbinde mit InfluxDB unter ${this.influxUrl}...`);
    try {
         this.influxDB = new InfluxDB({ url: this.influxUrl, token: this.influxToken, timeout: 20000 });
         const orgsApi = new OrgsAPI(this.influxDB); const bucketsApi = new BucketsAPI(this.influxDB);
         console.log(`Prüfe InfluxDB Organisation "${this.influxOrg}"...`);
         const orgsResponse = await orgsApi.getOrgs({ org: this.influxOrg }); const org = orgsResponse.orgs?.find(o => o.name === this.influxOrg);
         if (!org) { console.warn(`InfluxDB Organisation "${this.influxOrg}" nicht gefunden. Logging wird nicht funktionieren.`); return; } const orgID = org.id;
         console.log(`Organisation gefunden (ID: ${orgID}).`); let bucketExists = false;
         try {
             console.log(`Prüfe InfluxDB Bucket "${this.influxBucket}"...`);
             const bucketsResponse = await bucketsApi.getBuckets({ orgID, name: this.influxBucket });
             bucketExists = bucketsResponse.buckets && bucketsResponse.buckets.length > 0;
             if (bucketExists) console.log(`Bucket "${this.influxBucket}" existiert bereits.`); else console.log(`Bucket "${this.influxBucket}" nicht gefunden.`);
         } catch (e) { if (e.statusCode === 404 || (e.body && typeof e.body === 'string' && e.body.includes("bucket not found"))) { console.log(`Bucket nicht gefunden (Fehlerantwort von Influx).`); bucketExists = false; } else { console.error("Fehler beim Prüfen des Buckets:", e); throw e; } }
         if (!bucketExists) { console.log(`Erstelle InfluxDB Bucket "${this.influxBucket}"...`); await bucketsApi.postBuckets({ body: { orgID, name: this.influxBucket, retentionRules: [{ type: 'expire', everySeconds: 0 }] } }); console.log(`Bucket "${this.influxBucket}" erstellt.`); }
         this.queryApi = this.influxDB.getQueryApi(this.influxOrg); this.influxWriteApi = this.influxDB.getWriteApi(this.influxOrg, this.influxBucket, 'ms'); this.influxWriteApi.useDefaultTags({ host: 'visu-backend' }); console.log('InfluxDB APIs initialisiert.');
     } catch (err) {
         console.error('Fehler beim Setup des InfluxDB-Clients:', err.message || err); if(err.body) console.error("InfluxDB Error Body:", err.body);
         this.influxDB = null; this.queryApi = null; this.influxWriteApi = null;
     }
  }

  loadLoggingSettings = async () => {
    console.log("Lade Logging-Einstellungen und aktive Topics aus SQLite...");
    try {
      // Hole topic und enabled Status
      const rows = await runDbQuery(this.sqliteDB, 'SELECT topic, enabled FROM logging_settings');
      // Setze aktive Topics basierend auf enabled = 1 (oder true)
      this.activeTopics = new Set(rows.filter(row => !!row.enabled).map(row => row.topic));
      console.log(`Aktive Logging-Topics neu geladen (${this.activeTopics.size}):`, Array.from(this.activeTopics));
    } catch (err) {
        console.error('Fehler beim Laden der Logging-Einstellungen:', err);
        this.activeTopics = new Set(); // Im Fehlerfall leeren
    }
  }

  setupMqttListener = () => {
    if (!this.mqttHandler || typeof this.mqttHandler.onMessage !== 'function') {
        console.error("MQTT Handler ist nicht korrekt initialisiert oder onMessage ist keine Funktion.");
        return;
    }
    // Listener registrieren (angenommen, onMessage behandelt Mehrfachregistrierung intern oder wird nur einmal aufgerufen)
    this.mqttHandler.onMessage((topic, value) => {
        if (this.activeTopics.has(topic)) {
            this.storeValue(topic, value);
        }
    });
    console.log("MQTT Listener für Logging eingerichtet.");
  }

  storeValue = (topic, value) => {
    const numericValue = parseFloat(value);
    if (isNaN(numericValue)) return;
    if (!this.valueCache.has(topic)) { this.valueCache.set(topic, []); }
    this.valueCache.get(topic).push(numericValue);
  }

  startMinuteInterval = () => {
    if (this.minuteIntervalId) clearInterval(this.minuteIntervalId);
    console.log("Starte 60-Sekunden-Intervall zum Schreiben der Durchschnittswerte in InfluxDB.");
    this.minuteIntervalId = setInterval(this.writeAveragesToInflux, 60 * 1000);
  }

  writeAveragesToInflux = () => {
    if (!this.influxWriteApi) { console.warn("[Logging] InfluxDB Write API nicht verfügbar."); return; }
    if (this.valueCache.size === 0) return;
    const points = []; const writeTimestamp = new Date();
    for (const [topic, values] of this.valueCache.entries()) { if (values.length === 0) continue; const sum = values.reduce((acc, val) => acc + val, 0); const average = sum / values.length; const roundedAverage = parseFloat(average.toFixed(1)); if (!isNaN(roundedAverage)) { points.push( new Point('mqtt_logs').tag('topic', topic).floatField('average', roundedAverage).timestamp(writeTimestamp) ); } else { console.warn(`[Logging] Ungültiger Durchschnitt für Topic '${topic}'.`); } }
    if (points.length > 0) { console.log(`[Logging] Schreibe ${points.length} Punkte nach InfluxDB...`); try { this.influxWriteApi.writePoints(points); this.influxWriteApi.flush(true).then(() => console.log(`[Logging] ${points.length} Punkte erfolgreich geschrieben.`)).catch(err => { console.error('[Logging] Fehler beim Flush:', err.message || err); if(err.body) console.error("Influx Flush Body:", err.body); }); } catch (writeError) { console.error('[Logging] Fehler beim Schreiben:', writeError.message || writeError); if(writeError.body) console.error("Influx Write Body:", writeError.body); } }
    this.valueCache.clear();
  }

  // Wird vom Frontend aufgerufen (z.B. LoggingSettingsModal)
  updatePagesAndSettings = async ({ settings }) => {
     if (!Array.isArray(settings)) { console.error("updatePagesAndSettings: Ungültiges Settings-Format."); return; }
     console.log("Aktualisiere Logging-Einstellungen in SQLite...");
     try {
         await new Promise((resolve, reject) => {
             this.sqliteDB.run('BEGIN TRANSACTION', async (beginErr) => {
                 if (beginErr) return reject(beginErr);
                 try {
                     await runDbQuery(this.sqliteDB, 'DELETE FROM logging_settings', [], 'run');
                     const insertSql = `INSERT INTO logging_settings (topic, enabled, color, page, description, unit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M','now', 'localtime'), strftime('%Y-%m-%dT%H:%M','now', 'localtime'))`;
                     const stmt = this.sqliteDB.prepare(insertSql);
                     for (const setting of settings) { await new Promise((res, rej) => { stmt.run(setting.topic || null, setting.enabled ? 1 : 0, setting.color || null, setting.page || null, setting.description || null, setting.unit || null, (err) => err ? rej(err) : res()); }); }
                     await new Promise((res, rej) => stmt.finalize(err => err ? rej(err) : res()));
                     this.sqliteDB.run('COMMIT', async (commitErr) => { if (commitErr) { console.error("Commit Error:", commitErr); this.sqliteDB.run('ROLLBACK'); reject(commitErr); } else { console.log("[LoggingHandler] Logging settings saved."); resolve(); } });
                 } catch (processErr) { console.error("Fehler Update-Transaktion:", processErr); this.sqliteDB.run('ROLLBACK'); reject(processErr); } }); });
         await this.loadLoggingSettings(); // Aktive Topics neu laden
         this.valueCache.clear(); // Cache leeren
         await this.broadcastSettings(); // Update an Clients senden
     } catch (err) { console.error('Fehler beim Aktualisieren der Logging-Einstellungen:', err); }
  }

  // =====================================================
  // METHODEN für Regelsteuerung (als Arrow Functions)
  // =====================================================
  fetchLoggingSettings = async () => {
      console.log("[LoggingHandler] Fetching all logging settings...");
      try {
          const settings = await runDbQuery(this.sqliteDB, "SELECT id, topic, enabled, color, page, description, unit FROM logging_settings ORDER BY topic ASC");
          return settings.map(s => ({ ...s, enabled: !!s.enabled })); // Konvertiere enabled zu boolean
      } catch (error) { console.error("[LoggingHandler] Error fetching logging settings:", error); return []; }
  }

  broadcastSettings = async () => { // Sendet an ALLE Clients
     if (!this.io) { console.warn("[LoggingHandler - broadcast] io object is missing."); return; }
     try {
         console.log("[LoggingHandler - broadcast] Broadcasting updated logging settings...");
         const settings = await this.fetchLoggingSettings(); // Holt aktuelle Daten
         this.io.emit('logging-settings-update', settings); // Sendet Event
     } catch (error) { console.error("[LoggingHandler - broadcast] Error:", error); }
  }

   /**
    * NEU: Aktualisiert eine einzelne Spalte für ein bestimmtes Logging-Topic.
    * Wird von rulesHandler aufgerufen.
    * @param {string} topic Das zu aktualisierende Topic.
    * @param {'enabled'|'color'|'page'|'description'|'unit'} columnToUpdate Die zu aktualisierende Spalte.
    * @param {any} newValue Der neue Wert für die Spalte.
    * @param {sqlite3.Database} sqliteDB Die DB-Instanz (wird von rulesHandler übergeben).
    * @returns {Promise<{changes: number}>}
    */
  performLoggingSettingUpdate = async (topic, columnToUpdate, newValue, sqliteDB = this.sqliteDB) => {
       const allowedColumns = ['enabled', 'color', 'page', 'description', 'unit'];
       if (!allowedColumns.includes(columnToUpdate)) {
           const errorMsg = `Updating column ${columnToUpdate} is not allowed.`;
           console.error(`[LoggingHandler - Update] ${errorMsg}`);
           throw new Error(errorMsg);
       }

       // Konvertiere boolean zu 0/1 spezifisch für 'enabled'-Spalte
       const valueToSave = (columnToUpdate === 'enabled' && typeof newValue === 'boolean')
                           ? (newValue ? 1 : 0)
                           : newValue; // Andere Werte direkt übernehmen

       console.log(`[LoggingHandler - Update] Updating topic '${topic}', column '${columnToUpdate}' to value '${valueToSave}' (Type: ${typeof valueToSave})`);

       try {
           const result = await runDbQuery(
               sqliteDB, // Explizit die übergebene DB-Instanz verwenden
               `UPDATE logging_settings SET "${columnToUpdate}" = ?, updated_at = strftime('%Y-%m-%dT%H:%M','now', 'localtime') WHERE topic = ?`,
               [valueToSave, topic],
               'run'
           );

           console.log(`[LoggingHandler - Update] Update result for topic '${topic}':`, result);

           // Broadcast nur, wenn sich tatsächlich etwas geändert hat
           if (result.changes > 0) {
               // Broadcast auslösen, um alle Clients zu informieren
               await this.broadcastSettings();
               // Wenn 'enabled' geändert wurde, internen Status aktualisieren
               if (columnToUpdate === 'enabled') {
                    await this.loadLoggingSettings(); // Lädt this.activeTopics neu
               }
           }
           return result;

       } catch (error) {
           console.error(`[LoggingHandler - Update] Error updating logging setting for topic '${topic}':`, error);
           throw error; // Fehler weiterwerfen, damit rulesHandler ihn behandeln kann
       }
   }
  // =====================================================

  fetchChartData = async (socket, { start = '-1h', end = 'now()', page }, lang = 'de') => {
    // Implementierung von fetchChartData wie in deiner Originaldatei
     console.log('[Chart] Anfrage empfangen:', { start, end, page, lang });
     if (!this.queryApi) { console.error("[Chart] Query API nicht initialisiert."); socket.emit('chart-data-error', { message: 'InfluxDB nicht bereit.' }); return; }
     const requestedPageLower = page ? page.toLowerCase() : null;
     if (!requestedPageLower) { console.warn("[Chart] Keine Seite angegeben."); socket.emit('chart-data-update', []); return; }
     try {
        const nameCol = `name_${lang || 'de'}`; const fallbackNameCol = 'name_de'; const baseNameCol = 'name'; const validLangCols = ['name_de', 'name_fr', 'name_en', 'name_it']; const finalNameCol = validLangCols.includes(nameCol) ? nameCol : fallbackNameCol;
        const buildCoalesce = (rq, fb, bs, al) => { const c = [rq]; if (fb && rq !== fb && validLangCols.includes(fb)) c.push(fb); if (!c.includes(bs)) c.push(bs); c.push('ls.topic'); return `COALESCE(${c.map(cl => `NULLIF(TRIM(${cl}), '')`).join(', ')}) AS ${al}`; };
        const selectLabelField = buildCoalesce(finalNameCol, fallbackNameCol, 'qv.NAME', 'display_label');
        const metadataSql = ` SELECT ls.topic, ls.page, ${selectLabelField}, ls.unit, ls.color FROM logging_settings ls LEFT JOIN QHMI_VARIABLES qv ON ls.topic = qv.NAME WHERE ls.enabled = 1 AND ls.page LIKE ? `;
        const allRowsForPage = await runDbQuery(this.sqliteDB, metadataSql, [`%${page}%`]);
        const relevantRows = allRowsForPage.filter(row => row.page?.split(',').map(p => p.trim().toLowerCase()).includes(requestedPageLower));
        const filteredTopics = relevantRows.map(row => row.topic); const metadataMap = new Map();
        relevantRows.forEach(row => { if (!metadataMap.has(row.topic)) { const u = row.unit; let fu = ''; if (u != null) { const us = String(u).trim(); if (us.toLowerCase() !== 'null' && us !== '') { fu = us; } } metadataMap.set(row.topic, { label: row.display_label || row.topic, unit: fu, color: row.color || '#ffffff' }); } });
        console.log('[Chart] Metadata:', Object.fromEntries(metadataMap));
        if (filteredTopics.length === 0) { console.log('[Chart] Keine Topics.'); socket.emit('chart-data-update', []); return; }
        const fluxTopicSet = `[${filteredTopics.map(topic => `"${topic.replace(/"/g, '\\"')}"`).join(', ')}]`; const topicFilterFlux = `contains(value: r.topic, set: ${fluxTopicSet})`; const fluxEndTime = end === 'now()' ? 'now()' : `time(v: "${end}")`;
        const fluxQuery = ` from(bucket: "${this.influxBucket}") |> range(start: ${start}, stop: ${fluxEndTime}) |> filter(fn: (r) => r._measurement == "mqtt_logs") |> filter(fn: (r) => r._field == "average") |> filter(fn: (r) => ${topicFilterFlux}) |> yield(name: "results") `;
        console.log('[Chart] Query:\n', fluxQuery);
        const results = {};
        await new Promise((resolveQuery, rejectQuery) => {
          const queryObserver = { next: (row, tableMeta) => { try { const o=tableMeta.toObject(row); const ts=new Date(o._time).getTime(); const t=o.topic; const v=o._value; if(!results[ts])results[ts]={time:ts,data:{}}; if(metadataMap.has(t)){ const md=metadataMap.get(t); results[ts].data[t]={value:v!=null?parseFloat(v):null,label:md.label,unit:md.unit,color:md.color}; } } catch(e){console.error("Row Error:",e,row);} }, error: (e) => { console.error('[Chart] Query Error:', e.message||e); if(e.body)console.error("Body:",e.body); socket.emit('chart-data-error',{message:`InfluxDB Error: ${e.message||'?'}`}); rejectQuery(e); }, complete: () => { console.log('[Chart] Query Complete.'); resolveQuery(); }, };
          try { if(!this.queryApi){ throw new Error("InfluxDB Query API not available."); } this.queryApi.queryRows(fluxQuery, queryObserver); } catch(e){ console.error('[Chart] Query Start Error:', e); rejectQuery(e); } });
        const finalData = Object.values(results).sort((a, b) => a.time - b.time);
        console.log(`[Chart] Sending ${finalData.length} points.`); socket.emit('chart-data-update', finalData);
     } catch (error) { console.error('[Chart] Fetch Error:', error); socket.emit('chart-data-error', { message: 'Chart Data Load Error', error: error.message || '?' }); }
  }

  // Richtet Socket-Listener für diese Instanz ein
  setupSocketHandlers = () => {
    if (!this.io) { console.error("[LoggingHandler] Socket.IO Instanz (io) ist nicht verfügbar."); return; }
    this.io.on('connection', (socket) => {
      console.log(`[LoggingHandler] Client ${socket.id} connected.`);
      // Sende initiale Settings beim Verbinden
      this.broadcastSettings(); // Sendet an alle, inkl. dem neuen

      // Listener für Client-Aktionen
      socket.on('update-pages-and-settings', (data) => { console.log("[LoggingHandler] 'update-pages-and-settings' empfangen."); this.updatePagesAndSettings(data); });
      socket.on('request-logging-settings', () => { console.log(`[LoggingHandler] Client ${socket.id} fordert Settings.`); this.fetchLoggingSettings().then(settings => socket.emit('logging-settings-update', settings)); }); // Sende nur an anfragenden Client
      socket.on('request-chart-data', (params) => { const lang = params?.lang || 'de'; console.log(`[LoggingHandler] Client ${socket.id} fordert Chart-Daten (Lang: ${lang}):`, params); this.fetchChartData(socket, params, lang); });
    });
    console.log("Socket Handler für Logging eingerichtet.");
  }
}

// --- Singleton Instanz und Setup Funktion ---
let loggingHandlerInstance = null;

/**
 * Erstellt oder gibt die Singleton-Instanz des LoggingHandlers zurück.
 * @param {import('socket.io').Server} io
 * @param {sqlite3.Database} sqliteDB
 * @param {object} mqttHandler
 * @returns {LoggingHandler}
 */
function setupLogging(io, sqliteDB, mqttHandler) {
  if (!loggingHandlerInstance) {
     loggingHandlerInstance = new LoggingHandler(io, sqliteDB, mqttHandler);
  }
  return loggingHandlerInstance;
}

// --- Exportiere die Setup-Funktion UND die neue Update-Funktion ---
module.exports = {
    setupLogging,
    /**
     * Exportierte Funktion, die die Methode der Singleton-Instanz aufruft.
     * Stellt sicher, dass der Handler initialisiert ist.
     * @param {string} topic
     * @param {'enabled'|'color'|'page'|'description'|'unit'} column
     * @param {any} value
     * @param {sqlite3.Database} db
     */
    performLoggingSettingUpdate: async (topic, column, value, db) => {
        if (!loggingHandlerInstance) {
            console.error("LoggingHandler not initialized yet when calling performLoggingSettingUpdate.");
            throw new Error("LoggingHandler not initialized yet.");
        }
        // Rufe die Methode der Singleton-Instanz auf
        // Übergib die DB-Instanz explizit, falls die Instanz-eigene nicht verwendet werden soll
        // Stelle sicher, dass die io-Instanz in der Methode verfügbar ist (ist sie durch `this`)
        return loggingHandlerInstance.performLoggingSettingUpdate(topic, column, value, db || loggingHandlerInstance.sqliteDB);
    },
};