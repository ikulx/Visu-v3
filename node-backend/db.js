// src/db.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'external', 'ycontroldata_settings.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Fehler beim Verbinden mit der SQLite-Datenbank:', err.message);
  } else {
    console.log('Verbindung zur SQLite-Datenbank hergestellt.');
  }
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      link TEXT UNIQUE,
      label TEXT NOT NULL,
      svg TEXT,
      parent_id INTEGER,
      properties TEXT,
      labelSource TEXT DEFAULT 'static', -- Neues Feld: 'static' oder 'db'
      dbName TEXT, -- Neues Feld: NAME aus QHMI_VARIABLES, wenn labelSource = 'db'
      FOREIGN KEY (parent_id) REFERENCES menu_items(id)
    )
  `, (err) => {
    if (err) {
      console.error('Fehler beim Erstellen der menu_items-Tabelle:', err.message);
    } else {
      console.log('Tabelle menu_items bereit.');
    }
  });

  db.get('SELECT COUNT(*) as count FROM menu_items', (err, row) => {
    if (err) {
      console.error('Fehler beim Prüfen der menu_items-Tabelle:', err.message);
    } else if (row.count === 0) {
      db.run(`
        INSERT INTO menu_items (link, label, svg, properties, labelSource)
        VALUES (?, ?, ?, ?, ?)
      `, ['/', 'Home', 'home', JSON.stringify({}), 'static'], (err) => {
        if (err) {
          console.error('Fehler beim Einfügen des Standard-Menüs:', err.message);
        } else {
          console.log('Standard-Menü eingefügt.');
        }
      });
    }
  });
});

process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Fehler beim Schließen der Datenbank:', err.message);
    } else {
      console.log('Datenbankverbindung geschlossen.');
    }
    process.exit(0);
  });
});

module.exports = db;