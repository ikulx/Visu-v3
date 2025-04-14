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
    this.loggablePages = new Set(); // NEU: Set für logbare Seiten

    // Kein .bind(this) mehr nötig, da Arrow Functions verwendet werden
    this.initialize();
  }

  // --- Methoden als Arrow Functions ---

  initialize = async () => {
    console.log("Initialisiere LoggingHandler...");
    try {
      await this.setupInfluxClient();
      await this.loadAndBroadcastInitialData(); // Geändert: Lädt Settings UND Seiten
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

  // NEU: Extrahiert eindeutige Seiten aus den DB-Ergebnissen
  extractLoggablePages = (settingsRows) => {
      const pages = new Set();
      if (Array.isArray(settingsRows)) {
          settingsRows.forEach(row => {
              // Nur aktivierte Settings mit definiertem Page-String berücksichtigen
              if (row.enabled && row.page && typeof row.page === 'string') {
                  row.page.split(',') // Komma-getrennte Seiten aufteilen
                      .map(p => p.trim().toLowerCase()) // Leerzeichen entfernen, Kleinbuchstaben
                      .filter(p => p !== '') // Leere Einträge filtern
                      .forEach(p => pages.add(p)); // Zur Set hinzufügen (Duplikate automatisch ignoriert)
              }
          });
      }
      this.loggablePages = pages; // Internen State aktualisieren
      console.log(`[LoggingHandler] Loggable pages updated (${this.loggablePages.size}):`, Array.from(this.loggablePages));
      return Array.from(pages); // Array zurückgeben für Broadcast
  }

  // Angepasst: Lädt Settings UND Seiten und broadcastet beides initial und bei Updates
  loadAndBroadcastInitialData = async () => {
    console.log("Lade initiale Logging-Einstellungen und logbare Seiten aus SQLite...");
    try {
      // Hole alle relevanten Daten in einer Abfrage (enabled und page sind wichtig)
      const rows = await runDbQuery(this.sqliteDB, 'SELECT topic, enabled, page, color, description, unit FROM logging_settings ORDER BY topic ASC'); // Holen auch andere Felder für broadcastSettings

      // Aktive Topics setzen (für interne Logik wie MQTT Listener)
      this.activeTopics = new Set(rows.filter(row => !!row.enabled).map(row => row.topic));
      console.log(`Aktive Logging-Topics neu geladen (${this.activeTopics.size}):`, Array.from(this.activeTopics));

      // Logbare Seiten extrahieren und broadcasten
      const pagesArray = this.extractLoggablePages(rows);
      if (this.io) {
           this.io.emit('loggable-pages-update', pagesArray);
           console.log("[LoggingHandler] 'loggable-pages-update' gesendet.");
      }

      // Komplette Settings (für Konfiguration) broadcasten
      const settingsForClient = rows.map(s => ({ ...s, id: s.id ?? null, enabled: !!s.enabled })); // ID und boolean für enabled
      if (this.io) {
          this.io.emit('logging-settings-update', settingsForClient);
          console.log("[LoggingHandler] 'logging-settings-update' gesendet.");
      }

    } catch (err) {
        console.error('Fehler beim Laden der initialen Logging-Daten:', err);
        this.activeTopics = new Set();
        this.loggablePages = new Set();
        // Optional: Leere Listen broadcasten bei Fehler?
        if (this.io) {
            this.io.emit('loggable-pages-update', []);
            this.io.emit('logging-settings-update', []);
        }
    }
  }


  setupMqttListener = () => {
    if (!this.mqttHandler || typeof this.mqttHandler.onMessage !== 'function') {
        console.error("MQTT Handler ist nicht korrekt initialisiert oder onMessage ist keine Funktion.");
        return;
    }
    // Listener registrieren
    this.mqttHandler.onMessage((topic, value) => {
        if (this.activeTopics.has(topic)) {
            this.storeValue(topic, value);
        }
    });
    console.log("MQTT Listener für Logging eingerichtet.");
  }

  storeValue = (topic, value) => {
    const numericValue = parseFloat(value);
    if (isNaN(numericValue)) return; // Nur numerische Werte speichern
    if (!this.valueCache.has(topic)) { this.valueCache.set(topic, []); }
    this.valueCache.get(topic).push(numericValue);
  }

  startMinuteInterval = () => {
    if (this.minuteIntervalId) clearInterval(this.minuteIntervalId);
    console.log("Starte 60-Sekunden-Intervall zum Schreiben der Durchschnittswerte in InfluxDB.");
    this.minuteIntervalId = setInterval(this.writeAveragesToInflux, 60 * 1000);
  }

  writeAveragesToInflux = () => {
    if (!this.influxWriteApi) { /*console.warn("[Logging] InfluxDB Write API nicht verfügbar.");*/ return; }
    if (this.valueCache.size === 0) return;
    const points = []; const writeTimestamp = new Date();
    for (const [topic, values] of this.valueCache.entries()) {
        if (values.length === 0) continue;
        const sum = values.reduce((acc, val) => acc + val, 0);
        const average = sum / values.length;
        const roundedAverage = parseFloat(average.toFixed(1)); // Auf eine Nachkommastelle runden
        if (!isNaN(roundedAverage)) {
            points.push(
                new Point('mqtt_logs') // Measurement Name
                  .tag('topic', topic) // Tag für den Topic
                  .floatField('average', roundedAverage) // Feld für den Durchschnittswert
                  .timestamp(writeTimestamp) // Zeitstempel explizit setzen
            );
        } else {
            console.warn(`[Logging] Ungültiger Durchschnitt für Topic '${topic}'.`);
        }
    }
    if (points.length > 0) {
        // console.log(`[Logging] Schreibe ${points.length} Punkte nach InfluxDB...`); // Weniger verbose
        try {
            this.influxWriteApi.writePoints(points);
            this.influxWriteApi.flush(true)
              // .then(() => console.log(`[Logging] ${points.length} Punkte erfolgreich geschrieben.`)) // Weniger verbose
              .catch(err => { console.error('[Logging] Fehler beim Flush:', err.message || err); if(err.body) console.error("Influx Flush Body:", err.body); });
        } catch (writeError) {
            console.error('[Logging] Fehler beim Schreiben:', writeError.message || writeError); if(writeError.body) console.error("Influx Write Body:", writeError.body);
        }
    }
    this.valueCache.clear(); // Cache nach dem Schreiben leeren
  }

  // Wird vom Frontend aufgerufen (z.B. MenuConfigModal)
  updatePagesAndSettings = async ({ settings }) => {
     if (!Array.isArray(settings)) { console.error("updatePagesAndSettings: Ungültiges Settings-Format."); return; }
     console.log("Aktualisiere Logging-Einstellungen in SQLite...");
     try {
         // DB Update wie bisher...
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

         // NACH erfolgreichem DB-Update: Daten neu laden und ALLES broadcasten
         await this.loadAndBroadcastInitialData(); // Lädt Settings UND Seiten neu und sendet beides
         this.valueCache.clear(); // Cache leeren

     } catch (err) { console.error('Fehler beim Aktualisieren der Logging-Einstellungen:', err); }
  }

  // =====================================================
  // METHODEN für Regelsteuerung (bleiben gleich)
  // =====================================================
  fetchLoggingSettings = async () => {
      console.log("[LoggingHandler] Fetching all logging settings...");
      try {
          // Holen aller relevanten Spalten
          const settings = await runDbQuery(this.sqliteDB, "SELECT id, topic, enabled, color, page, description, unit FROM logging_settings ORDER BY topic ASC");
          return settings.map(s => ({ ...s, enabled: !!s.enabled })); // Konvertiere enabled zu boolean
      } catch (error) { console.error("[LoggingHandler] Error fetching logging settings:", error); return []; }
  }

  // Wird nur noch von loadAndBroadcastInitialData getriggert
  broadcastSettings = async () => {
     if (!this.io) { console.warn("[LoggingHandler - broadcast] io object is missing."); return; }
     try {
         console.log("[LoggingHandler - broadcast] Broadcasting updated logging settings...");
         const settings = await this.fetchLoggingSettings(); // Holt aktuelle Daten
         this.io.emit('logging-settings-update', settings); // Sendet Event
     } catch (error) { console.error("[LoggingHandler - broadcastSettings] Error:", error); }
  }

   /**
    * Aktualisiert eine einzelne Spalte für ein bestimmtes Logging-Topic.
    * Wird von rulesHandler aufgerufen.
    */
  performLoggingSettingUpdate = async (topic, columnToUpdate, newValue, sqliteDB = this.sqliteDB) => {
       const allowedColumns = ['enabled', 'color', 'page', 'description', 'unit'];
       if (!allowedColumns.includes(columnToUpdate)) {
           const errorMsg = `Updating column ${columnToUpdate} is not allowed.`;
           console.error(`[LoggingHandler - Update] ${errorMsg}`);
           throw new Error(errorMsg);
       }
       const valueToSave = (columnToUpdate === 'enabled' && typeof newValue === 'boolean') ? (newValue ? 1 : 0) : newValue;
       console.log(`[LoggingHandler - Update] Updating topic '${topic}', column '${columnToUpdate}' to value '${valueToSave}'`);
       try {
           const result = await runDbQuery( sqliteDB, `UPDATE logging_settings SET "${columnToUpdate}" = ?, updated_at = strftime('%Y-%m-%dT%H:%M','now', 'localtime') WHERE topic = ?`, [valueToSave, topic], 'run');
           console.log(`[LoggingHandler - Update] Update result for topic '${topic}':`, result);
           if (result.changes > 0) {
               // Daten neu laden und ALLES broadcasten (Settings + Seitenliste)
               await this.loadAndBroadcastInitialData();
           }
           return result;
       } catch (error) {
           console.error(`[LoggingHandler - Update] Error updating logging setting for topic '${topic}':`, error);
           throw error;
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
        const metadataSql = ` SELECT ls.topic, ls.page, ${selectLabelField}, ls.unit, ls.color FROM logging_settings ls LEFT JOIN QHMI_VARIABLES qv ON ls.topic = qv.NAME WHERE ls.enabled = 1 AND ls.page IS NOT NULL AND ls.page != '' AND ls.page LIKE ? `; // Sicherstellen, dass page existiert und nicht leer ist
        const allRowsForPage = await runDbQuery(this.sqliteDB, metadataSql, [`%${page}%`]); // Suche mit LIKE, da kommagetrennt
        const relevantRows = allRowsForPage.filter(row => row.page?.split(',').map(p => p.trim().toLowerCase()).includes(requestedPageLower)); // Filtere exakten Match nach Split
        const filteredTopics = relevantRows.map(row => row.topic); const metadataMap = new Map();
        relevantRows.forEach(row => { if (!metadataMap.has(row.topic)) { const u = row.unit; let fu = ''; if (u != null) { const us = String(u).trim(); if (us.toLowerCase() !== 'null' && us !== '') { fu = us; } } metadataMap.set(row.topic, { label: row.display_label || row.topic, unit: fu, color: row.color || '#ffffff' }); } });
        console.log('[Chart] Metadata:', Object.fromEntries(metadataMap));
        if (filteredTopics.length === 0) { console.log('[Chart] Keine Topics für die Seite gefunden.'); socket.emit('chart-data-update', []); return; }
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

      // Sende initiale Settings UND logbare Seiten beim Verbinden an DIESEN Client
      this.fetchLoggingSettings().then(settings => socket.emit('logging-settings-update', settings));
      // Sende aktuelle Liste logbarer Seiten an DIESEN Client
      socket.emit('loggable-pages-update', Array.from(this.loggablePages));

      // Listener für Client-Aktionen
      socket.on('update-pages-and-settings', (data) => { console.log("[LoggingHandler] 'update-pages-and-settings' empfangen."); this.updatePagesAndSettings(data); });
      // Explizite Anfrage für Settings (sendet nur an Anfragenden)
      socket.on('request-logging-settings', () => { console.log(`[LoggingHandler] Client ${socket.id} fordert Settings.`); this.fetchLoggingSettings().then(settings => socket.emit('logging-settings-update', settings)); });
      // Explizite Anfrage für logbare Seiten (sendet nur an Anfragenden)
       socket.on('request-loggable-pages', () => { console.log(`[LoggingHandler] Client ${socket.id} fordert logbare Seiten.`); socket.emit('loggable-pages-update', Array.from(this.loggablePages)); });
      socket.on('request-chart-data', (params) => { const lang = params?.lang || 'de'; console.log(`[LoggingHandler] Client ${socket.id} fordert Chart-Daten (Lang: ${lang}):`, params); this.fetchChartData(socket, params, lang); });
    });
    console.log("Socket Handler für Logging eingerichtet.");
  }
} // Ende der Klasse LoggingHandler

// --- Singleton Instanz und Setup Funktion ---
let loggingHandlerInstance = null;

function setupLogging(io, sqliteDB, mqttHandler) {
  if (!loggingHandlerInstance) {
     loggingHandlerInstance = new LoggingHandler(io, sqliteDB, mqttHandler);
  }
  return loggingHandlerInstance;
}

// --- Export ---
module.exports = {
    setupLogging,
    // Direkter Zugriff auf die Update-Funktion der Instanz (für RulesHandler)
    performLoggingSettingUpdate: async (topic, column, value, db) => {
        if (!loggingHandlerInstance) {
            console.error("LoggingHandler not initialized yet when calling performLoggingSettingUpdate.");
            throw new Error("LoggingHandler not initialized yet.");
        }
        return loggingHandlerInstance.performLoggingSettingUpdate(topic, column, value, db || loggingHandlerInstance.sqliteDB);
    },
};