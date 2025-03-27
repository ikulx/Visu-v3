const express = require('express');
const router = express.Router();
const db = require('./db');

async function loadMenuFromDb() {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT mi.id, mi.link, mi.label, mi.svg, mi.parent_id, mi.labelSource, mi.qhmi_variable_id, 
             qv.NAME, qv.VAR_VALUE, qv.visible
      FROM menu_items mi
      LEFT JOIN QHMI_VARIABLES qv ON mi.qhmi_variable_id = qv.id
    `, [], (err, rows) => {
      if (err) return reject(err);

      db.all(`
        SELECT mp.menu_id, mp.key, mp.value, mp.source, mp.qhmi_variable_id, qv.NAME, qv.VAR_VALUE 
        FROM menu_properties mp
        LEFT JOIN QHMI_VARIABLES qv ON mp.qhmi_variable_id = qv.id
      `, [], (err, properties) => {
        if (err) return reject(err);

        const propertiesMap = new Map();
        properties.forEach(prop => {
          if (!propertiesMap.has(prop.menu_id)) propertiesMap.set(prop.menu_id, {});
          propertiesMap.get(prop.menu_id)[prop.key] = {
            currentValue: prop.source === 'dynamic' ? prop.VAR_VALUE : prop.value,
            source: prop.source,
            qhmi_variable_id: prop.qhmi_variable_id
          };
        });

        const buildMenuTree = (items, parentId = null) => {
          return items
            .filter(item => item.parent_id === parentId)
            .map(item => ({
              id: item.id,
              link: item.link,
              label: item.labelSource === 'dynamic' && item.qhmi_variable_id ? item.VAR_VALUE || 'Unbekannter Wert' : item.label || 'Unbenannt',
              svg: item.svg,
              labelSource: item.labelSource,
              qhmi_variable_id: item.qhmi_variable_id,
              visible: item.visible,
              properties: propertiesMap.get(item.id) || {},
              sub: buildMenuTree(items, item.id)
            }));
        };
        resolve({ menuItems: buildMenuTree(rows) });
      });
    });
  });
}

async function loadMenuWithProperties() {
  return await loadMenuFromDb(); // Properties sind bereits integriert
}

async function isDatabaseEmpty() {
  return new Promise((resolve, reject) => {
    db.get('SELECT COUNT(*) as count FROM menu_items', [], (err, row) => {
      if (err) reject(err);
      else resolve(row.count === 0);
    });
  });
}

async function updateMenu(newMenu) {
  if (!newMenu.menuItems || !Array.isArray(newMenu.menuItems)) {
    throw new Error('Ungültiges Menüformat: menuItems muss ein Array sein');
  }

  const validateMenuItems = (items) => {
    for (const item of items) {
      if (!item.label || typeof item.label !== 'string') item.label = 'Unnamed';
      if (!item.labelSource) item.labelSource = 'static';
      if (item.sub && Array.isArray(item.sub)) validateMenuItems(item.sub);
    }
  };
  validateMenuItems(newMenu.menuItems);

  await new Promise((resolve, reject) => db.run('DELETE FROM menu_items', err => err ? reject(err) : resolve()));
  await new Promise((resolve, reject) => db.run('DELETE FROM menu_properties', err => err ? reject(err) : resolve()));

  const insertMenuItems = async (items, parentId = null) => {
    for (const item of items) {
      const qhmiVariableId = item.labelSource === 'dynamic' && item.qhmi_variable_id ? item.qhmi_variable_id : null;
      const id = await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO menu_items (link, label, svg, parent_id, labelSource, qhmi_variable_id) VALUES (?, ?, ?, ?, ?, ?)`,
          [item.link, item.label, item.svg, parentId, item.labelSource, qhmiVariableId],
          function (err) { err ? reject(err) : resolve(this.lastID); }
        );
      });

      if (item.properties && Object.keys(item.properties).length > 0) {
        for (const [key, value] of Object.entries(item.properties)) {
          const source = (typeof value === 'string' && value.includes('.')) ? 'dynamic' : 'static';
          let propQhmiVariableId = null;
          let propValue = value;
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
            db.run(
              `INSERT INTO menu_properties (menu_id, key, value, qhmi_variable_id, source) VALUES (?, ?, ?, ?, ?)`,
              [id, key, propValue, propQhmiVariableId, source],
              err => err ? reject(err) : resolve()
            );
          });
        }
      }

      if (item.sub && Array.isArray(item.sub)) {
        await insertMenuItems(item.sub, id);
      }
    }
  };

  await insertMenuItems(newMenu.menuItems);
}

(async () => {
  if (await isDatabaseEmpty()) {
    console.log('Datenbank ist leer, füge Standard-Menü ein...');
    await updateMenu({
      menuItems: [
        { link: '/ez01', label: 'Erzeuger 01', svg: 'AirCalorA', labelSource: 'static', properties: { 'Temperatur': 'Boiler1.VAR_VALUE', 'Status': '2' }, sub: [{ link: '/ez01/sub', label: 'Untermenü', svg: '', labelSource: 'static' }] }
      ]
    });
    console.log('Standard-Menü eingefügt.');
  }

  setInterval(async () => {
    const menuData = await loadMenuWithProperties();
    global.io.emit('data-update', { type: 'menu', data: menuData });
  }, 5000);
})();

router.post('/update-menu', async (req, res) => {
  try {
    await updateMenu(req.body);
    res.sendStatus(200);
  } catch (err) {
    console.error('Fehler beim Aktualisieren des Menüs:', err.message);
    res.status(500).send(`Fehler: ${err.message}`);
  }
});

router.get('/qhmi-variables', (req, res) => {
  db.all('SELECT id, NAME FROM QHMI_VARIABLES', [], (err, rows) => {
    if (err) res.status(500).send('Fehler beim Abrufen der Variablen');
    else res.json(rows);
  });
});

module.exports = { router, loadMenuWithProperties, updateMenu };