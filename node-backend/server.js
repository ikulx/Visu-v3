const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// --- Imports ---
// Importiere den Router als Default und die Funktionen als Named Exports
const dbRoutes = require('./dbRoutes');
const { performVariableUpdate, broadcastSettings } = require('./dbRoutes');
// Stelle sicher, dass der Importpfad korrekt ist und setupLogging exportiert wird
const { setupLogging } = require('./loggingHandler');
// Importiere die MQTT-Funktionen
const { setupMqtt, updateCachedMenuData, checkAndSendMqttUpdates } = require('./mqttHandler');
// Importiere die Menü-Funktionen
const {
  fetchMenuForFrontend,
  setupMenuHandlers,
  defaultMenu,
  insertMenuItems,
  fetchMenuRawFromDB
} = require('./menuHandler');
// KORREKTUR & HINZUGEFÜGT: Importiere 'evaluateRules' statt 'evaluateVisibilityRules'
const { setupRulesHandlers, evaluateRules } = require('./rulesHandler'); // <-- KORRIGIERT

const app = express();
const server = http.createServer(app);

// Socket.IO Setup
const io = socketIo(server, {
  cors: {
    origin: '*', // Konfigurieren Sie dies für Produktionsumgebungen entsprechend
    methods: ['GET', 'POST'],
  },
});
// Mache io global verfügbar (wird von dbRoutes und anderen Handlern benötigt)
global.io = io;

app.use(bodyParser.json());

