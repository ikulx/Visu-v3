const db = require('./db');

function startPropertyUpdater(io) {
  setInterval(() => {
    db.all(`
      SELECT mp.menu_id, mp.key, qv.VAR_VALUE
      FROM menu_properties mp
      JOIN QHMI_VARIABLES qv ON mp.qhmi_variable_id = qv.id
      WHERE mp.source = 'dynamic'
    `, [], (err, rows) => {
      if (err) {
        console.error('Fehler beim Abrufen der dynamischen Properties:', err);
        return;
      }
      const updates = {};
      rows.forEach(row => {
        if (!updates[row.menu_id]) {
          updates[row.menu_id] = {};
        }
        updates[row.menu_id][row.key] = row.VAR_VALUE;
      });
      io.emit('properties-update', updates);
    });
  }, 5000); // Alle 5 Sekunden
}

module.exports = { startPropertyUpdater };