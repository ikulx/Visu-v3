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
                // console.log(`SQL (${description || 'SQL'}) erfolgreich ausgeführt.`); // Optional: weniger ausführliches Logging
                resolve();
              }
            });
          });
        };

        // Tabellen sequentiell erstellen (Stelle sicher, dass alle Spalten hier definiert sind)
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

         // Erstelle QHMI_VARIABLES Tabelle, falls nicht vorhanden (Beispielstruktur!)
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


        console.log("Alle Tabellen erfolgreich erstellt oder existieren bereits.");

        // --- Migrationen (nach Tabellenerstellung) ---
        console.log("Starte Migrationen...");
        const columns = await new Promise((resolve, reject) => {
             sqliteDB.all('PRAGMA table_info(logging_settings)', (pragmaErr, cols) => {
                 if (pragmaErr) reject(pragmaErr); else resolve(cols);
             });
        });

        const runMigration = (sql, columnName) => {
            return new Promise((resolve, reject) => {
                 sqliteDB.run(sql, (addErr) => {
                    if(addErr) {
                        console.error(`Fehler beim Hinzufügen Spalte '${columnName}':`, addErr);
                        // Trotzdem fortfahren, da ALTER TABLE IF NOT EXISTS nicht standard ist
                        resolve();
                    } else {
                        console.log(`Spalte '${columnName}' hinzugefügt oder existiert bereits.`);
                        resolve();
                    }
                 });
            });
        };

        const migrations = [];
        if (!columns.some(col => col.name === 'color')) migrations.push(runMigration(`ALTER TABLE logging_settings ADD COLUMN color TEXT`, 'Add color column'));
        if (!columns.some(col => col.name === 'page')) migrations.push(runMigration(`ALTER TABLE logging_settings ADD COLUMN page TEXT`, 'Add page column'));
        if (!columns.some(col => col.name === 'description')) migrations.push(runMigration(`ALTER TABLE logging_settings ADD COLUMN description TEXT`, 'Add description column'));
        if (!columns.some(col => col.name === 'unit')) migrations.push(runMigration(`ALTER TABLE logging_settings ADD COLUMN unit TEXT`, 'Add unit column'));

        if (migrations.length > 0) {
             await Promise.all(migrations);
             console.log("Migrationen abgeschlossen.");
        } else {
             console.log("Keine Migrationen notwendig.");
        }

        console.log("Datenbank-Setup abgeschlossen.");

      } catch (dbSetupError) {
        console.error("FATAL: Fehler beim Einrichten der Datenbanktabellen:", dbSetupError);
        process.exit(1);
      }
    };

    // Führe DB Setup aus, dann initialisiere Services und starte Server
    setupDatabase()
        .then(initializeServices) // Führe Initialisierung nach DB-Setup aus
        .then(startServer)       // Starte den Server nach erfolgreicher Initialisierung
        .catch(error => {
            console.error("FATAL: Fehler während des Serverstarts:", error);
            process.exit(1);
        });
  }
});
// ------------------------------------

let currentFooter = { temperature: '–' };

// --- Funktion zum Initialisieren der Services (async) ---
async function initializeServices() {
    console.log("Initialisiere Services nach DB-Setup...");
    try {
        // Menü-Handler initialisieren
        const menuHandlerInstance = setupMenuHandlers(io, sqliteDB, updateCachedMenuData, fetchMenuForFrontend, fetchMenuRawFromDB, insertMenuItems);
        // MQTT- und Logging-Handler initialisieren (wartet auf MQTT Map Build)
        const mqttHandlerInstance = await setupMqtt(io, sqliteDB, fetchMenuForFrontend); // await hier
        setupLogging(io, sqliteDB, mqttHandlerInstance);
        console.log("Services erfolgreich initialisiert.");
    } catch (error) {
        console.error("Fehler beim Initialisieren der Services:", error);
        throw error; // Fehler weiterwerfen
    }
}
// ------------------------------------------------------

// --- Funktion zum Starten des Servers ---
function startServer() {
    const PORT = 3001;
    server.listen(PORT, () => {
      console.log(`Server läuft auf Port ${PORT}`);
    });
}
// -----------------------------------

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
    broadcastSettings(socket, user);
  });

   // Benutzer setzen
  socket.on('set-user', (data) => {
    if (data && data.user) {
        socket.loggedInUser = data.user;
        console.log(`Socket ${socket.id} registriert Benutzer: ${data.user}`);
        broadcastSettings(socket, data.user);
    } else {
        console.warn(`Socket ${socket.id}: Ungültige Daten bei 'set-user' empfangen.`);
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
      // Rufe die konsolidierte Update-Funktion aus dbRoutes auf
      const updateResult = await performVariableUpdate(payload.key, payload.search, payload.target, payload.value);
      socket.emit('update-success', updateResult);
      console.log(`Socket: Update für ${payload.search}.${payload.target} erfolgreich verarbeitet.`);

      // Entscheide hier, ob checkAndSendMqttUpdates nötig ist
      if (updateResult.menuBroadcasted || updateResult.targetColumn === 'VAR_VALUE') {
           console.log(`[Socket update-variable] Trigger checkAndSendMqttUpdates nach Änderung von '${updateResult.targetColumn}'.`);
           await checkAndSendMqttUpdates(global.io, sqliteDB);
      }

    } catch (error) {
      console.error(`Socket: Fehler bei der Verarbeitung von 'update-variable' für ${payload.search}:`, error);
      socket.emit('update-error', { message: error.message || 'Fehler beim Verarbeiten des Updates.' });
    }
  });

  // Andere Listener werden von Handlern registriert...

  socket.on('disconnect', () => {
    console.log('Client getrennt:', socket.id);
    delete socket.loggedInUser;
  });
});
// ------------------------------------