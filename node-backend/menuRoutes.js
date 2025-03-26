// src/menuRoutes.js
const express = require('express');
const router = express.Router();
const db = require('./db');

// Funktion zum Laden des Menüs aus der Datenbank
async function loadMenuFromDb() {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT mi.id, mi.link, mi.label, mi.svg, mi.parent_id, mi.labelSource, mi.qhmi_variable_id, 
             qv.NAME, qv.VAR_VALUE, qv.visible
      FROM menu_items mi
      LEFT JOIN QHMI_VARIABLES qv ON mi.qhmi_variable_id = qv.id
    `, [], (err, rows) => {
      if (err) {
        console.error('Fehler beim Laden des Menüs:', err.message);
        return reject(err);
      }

      db.all(`
        SELECT mp.menu_id, mp.key, mp.value, mp.source, mp.qhmi_variable_id, qv.NAME, qv.VAR_VALUE 
        FROM menu_properties mp
        LEFT JOIN QHMI_VARIABLES qv ON mp.qhmi_variable_id = qv.id
      `, [], (err, properties) => {
        if (err) {
          console.error('Fehler beim Laden der Properties:', err.message);
          return reject(err);
        }

        const propertiesMap = new Map();
        properties.forEach(prop => {
          if (!propertiesMap.has(prop.menu_id)) {
            propertiesMap.set(prop.menu_id, {});
          }
          propertiesMap.get(prop.menu_id)[prop.key] = prop.source === 'dynamic' && prop.qhmi_variable_id
            ? prop.VAR_VALUE || prop.value
            : prop.value;
        });

        const buildMenuTree = (items, parentId = null) => {
            const filteredItems = items.filter(item => item.parent_id === parentId);
          
            return filteredItems
              .filter(item => {
                // Prüfe dynamische Menüpunkte mit visible = 0
                if (item.labelSource === 'dynamic' && item.qhmi_variable_id) {
                  const visible = parseInt(item.visible); // Konvertiere zu Integer
                  if (visible === 0) {
                    console.log(`Ausblenden von Menüpunkt ID ${item.id} (label: ${item.label}) wegen visible = 0`);
                    return false; // Menüpunkt wird ausgeblendet
                  }
                }
                return true; // Andernfalls behalten
              })
              .map(item => {
                const finalLabel = item.labelSource === 'dynamic' && item.qhmi_variable_id
                  ? item.VAR_VALUE || 'Unbekannter Wert'
                  : item.label || 'Unbenannt';
                return {
                  id: item.id,
                  link: item.link,
                  label: finalLabel,
                  svg: item.svg,
                  properties: propertiesMap.get(item.id) || {},
                  labelSource: item.labelSource,
                  qhmi_variable_id: item.qhmi_variable_id,
                  sub: buildMenuTree(items, item.id), // Rekursive Filterung für Untermenüs
                };
              });
          };
        const menuItems = buildMenuTree(rows);
        resolve({ menuItems });
      });
    });
  });
}

// Prüfe, ob die Datenbank leer ist
async function isDatabaseEmpty() {
  return new Promise((resolve, reject) => {
    db.get('SELECT COUNT(*) as count FROM menu_items', [], (err, row) => {
      if (err) {
        console.error('Fehler beim Prüfen der Datenbank:', err.message);
        reject(err);
      } else {
        resolve(row.count === 0);
      }
    });
  });
}

// Initiales Menü-Objekt
let currentMenu = { menuItems: [] };

// Initiales Laden des Menüs mit Prüfung
const initializeMenu = async () => {
  try {
    const isEmpty = await isDatabaseEmpty();
    if (isEmpty) {
      console.log('Datenbank ist leer, füge Standard-Menü ein...');
      await insertDefaultMenu();
    }
    currentMenu = await loadMenuFromDb();
    console.log('Menü aus der Datenbank geladen:', currentMenu.menuItems.length, 'Einträge');
  } catch (err) {
    console.warn('Fehler beim Initialisieren des Menüs:', err.message);
    currentMenu = { menuItems: [] };
  }
};

// Führe die Initialisierung sofort aus und warte darauf
let initializationPromise = initializeMenu();

// Funktion zum Einfügen eines Standard-Menüs
async function insertDefaultMenu() {
  const defaultMenu = {
    menuItems: [
      {
        link: '/ez01',
        label: 'Erzeuger 01',
        svg: 'AirCalorA',
        labelSource: 'static',
        properties: {
          'Temperatur': 'Boiler1.VAR_VALUE',
          'Status': '2'
        },
        sub: [
          {
            link: '/ez01/sub',
            label: 'Untermenü',
            svg: '',
            labelSource: 'static',
          }
        ]
      }
    ]
  };

  await updateMenu(defaultMenu);
  console.log('Standard-Menü erfolgreich eingefügt.');
}

// Funktion zum Aktualisieren des Menüs
async function updateMenu(newMenu) {
  if (!newMenu.menuItems || !Array.isArray(newMenu.menuItems)) {
    throw new Error('Ungültiges Menüformat: menuItems muss ein Array sein');
  }

  const validateMenuItems = (items) => {
    for (const item of items) {
      if (!item.label || typeof item.label !== 'string') {
        item.label = 'Unnamed';
      }
      if (!item.labelSource) {
        item.labelSource = 'static';
      }
      if (item.sub && Array.isArray(item.sub)) {
        validateMenuItems(item.sub);
      }
    }
  };
  validateMenuItems(newMenu.menuItems);

  await new Promise((resolve, reject) => {
    db.run('DELETE FROM menu_items', (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  await new Promise((resolve, reject) => {
    db.run('DELETE FROM menu_properties', (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  const insertMenuItems = async (items, parentId = null) => {
    for (const item of items) {
      let qhmiVariableId = null;
      if (item.labelSource === 'dynamic' && item.qhmi_variable_id) {
        qhmiVariableId = item.qhmi_variable_id;
      }

      const id = await new Promise((resolve, reject) => {
        db.run(`
          INSERT INTO menu_items (link, label, svg, parent_id, labelSource, qhmi_variable_id)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [item.link, item.label, item.svg, parentId, item.labelSource, qhmiVariableId], function (err) {
          if (err) reject(err);
          else resolve(this.lastID);
        });
      });

      if (item.properties && Object.keys(item.properties).length > 0) {
        for (const [key, value] of Object.entries(item.properties)) {
          let propQhmiVariableId = null;
          let propValue = value;
          const source = (typeof value === 'string' && value.includes('.')) ? 'dynamic' : 'static';

          if (source === 'dynamic' && value) {
            propQhmiVariableId = await new Promise((resolve, reject) => {
              db.get('SELECT id FROM QHMI_VARIABLES WHERE NAME = ?', [value.split('.')[0]], (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.id : null);
              });
            });
            propValue = null;
          }

          await new Promise((resolve, reject) => {
            db.run(`
              INSERT INTO menu_properties (menu_id, key, value, qhmi_variable_id, source)
              VALUES (?, ?, ?, ?, ?)
            `, [id, key, propValue, propQhmiVariableId, source], (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        }
      }

      if (item.sub && Array.isArray(item.sub)) {
        await insertMenuItems(item.sub, id);
      }
    }
  };

  await insertMenuItems(newMenu.menuItems);
  currentMenu = await loadMenuFromDb();
  global.io.emit('menu-update', currentMenu);
}

