// src/server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// --- Imports ---
const dbRoutes = require('./dbRoutes'); // Importiere den Router
// Importiere spezifische Funktionen, die direkt in server.js benötigt werden
const { performVariableUpdate, broadcastSettings } = require('./dbRoutes');
const { setupLogging } = require('./loggingHandler');
const { setupMqtt, updateCachedMenuData, checkAndSendMqttUpdates } = require('./mqttHandler');
const {
  fetchMenuForFrontend,
  setupMenuHandlers,
  defaultMenu,
  insertMenuItems,
  fetchMenuRawFromDB
} = require('./menuHandler');
const { setupRulesHandlers, evaluateRules } = require('./rulesHandler');
const { setupAlarmHandler } = require('./alarmHandler');

const app = express();
const server = http.createServer(app);

// Socket.IO Setup
const io = socketIo(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});
global.io = io; // Mache io global verfügbar

app.use(bodyParser.json());

// --- SQLite DB Setup ---
const dbPath = path.join(__dirname, 'external', 'ycontroldata_settings.sqlite');
const sqliteDB = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('FATAL: Fehler beim Verbinden mit der SQLite-Datenbank:', err);
    process.exit(1);
  } else {
    console.log('Server: Verbindung zur SQLite-Datenbank hergestellt.');

    sqliteDB.run('PRAGMA foreign_keys = ON;', (pragmaErr) => {
        if (pragmaErr) console.error("Fehler beim Aktivieren von Foreign Keys:", pragmaErr.message);
        else console.log("SQLite Foreign Key Support aktiviert.");

        const setupDatabase = async () => {
          try {
            const runSql = (sql, description) => {
              return new Promise((resolve, reject) => {
                // console.log(`Executing SQL: ${description || 'SQL Statement...'}`); // Weniger verbose
                sqliteDB.run(sql, (runErr) => {
                  if (runErr) { console.error(`Fehler bei SQL (${description || 'SQL'}):`, runErr); reject(runErr); }
                  else { resolve(); }
                });
              });
            };

            // --- Tabellen erstellen ---
            await runSql(`CREATE TABLE IF NOT EXISTS "menu_items" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "label" VARCHAR, "link" VARCHAR, "svg" VARCHAR, "enable" BOOLEAN DEFAULT 1, "parent_id" INTEGER, "sort_order" INTEGER, "qhmiVariable" VARCHAR, "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("parent_id") REFERENCES "menu_items" ("id") ON DELETE CASCADE)`, 'Create menu_items');
            await runSql(`CREATE TABLE IF NOT EXISTS "menu_properties" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "menu_item_id" INTEGER, "key" VARCHAR, "value" VARCHAR, "source_type" VARCHAR CHECK(source_type IN ('static', 'dynamic', 'mqtt')), "source_key" VARCHAR, "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("menu_item_id") REFERENCES "menu_items" ("id") ON DELETE CASCADE)`, 'Create menu_properties');
            await runSql(`CREATE TABLE IF NOT EXISTS "menu_actions" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "menu_item_id" INTEGER, "action_name" VARCHAR, "qhmi_variable_name" VARCHAR, "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("menu_item_id") REFERENCES "menu_items" ("id") ON DELETE CASCADE)`, 'Create menu_actions');
            await runSql(`CREATE TABLE IF NOT EXISTS "menu_svg_conditions" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "menu_item_id" INTEGER, "value" VARCHAR, "svg" VARCHAR, "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("menu_item_id") REFERENCES "menu_items" ("id") ON DELETE CASCADE)`, 'Create menu_svg_conditions');
            await runSql(`CREATE TABLE IF NOT EXISTS "logging_settings" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "topic" VARCHAR UNIQUE, "enabled" BOOLEAN DEFAULT 1, "color" TEXT, "page" TEXT, "description" TEXT, "unit" TEXT, "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`, 'Create logging_settings');
            await runSql(`CREATE TABLE IF NOT EXISTS "QHMI_VARIABLES" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "NAME" VARCHAR UNIQUE NOT NULL, "VAR_VALUE" TEXT, "unit" VARCHAR, "TYPE" VARCHAR, "OPTI" TEXT, "adresse" TEXT, "faktor" REAL, "MIN" REAL, "MAX" REAL, "EDITOR" TEXT, "sort" INTEGER, "visible" BOOLEAN DEFAULT 1, "HKL" TEXT, "HKL_Feld" TEXT, "updated_at" TEXT, "created_at" TEXT DEFAULT CURRENT_TIMESTAMP, "last_modified" TEXT, "tag_top" TEXT, "tag_sub" TEXT, "benutzer" TEXT, "beschreibung" TEXT, "NAME_de" TEXT, "NAME_fr" TEXT, "NAME_en" TEXT, "NAME_it" TEXT, "OPTI_de" TEXT, "OPTI_fr" TEXT, "OPTI_en" TEXT, "OPTI_it" TEXT, "beschreibung_fr" TEXT, "beschreibung_en" TEXT, "beschreibung_it" TEXT)`, 'Create QHMI_VARIABLES');
            await runSql(`CREATE TABLE IF NOT EXISTS "rules" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT, "condition_logic" TEXT NOT NULL DEFAULT 'AND', "enabled" BOOLEAN DEFAULT 1, "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`, 'Create rules table');
            await runSql(`CREATE TABLE IF NOT EXISTS "rule_conditions" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "rule_id" INTEGER NOT NULL, "trigger_variable_name" TEXT NOT NULL, "operator" TEXT NOT NULL DEFAULT '=', "trigger_value" TEXT NOT NULL, "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("rule_id") REFERENCES "rules" ("id") ON DELETE CASCADE)`, 'Create rule_conditions table');
            await runSql(`CREATE TABLE IF NOT EXISTS "rule_actions" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "rule_id" INTEGER NOT NULL, "target_variable_name" TEXT NOT NULL, "action_type" TEXT NOT NULL DEFAULT 'set_visibility', "target_value" TEXT NOT NULL, "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("rule_id") REFERENCES "rules" ("id") ON DELETE CASCADE)`, 'Create rule_actions table');
            await runSql(`CREATE TABLE IF NOT EXISTS "alarm_configs" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "mqtt_topic" TEXT UNIQUE NOT NULL, "description" TEXT, "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`, 'Create alarm_configs table');
            await runSql(`CREATE TABLE IF NOT EXISTS "alarm_definitions" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "config_id" INTEGER NOT NULL, "bit_number" INTEGER NOT NULL CHECK(bit_number >= 0 AND bit_number <= 15), "alarm_text_key" TEXT NOT NULL, "priority" TEXT NOT NULL CHECK(priority IN ('prio1', 'prio2', 'prio3', 'warning', 'info')), "enabled" BOOLEAN DEFAULT 1, "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("config_id") REFERENCES "alarm_configs" ("id") ON DELETE CASCADE, UNIQUE ("config_id", "bit_number"))`, 'Create alarm_definitions table');
            await runSql(`
                CREATE TABLE IF NOT EXISTS "alarm_history" (
                    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                    "definition_id" INTEGER NULLABLE,
                    "timestamp" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    "status" TEXT NOT NULL CHECK(status IN ('active', 'inactive', 'reset')),
                    "mqtt_topic" TEXT,
                    "raw_value" INTEGER,
                    "priority" TEXT,
                    "alarm_text_key" TEXT,
                    FOREIGN KEY ("definition_id") REFERENCES "alarm_definitions" ("id") ON DELETE SET NULL
                )
            `, 'Create alarm_history table (modified)');
            await runSql(`CREATE INDEX IF NOT EXISTS idx_alarm_history_ts ON alarm_history (timestamp DESC);`, 'Create index on alarm_history timestamp');
            await runSql(`CREATE INDEX IF NOT EXISTS idx_alarm_history_def ON alarm_history (definition_id);`, 'Create index on alarm_history definitions');
            console.log("Alarm History Tabelle (modifiziert) erfolgreich erstellt oder existiert bereits.");
            // --- ENDE Tabellen ---

            console.log("Alle Tabellen (inkl. Alarm) erfolgreich erstellt oder existieren bereits.");

            // --- Migrationen ---
            const columns = await new Promise((resolve, reject) => { sqliteDB.all('PRAGMA table_info(logging_settings)', (pragmaErr, cols) => { if (pragmaErr) reject(pragmaErr); else resolve(cols || []); }); });
            const runMigration = (sql, columnName) => new Promise((resolve) => { sqliteDB.run(sql, (addErr) => { if(addErr && !addErr.message.includes('duplicate column name')) console.error(`Fehler Migration '${columnName}':`, addErr); resolve(); }); });
            const migrations = [];
            if (!columns.some(col => col.name === 'color')) migrations.push(runMigration(`ALTER TABLE logging_settings ADD COLUMN color TEXT`, 'Add color column'));
            if (!columns.some(col => col.name === 'page')) migrations.push(runMigration(`ALTER TABLE logging_settings ADD COLUMN page TEXT`, 'Add page column'));
            if (!columns.some(col => col.name === 'description')) migrations.push(runMigration(`ALTER TABLE logging_settings ADD COLUMN description TEXT`, 'Add description column'));
            if (!columns.some(col => col.name === 'unit')) migrations.push(runMigration(`ALTER TABLE logging_settings ADD COLUMN unit TEXT`, 'Add unit column'));
            if (migrations.length > 0) { await Promise.all(migrations); console.log("Migrationen abgeschlossen."); }
            // --- ENDE Migrationen ---

            console.log("Datenbank-Setup abgeschlossen.");
          } catch (dbSetupError) {
            console.error("FATAL: Fehler beim Einrichten der Datenbanktabellen:", dbSetupError);
            process.exit(1);
          }
        }; // Ende setupDatabase

        // --- Service Initialisierung ---
        async function initializeServices() {
            console.log("Initialisiere Services nach DB-Setup...");
            try {
                console.log("Initializing Menu Handlers...");
                setupMenuHandlers(io, sqliteDB, updateCachedMenuData, fetchMenuForFrontend, fetchMenuRawFromDB, insertMenuItems);

                console.log("Initializing MQTT Handler...");
                const mqttHandlerInstance = await setupMqtt(io, sqliteDB, fetchMenuForFrontend);

                 if (!mqttHandlerInstance || !mqttHandlerInstance.mqttClient) {
                      console.error("FEHLER: MQTT Handler oder MQTT Client konnte nicht initialisiert werden.");
                      throw new Error("MQTT Handler/Client Initialization failed.");
                 }

                 // +++ NEU: MQTT-Client global verfügbar machen +++
                 global.mqttClient = mqttHandlerInstance.mqttClient;
                 console.log("MQTT Client ist global verfügbar.");
                 // +++ ENDE NEU +++

                console.log("Initializing Logging Handler...");
                setupLogging(io, sqliteDB, mqttHandlerInstance);

                console.log("Initializing Rules Handler...");
                setupRulesHandlers(io, sqliteDB);

                console.log("Initializing Alarm Handler...");
                // Rufe setupAlarmHandler mit Instanz und Client auf
                setupAlarmHandler(io, sqliteDB, mqttHandlerInstance, mqttHandlerInstance.mqttClient);


                console.log("Services initialisiert.");

            } catch (error) {
                console.error("Fehler beim Initialisieren der Services:", error);
                throw error;
            }
        } // Ende initializeServices

        // --- Server Start ---
        function startServer() {
            const PORT = process.env.PORT || 3001;
            server.listen(PORT, () => { console.log(`Server läuft auf Port ${PORT}`); });
        }

        // Ablauf: DB Setup -> Services Init -> Server Start
        setupDatabase()
            .then(initializeServices)
            .then(startServer)
            .catch(error => {
                console.error("FATAL: Fehler während des Serverstarts:", error);
                process.exit(1);
            });

    }); // Ende sqliteDB.run PRAGMA Callback
  }
}); // Ende sqliteDB Initialisierung
// ------------------------------------