// --- SQLite DB Setup ---
const dbPath = path.join(__dirname, 'external', 'ycontroldata_settings.sqlite');
const sqliteDB = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('FATAL: Fehler beim Verbinden mit der SQLite-Datenbank:', err);
    process.exit(1); // Beende den Prozess, wenn die DB nicht verbunden werden kann
  } else {
    console.log('Server: Verbindung zur SQLite-Datenbank hergestellt.');

    // ***** NEU: PRAGMA für Fremdschlüssel aktivieren! *****
    sqliteDB.run('PRAGMA foreign_keys = ON;', (pragmaErr) => {
        if (pragmaErr) {
            console.error("Fehler beim Aktivieren von Foreign Keys:", pragmaErr.message);
            // Optional: Hier abbrechen, wenn Foreign Keys kritisch sind?
            // process.exit(1);
        } else {
            console.log("SQLite Foreign Key Support aktiviert (ON DELETE CASCADE sollte jetzt funktionieren).");
        }

        // --- Funktion zum sequentiellen Einrichten der DB ---
        const setupDatabase = async () => {
          try {
            // Hilfsfunktion zum Ausführen von SQL als Promise
            const runSql = (sql, description) => {
              return new Promise((resolve, reject) => {
                console.log(`Executing SQL: ${description || 'SQL Statement...'}`);
                sqliteDB.run(sql, (runErr) => {
                  if (runErr) {
                    console.error(`Fehler bei SQL (${description || 'SQL'}):`, runErr);
                    reject(runErr);
                  } else {
                    resolve();
                  }
                });
              });
            };

            // --- Bestehende Tabellen erstellen (Stelle sicher, dass diese Definitionen korrekt und vollständig sind!) ---
            await runSql(`
              CREATE TABLE IF NOT EXISTS "menu_items" (
                "id" INTEGER PRIMARY KEY AUTOINCREMENT, "label" VARCHAR, "link" VARCHAR, "svg" VARCHAR,
                "enable" BOOLEAN DEFAULT 1, "parent_id" INTEGER, "sort_order" INTEGER, "qhmiVariable" VARCHAR,
                "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M','now', 'localtime')),
                "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M','now', 'localtime')),
                FOREIGN KEY ("parent_id") REFERENCES "menu_items" ("id") ON DELETE CASCADE
              )`, 'Create menu_items');

            await runSql(`
              CREATE TABLE IF NOT EXISTS "menu_properties" (
                "id" INTEGER PRIMARY KEY AUTOINCREMENT, "menu_item_id" INTEGER, "key" VARCHAR, "value" VARCHAR,
                "source_type" VARCHAR CHECK(source_type IN ('static', 'dynamic', 'mqtt')), "source_key" VARCHAR,
                "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M','now', 'localtime')),
                "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M','now', 'localtime')),
                FOREIGN KEY ("menu_item_id") REFERENCES "menu_items" ("id") ON DELETE CASCADE
              )`, 'Create menu_properties');

            await runSql(`
              CREATE TABLE IF NOT EXISTS "menu_actions" (
                "id" INTEGER PRIMARY KEY AUTOINCREMENT, "menu_item_id" INTEGER, "action_name" VARCHAR, "qhmi_variable_name" VARCHAR,
                "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M','now', 'localtime')),
                "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M','now', 'localtime')),
                FOREIGN KEY ("menu_item_id") REFERENCES "menu_items" ("id") ON DELETE CASCADE
              )`, 'Create menu_actions');

            await runSql(`
              CREATE TABLE IF NOT EXISTS "menu_svg_conditions" (
                "id" INTEGER PRIMARY KEY AUTOINCREMENT, "menu_item_id" INTEGER, "value" VARCHAR, "svg" VARCHAR,
                "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M','now', 'localtime')),
                "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M','now', 'localtime')),
                FOREIGN KEY ("menu_item_id") REFERENCES "menu_items" ("id") ON DELETE CASCADE
              )`, 'Create menu_svg_conditions');

            await runSql(`
              CREATE TABLE IF NOT EXISTS "logging_settings" (
                "id" INTEGER PRIMARY KEY AUTOINCREMENT, "topic" VARCHAR UNIQUE, "enabled" BOOLEAN DEFAULT 1,
                "color" TEXT, "page" TEXT, "description" TEXT, "unit" TEXT,
                "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M','now', 'localtime')),
                "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M','now', 'localtime'))
              )`, 'Create logging_settings');

             // Erstelle QHMI_VARIABLES Tabelle, falls nicht vorhanden
             // Passe dies an deine tatsächliche Struktur an!
             await runSql(`
                CREATE TABLE IF NOT EXISTS "QHMI_VARIABLES" (
                    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                    "NAME" VARCHAR UNIQUE NOT NULL,
                    "VAR_VALUE" TEXT,
                    "unit" VARCHAR,
                    "TYPE" VARCHAR,
                    "OPTI" TEXT,
                    "adresse" TEXT,
                    "faktor" REAL,
                    "MIN" REAL,
                    "MAX" REAL,
                    "EDITOR" TEXT,
                    "sort" INTEGER,
                    "visible" BOOLEAN DEFAULT 1,
                    "HKL" TEXT,
                    "HKL_Feld" TEXT,
                    "updated_at" TEXT,
                    "created_at" TEXT,
                    "last_modified" TEXT,
                    "tag_top" TEXT,
                    "tag_sub" TEXT,
                    "benutzer" TEXT,
                    "beschreibung" TEXT,
                    "NAME_de" TEXT,
                    "NAME_fr" TEXT,
                    "NAME_en" TEXT,
                    "NAME_it" TEXT,
                    "OPTI_de" TEXT,
                    "OPTI_fr" TEXT,
                    "OPTI_en" TEXT,
                    "OPTI_it" TEXT,
                    "beschreibung_fr" TEXT,
                    "beschreibung_en" TEXT,
                    "beschreibung_it" TEXT
                )`, 'Create QHMI_VARIABLES');
            // ---------------------------------------------------------

            // --- NEUE REGEL-TABELLEN (ersetzen alte 'visibility_rules') ---
            // Stelle sicher, dass die alte Tabelle nicht mehr erstellt wird
            // await runSql(`CREATE TABLE IF NOT EXISTS "visibility_rules" ...`, 'Create OLD visibility_rules'); // AUSKOMMENTIERT/ENTFERNT

            await runSql(`
              CREATE TABLE IF NOT EXISTS "rules" (
                "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                "name" TEXT,
                "condition_logic" TEXT NOT NULL DEFAULT 'AND', -- ('AND', 'OR')
                "enabled" BOOLEAN DEFAULT 1,
                "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M','now', 'localtime')),
                "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M','now', 'localtime'))
              )`, 'Create rules table');

            await runSql(`
              CREATE TABLE IF NOT EXISTS "rule_conditions" (
                "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                "rule_id" INTEGER NOT NULL,
                "trigger_variable_name" TEXT NOT NULL,
                "operator" TEXT NOT NULL DEFAULT '=',
                "trigger_value" TEXT NOT NULL,
                "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M','now', 'localtime')),
                "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M','now', 'localtime')),
                FOREIGN KEY ("rule_id") REFERENCES "rules" ("id") ON DELETE CASCADE -- Wichtig!
              )`, 'Create rule_conditions table');

            await runSql(`
              CREATE TABLE IF NOT EXISTS "rule_actions" (
                "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                "rule_id" INTEGER NOT NULL,
                "target_variable_name" TEXT NOT NULL, -- Kann QHMI_VARIABLES.NAME oder logging_settings.topic sein
                "action_type" TEXT NOT NULL DEFAULT 'set_visibility', -- z.B. 'set_visibility', 'set_logging_enabled'
                "target_value" TEXT NOT NULL, -- z.B. '1'/'0'
                "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M','now', 'localtime')),
                "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M','now', 'localtime')),
                FOREIGN KEY ("rule_id") REFERENCES "rules" ("id") ON DELETE CASCADE -- Wichtig!
              )`, 'Create rule_actions table');
            // --- Ende neue Regel-Tabellen ---

            console.log("Alle Tabellen erfolgreich erstellt oder existieren bereits.");

            // --- Migrationen (Beispielhaft für logging_settings) ---
            console.log("Starte Migrationen...");
            const columns = await new Promise((resolve, reject) => {
                 sqliteDB.all('PRAGMA table_info(logging_settings)', (pragmaErr, cols) => {
                     if (pragmaErr) reject(pragmaErr); else resolve(cols || []);
                 });
            });

            const runMigration = (sql, columnName) => {
                return new Promise((resolve) => {
                     sqliteDB.run(sql, (addErr) => {
                        if(addErr && !addErr.message.includes('duplicate column name')) { console.error(`Fehler Migration '${columnName}':`, addErr); }
                        else if (!addErr) { console.log(`Spalte '${columnName}' hinzugefügt.`); }
                        else { console.log(`Spalte '${columnName}' existiert bereits.`); }
                        resolve();
                     });
                });
            };

            const migrations = [];
            if (!columns.some(col => col.name === 'color')) migrations.push(runMigration(`ALTER TABLE logging_settings ADD COLUMN color TEXT`, 'Add color column'));
            if (!columns.some(col => col.name === 'page')) migrations.push(runMigration(`ALTER TABLE logging_settings ADD COLUMN page TEXT`, 'Add page column'));
            if (!columns.some(col => col.name === 'description')) migrations.push(runMigration(`ALTER TABLE logging_settings ADD COLUMN description TEXT`, 'Add description column'));
            if (!columns.some(col => col.name === 'unit')) migrations.push(runMigration(`ALTER TABLE logging_settings ADD COLUMN unit TEXT`, 'Add unit column'));

            if (migrations.length > 0) { await Promise.all(migrations); console.log("Migrationen abgeschlossen."); }
            else { console.log("Keine Migrationen notwendig."); }
            // --- Ende Migrationen ---

            console.log("Datenbank-Setup abgeschlossen.");

          } catch (dbSetupError) {
            console.error("FATAL: Fehler beim Einrichten der Datenbanktabellen:", dbSetupError);
            process.exit(1);
          }
        };

        // --- Service Initialisierung ---
        async function initializeServices() {
            console.log("Initialisiere Services nach DB-Setup...");
            try {
                const menuHandlerInstance = setupMenuHandlers(io, sqliteDB, updateCachedMenuData, fetchMenuForFrontend, fetchMenuRawFromDB, insertMenuItems);
                const mqttHandlerInstance = await setupMqtt(io, sqliteDB, fetchMenuForFrontend);
                // Logging-Handler initialisieren
                if (typeof setupLogging === 'function') {
                    setupLogging(io, sqliteDB, mqttHandlerInstance);
                } else { console.error("setupLogging function not found!"); }
                // Regel-Handler initialisieren
                if (typeof setupRulesHandlers === 'function') {
                    setupRulesHandlers(io, sqliteDB); // Initialisiert die Socket-Listener für Regeln
                } else { console.error("setupRulesHandlers function not found!"); }
                console.log("Services initialisiert (oder Fehler geloggt).");
            } catch (error) {
                console.error("Fehler beim Initialisieren der Services:", error);
                throw error; // Fehler weiterwerfen, um Start zu verhindern
            }
        }

        // --- Server Start ---
        function startServer() {
            const PORT = process.env.PORT || 3001;
            server.listen(PORT, () => { console.log(`Server läuft auf Port ${PORT}`); });
        }

        // Ablauf: DB Setup -> Services Init -> Server Start
        setupDatabase()
            .then(initializeServices)
            .then(startServer)
            .catch(error => { console.error("FATAL: Fehler während des Serverstarts:", error); process.exit(1); });

    }); // Ende sqliteDB.run PRAGMA Callback
  }
});
// ------------------------------------