// Endpunkt zum Aktualisieren des gesamten Menüs (HTTP)
router.post('/update-menu', async (req, res) => {
  try {
    await updateMenu(req.body);
    res.sendStatus(200);
  } catch (err) {
    console.error('Fehler beim Aktualisieren des Menüs:', err.message);
    res.status(500).send(`Fehler beim Aktualisieren des Menüs: ${err.message}`);
    global.io.emit('menu-error', { message: 'Menü-Update fehlgeschlagen' });
  }
});

// Endpunkt zum Abrufen von QHMI_VARIABLES
router.get('/qhmi-variables', (req, res) => {
  db.all('SELECT id, NAME FROM QHMI_VARIABLES', [], (err, rows) => {
    if (err) {
      res.status(500).send('Fehler beim Abrufen der Variablen');
    } else {
      res.json(rows);
    }
  });
});


// Funktion zum Initialisieren des Menüs bei Socket-Verbindungen
function initializeMenuSocket(io) {
  io.on('connection', async (socket) => {
    console.log('Neuer Client verbunden:', socket.id);

    socket.on('request-qhmi-variables', () => {
      db.all('SELECT id, NAME FROM QHMI_VARIABLES', [], (err, rows) => {
        if (err) {
          socket.emit('qhmi-variables-error', { message: 'Fehler beim Laden der Variablen' });
        } else {
          socket.emit('qhmi-variables', rows);
        }
      });
    });

    socket.on('request-menu', async () => {
      const menuData = await loadMenuFromDb();
      socket.emit('menu-update', menuData);
    });

    try {
      await initializationPromise;
      socket.emit('menu-update', currentMenu);
    } catch (err) {
      console.error('Fehler beim Senden des initialen Menüs:', err.message);
      socket.emit('menu-error', { message: 'Menü konnte nicht geladen werden' });
    }

    socket.on('update-menu', async (newMenu) => {
      try {
        await updateMenu(newMenu);
        socket.emit('menu-update-success', { message: 'Menü erfolgreich aktualisiert' });
      } catch (err) {
        console.error('Fehler beim Socket-Menü-Update:', err.message);
        socket.emit('menu-update-error', { message: 'Fehler beim Aktualisieren des Menüs' });
      }
    });
  });
}

module.exports = {
  router,
  initializeMenuSocket,
  getCurrentMenu: () => currentMenu,
  loadMenuFromDb,
};