// Globaler Footer-Zustand (nur noch für nicht-Alarm-Daten)
let currentFooter = { temperature: '–' };

// --- API Endpunkte ---
// Die Routen in dbRoutes.js werden hier gemountet
app.use('/db', dbRoutes);

// --- Route für /setFooter (bleibt als HTTP POST) ---
app.post('/setFooter', (req, res) => {
  const footerUpdate = req.body;
  // Logik zum Aktualisieren des Footers (z.B. Temperatur)
  if (footerUpdate.temperature !== undefined) {
      currentFooter.temperature = footerUpdate.temperature;
      // Update per Socket.IO senden (nicht MQTT)
      if (global.io) {
          global.io.emit('footer-update', { temperature: currentFooter.temperature });
      }
  }
  res.sendStatus(200);
});
// ---------------------

// --- Socket.IO Verbindungshandler ---
io.on('connection', (socket) => {
  console.log('Neuer Client verbunden:', socket.id);

  // Sende initiale Temperatur (Alarmstatus kommt vom AlarmHandler)
  socket.emit('footer-update', { temperature: currentFooter.temperature });

  // Initiales Menü senden
  fetchMenuForFrontend(sqliteDB)
    .then(menu => socket.emit('menu-update', menu))
    .catch(err => console.error("Fehler beim Senden des initialen Menüs an Client:", err));

  // Listener für Settings-Anfrage
  socket.on('request-settings', (data) => {
    const user = data?.user || socket.loggedInUser || null;
    console.log(`Socket ${socket.id} fordert Settings für Benutzer: ${user}`);
    broadcastSettings(socket, user, sqliteDB); // Nutze broadcastSettings aus dbRoutes
  });

   // Benutzer setzen
  socket.on('set-user', (data) => {
    if (data && data.user) {
        socket.loggedInUser = data.user;
        console.log(`Socket ${socket.id} registriert Benutzer: ${data.user}`);
        broadcastSettings(socket, data.user, sqliteDB); // Nutze broadcastSettings aus dbRoutes
    } else {
        console.warn(`Socket ${socket.id}: Ungültige Daten bei 'set-user'.`);
    }
  });

  // Listener für Variablen-Updates vom Client
  socket.on('update-variable', async (payload) => {
    console.log("Socket: Empfangenes 'update-variable' Event:", payload);
    if (!payload || !payload.key || !payload.search || !payload.target || payload.value === undefined) {
      socket.emit('update-error', { message: 'Ungültiger Payload für update-variable' });
      return;
    }
    try {
      // Rufe die Funktion aus dbRoutes auf, die jetzt auch MQTT sendet
      const updateResult = await performVariableUpdate(payload.key, payload.search, payload.target, payload.value);
      socket.emit('update-success', updateResult); // Sende das Ergebnis zurück
      console.log(`Socket: Update für ${payload.search}.${payload.target} verarbeitet.`);

      // Trigger rule evaluation (wenn VAR_VALUE geändert wurde)
      if (payload.target === 'VAR_VALUE') {
          console.log(`[Socket update-variable] Triggering rule evaluation for ${payload.search}...`);
          if (typeof evaluateRules === 'function') {
              await evaluateRules(sqliteDB, payload.search, payload.value);
          } else {
              console.error("evaluateRules function is not available or not imported correctly!");
          }
      }
    } catch (error) {
      console.error(`Socket: Fehler bei Verarbeitung 'update-variable' für ${payload.search}:`, error);
      socket.emit('update-error', { message: error.message || 'Update fehlgeschlagen.' });
    }
  });

  // Listener für 'disconnect'
  socket.on('disconnect', () => {
    console.log('Client getrennt:', socket.id);
    delete socket.loggedInUser;
  });

  // Spezifische Listener für Menu, Logging, Rules, Alarms werden in den jeweiligen setup... Funktionen registriert.

});
// ------------------------------------

// Globale Fehlerbehandlung
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // process.exit(1); // Ggf. beenden
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // process.exit(1); // Ggf. beenden
});