let currentFooter = { temperature: '–' };

// --- API Endpunkte ---
app.use('/db', dbRoutes); // Express Router für DB-Endpunkte
app.post('/setFooter', (req, res) => {
  const footerUpdate = req.body;
  currentFooter = { ...currentFooter, ...footerUpdate };
  if (global.io) global.io.emit('footer-update', currentFooter);
  res.sendStatus(200);
});
// ---------------------

// --- Socket.IO Verbindungshandler ---
io.on('connection', (socket) => {
  console.log('Neuer Client verbunden:', socket.id);
  socket.emit('footer-update', currentFooter);

  // Initiales Menü senden
  fetchMenuForFrontend(sqliteDB)
    .then(menu => socket.emit('menu-update', menu))
    .catch(err => console.error("Fehler beim Senden des initialen Menüs an Client:", err));

  // Listener für Settings-Anfrage
  socket.on('request-settings', (data) => {
    const user = data?.user || socket.loggedInUser || null;
    console.log(`Socket ${socket.id} fordert Settings für Benutzer: ${user}`);
    // broadcastSettings ist in dbRoutes.js definiert und verwendet die sqliteDB Instanz
    // Stelle sicher, dass broadcastSettings sqliteDB akzeptiert oder global darauf zugreift
    broadcastSettings(socket, user, sqliteDB); // Übergebe sqliteDB explizit
  });

   // Benutzer setzen
  socket.on('set-user', (data) => {
    if (data && data.user) {
        socket.loggedInUser = data.user;
        console.log(`Socket ${socket.id} registriert Benutzer: ${data.user}`);
        broadcastSettings(socket, data.user, sqliteDB); // Übergebe sqliteDB
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
      // 1. Variable aktualisieren
      const updateResult = await performVariableUpdate(payload.key, payload.search, payload.target, payload.value);
      socket.emit('update-success', updateResult);
      console.log(`Socket: Update für ${payload.search}.${payload.target} verarbeitet.`);

      // 2. Regeln auswerten, WENN sich VAR_VALUE geändert hat
      if (payload.target === 'VAR_VALUE') {
          console.log(`[Socket update-variable] Triggering rule evaluation for ${payload.search}...`);
          // KORREKTUR: Rufe die korrekte, importierte Funktion 'evaluateRules' auf
          if (typeof evaluateRules === 'function') { // Prüfen ob Funktion existiert
             // Übergebe die sqliteDB Instanz an die Funktion
             await evaluateRules(sqliteDB, payload.search, payload.value); // <-- KORRIGIERT
          } else {
             console.error("evaluateRules function is not available or not imported correctly!");
          }
      }

      // 3. MQTT Update Check (wie zuvor)
      if (updateResult.menuBroadcasted || updateResult.targetColumn === 'VAR_VALUE') {
         console.log(`[Socket update-variable] Trigger checkAndSendMqttUpdates...`);
         // Stelle sicher, dass die Funktion existiert und io verfügbar ist
         if (global.io && typeof checkAndSendMqttUpdates === 'function') {
             await checkAndSendMqttUpdates(global.io, sqliteDB);
         } else {
             console.warn('[Socket update-variable] Cannot check/send MQTT updates: io or function not available.');
         }
      }

    } catch (error) {
      console.error(`Socket: Fehler bei Verarbeitung 'update-variable' für ${payload.search}:`, error);
      socket.emit('update-error', { message: error.message || 'Update fehlgeschlagen.' });
    }
  });

  // Andere Listener werden von Handlern registriert...
  // setupMenuHandlers(io, sqliteDB, ...) fügt seine Listener hinzu
  // setupLogging(io, sqliteDB, ...) fügt seine Listener hinzu (in der Klasse)
  // setupRulesHandlers(io, sqliteDB) fügt seine Listener hinzu

  socket.on('disconnect', () => {
    console.log('Client getrennt:', socket.id);
    delete socket.loggedInUser; // Zugeordneten Benutzer entfernen
  });
});
// ------------------------------------