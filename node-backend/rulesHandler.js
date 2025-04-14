// src/rulesHandler.js
const { performVariableUpdate } = require('./dbRoutes');
// Importiere die Update-Funktion für Logging-Settings (Pfad prüfen!)
const { performLoggingSettingUpdate } = require('./loggingHandler');
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


/**
 * Holt alle Regeln inklusive ihrer Bedingungen und Aktionen.
 * @param {sqlite3.Database} sqliteDB
 * @returns {Promise<Array<object>>} Verschachtelte Regelstruktur.
 */
async function fetchRules(sqliteDB) {
  console.log('[RulesHandler] Fetching rules with conditions and actions...');
  try {
    const rules = await runDbQuery(sqliteDB, 'SELECT * FROM rules ORDER BY id ASC');
    const rulesWithDetails = [];

    for (const rule of rules) {
      // Hole Bedingungen für diese Regel
      const conditions = await runDbQuery(sqliteDB, 'SELECT * FROM rule_conditions WHERE rule_id = ? ORDER BY id ASC', [rule.id]);
      // Hole Aktionen für diese Regel
      const actions = await runDbQuery(sqliteDB, 'SELECT * FROM rule_actions WHERE rule_id = ? ORDER BY id ASC', [rule.id]);

      rulesWithDetails.push({
        ...rule,
        condition_logic: rule.condition_logic || 'AND', // Sicherstellen, dass Logik existiert
        enabled: !!rule.enabled, // Zu Boolean konvertieren
        conditions: conditions || [], // Leeres Array falls keine Bedingungen
        actions: actions || []   // Leeres Array falls keine Aktionen
      });
    }
    console.log(`[RulesHandler] Fetched ${rulesWithDetails.length} rules with details.`);
    return rulesWithDetails;
  } catch (err) {
    console.error('[RulesHandler] Error fetching rules:', err);
    throw new Error('Failed to fetch rules.');
  }
}

/**
 * Speichert Regeln, Bedingungen und Aktionen. Verarbeitet Hinzufügen, Aktualisieren, Löschen.
 * @param {sqlite3.Database} sqliteDB
 * @param {Array<object>} rulesFromFrontend - Verschachtelte Regelstruktur vom Frontend.
 * @returns {Promise<void>}
 */
async function saveRules(sqliteDB, rulesFromFrontend) {
    console.log(`[RulesHandler] Saving ${rulesFromFrontend.length} rules (with conditions/actions)...`);
    if (!Array.isArray(rulesFromFrontend)) throw new Error("'rules' must be an array.");

    return new Promise(async (resolve, reject) => {
        // Starte Transaktion
        sqliteDB.run('BEGIN TRANSACTION', async (beginErr) => {
            if (beginErr) {
                console.error("[RulesHandler] Begin Transaction Error:", beginErr);
                return reject(beginErr);
            }
            try {
                // Hole IDs aller Regeln aus dem Frontend (nur die, die eine ID haben)
                const frontendRuleIds = new Set(rulesFromFrontend.map(r => r.id).filter(id => id != null));
                // Hole IDs aller Regeln aus der Datenbank
                const dbRules = await runDbQuery(sqliteDB, 'SELECT id FROM rules');
                const dbRuleIds = new Set(dbRules.map(r => r.id));

                // 1. Lösche Regeln, die in der DB, aber nicht mehr im Frontend-Datenpaket sind
                const rulesToDelete = [...dbRuleIds].filter(id => !frontendRuleIds.has(id));
                if (rulesToDelete.length > 0) {
                    console.log('[RulesHandler] Deleting rules with IDs:', rulesToDelete);
                    // ON DELETE CASCADE in der DB sollte zugehörige Conditions/Actions löschen
                    await runDbQuery(sqliteDB, `DELETE FROM rules WHERE id IN (${rulesToDelete.map(() => '?').join(',')})`, rulesToDelete, 'run');
                }

                // Bereite SQL-Statements vor
                const updateRuleSql = `UPDATE rules SET name=?, condition_logic=?, enabled=?, updated_at=strftime('%Y-%m-%dT%H:%M','now', 'localtime') WHERE id=?`;
                const insertRuleSql = `INSERT INTO rules (name, condition_logic, enabled, created_at, updated_at) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M','now', 'localtime'), strftime('%Y-%m-%dT%H:%M','now', 'localtime'))`;
                const deleteConditionsSql = `DELETE FROM rule_conditions WHERE rule_id=?`;
                const insertConditionSql = `INSERT INTO rule_conditions (rule_id, trigger_variable_name, operator, trigger_value, created_at, updated_at) VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M','now', 'localtime'), strftime('%Y-%m-%dT%H:%M','now', 'localtime'))`;
                const deleteActionsSql = `DELETE FROM rule_actions WHERE rule_id=?`;
                const insertActionSql = `INSERT INTO rule_actions (rule_id, target_variable_name, action_type, target_value, created_at, updated_at) VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M','now', 'localtime'), strftime('%Y-%m-%dT%H:%M','now', 'localtime'))`;

                const updateStmt = sqliteDB.prepare(updateRuleSql);
                const insertStmt = sqliteDB.prepare(insertRuleSql);
                const deleteConditionsStmt = sqliteDB.prepare(deleteConditionsSql);
                const insertConditionStmt = sqliteDB.prepare(insertConditionSql);
                const deleteActionsStmt = sqliteDB.prepare(deleteActionsSql);
                const insertActionStmt = sqliteDB.prepare(insertActionSql);

                // 2. Aktualisiere bestehende und füge neue Regeln hinzu
                for (const rule of rulesFromFrontend) {
                    // Grundlegende Validierung der Regelstruktur
                    if (!Array.isArray(rule.conditions) || !Array.isArray(rule.actions)) {
                       console.warn('[RulesHandler] Skipping invalid rule (missing conditions/actions array):', rule.name);
                       continue;
                    }

                    let currentRuleId = rule.id;
                    // Validiere condition_logic
                    const conditionLogic = rule.condition_logic === 'OR' ? 'OR' : 'AND';
                    const enabled = rule.enabled !== false ? 1 : 0; // Konvertiere zu 0/1

                    if (currentRuleId != null && dbRuleIds.has(currentRuleId)) {
                        // --- Bestehende Regel aktualisieren ---
                        console.log(`[RulesHandler] Updating rule ID: ${currentRuleId}`);
                        await new Promise((res, rej) => updateStmt.run(
                            rule.name || null,
                            conditionLogic,
                            enabled,
                            currentRuleId,
                            (err) => err ? rej(err) : res())
                        );
                    } else {
                        // --- Neue Regel einfügen ---
                        console.log('[RulesHandler] Inserting new rule:', rule.name);
                        const result = await new Promise((res, rej) => insertStmt.run(
                            rule.name || null,
                            conditionLogic,
                            enabled,
                            function(err) { // Brauchen function für this.lastID
                                if (err) rej(err);
                                else res({ lastID: this.lastID });
                            })
                        );
                        currentRuleId = result.lastID; // ID der neu eingefügten Regel holen
                        console.log(`[RulesHandler] Inserted new rule with ID: ${currentRuleId}`);
                    }

                    // Wenn keine ID vorhanden/ermittelt wurde, können keine Bedingungen/Aktionen gespeichert werden
                    if (currentRuleId == null) {
                        console.error("[RulesHandler] Could not get valid ID for rule, skipping conditions/actions for:", rule.name);
                        continue;
                    }

                    // 3. Ersetze Bedingungen für diese Regel
                    console.log(`[RulesHandler] Updating conditions for rule ID: ${currentRuleId}`);
                    // Alte Bedingungen löschen
                    await new Promise((res, rej) => deleteConditionsStmt.run(currentRuleId, (err) => err ? rej(err) : res()));
                    // Neue Bedingungen einfügen
                    for (const cond of rule.conditions) {
                         // Bedingung validieren
                         if (!cond.trigger_variable_name || cond.operator == null || cond.trigger_value == null) {
                            console.warn(`[RulesHandler] Skipping invalid condition for rule ID ${currentRuleId}:`, cond);
                            continue;
                         }
                         await new Promise((res, rej) => insertConditionStmt.run(
                             currentRuleId,
                             cond.trigger_variable_name,
                             cond.operator || '=', // Default-Operator '='
                             String(cond.trigger_value), // Als Text speichern
                             (err) => err ? rej(err) : res()
                         ));
                    }
                    console.log(`[RulesHandler] Inserted ${rule.conditions.length} conditions for rule ID: ${currentRuleId}`);

                    // 4. Ersetze Aktionen für diese Regel
                    console.log(`[RulesHandler] Updating actions for rule ID: ${currentRuleId}`);
                    // Alte Aktionen löschen
                    await new Promise((res, rej) => deleteActionsStmt.run(currentRuleId, (err) => err ? rej(err) : res()));
                    // Neue Aktionen einfügen
                    for (const action of rule.actions) {
                         // Aktion validieren
                         if (!action.target_variable_name || !action.action_type || action.target_value == null) {
                            console.warn(`[RulesHandler] Skipping invalid action for rule ID ${currentRuleId}:`, action);
                            continue;
                         }
                         await new Promise((res, rej) => insertActionStmt.run(
                             currentRuleId,
                             action.target_variable_name,
                             action.action_type,
                             String(action.target_value), // Als Text speichern ('1'/'0' für boolean)
                             (err) => err ? rej(err) : res()
                         ));
                    }
                    console.log(`[RulesHandler] Inserted ${rule.actions.length} actions for rule ID: ${currentRuleId}`);
                } // Ende for-Schleife über Regeln

                // Finalisiere alle Prepared Statements
                await Promise.all([
                    new Promise((res, rej) => updateStmt.finalize(err => err ? rej(err) : res())),
                    new Promise((res, rej) => insertStmt.finalize(err => err ? rej(err) : res())),
                    new Promise((res, rej) => deleteConditionsStmt.finalize(err => err ? rej(err) : res())),
                    new Promise((res, rej) => insertConditionStmt.finalize(err => err ? rej(err) : res())),
                    new Promise((res, rej) => deleteActionsStmt.finalize(err => err ? rej(err) : res())),
                    new Promise((res, rej) => insertActionStmt.finalize(err => err ? rej(err) : res())),
                ]);

                // Transaktion abschließen
                sqliteDB.run('COMMIT', (commitErr) => {
                     if (commitErr) {
                         console.error("[RulesHandler] Commit Error:", commitErr);
                         sqliteDB.run('ROLLBACK'); // Versuch eines Rollbacks bei Commit-Fehler
                         reject(commitErr);
                     } else {
                         console.log("[RulesHandler] Rules saved successfully (Transaction committed).");
                         resolve();
                     }
                });
            } catch (processErr) {
                 // Fehler innerhalb der Transaktion -> Rollback
                 console.error("[RulesHandler] Error during save transaction, rolling back:", processErr);
                 sqliteDB.run('ROLLBACK', rollbackErr => {
                     if (rollbackErr) console.error("[RulesHandler] Rollback Error:", rollbackErr);
                 });
                 reject(processErr);
            }
        }); // Ende sqliteDB.run('BEGIN TRANSACTION'...)
    }); // Ende new Promise
}


/**
 * Evaluiert Regeln mit mehreren Bedingungen (AND/OR) und mehreren Aktionen.
 * @param {sqlite3.Database} sqliteDB
 * @param {string} changedVariableName - Der NAME der Variable, deren Wert sich geändert hat.
 * @param {any} newValue - Der neue VAR_VALUE.
 */
async function evaluateRules(sqliteDB, changedVariableName, newValue) {
    console.log(`---> [RulesHandler] ENTER evaluateRules for '${changedVariableName}' = '${newValue}'`);
    try {
        // 1. Finde alle aktivierten Regeln, die die geänderte Variable in einer Bedingung verwenden
        const potentiallyAffectedRules = await runDbQuery(sqliteDB, `
            SELECT r.*
            FROM rules r
            JOIN rule_conditions rc ON r.id = rc.rule_id
            WHERE r.enabled = 1 AND rc.trigger_variable_name = ?
            GROUP BY r.id
        `, [changedVariableName]);

        if (potentiallyAffectedRules.length === 0) return;
        console.log(`[RulesHandler] Found ${potentiallyAffectedRules.length} potentially affected rule(s) by change in '${changedVariableName}'.`);

        // 2. Hole ALLE aktuellen Werte ALLER Variablen, die benötigt werden (Performance-Warnung!)
        const requiredVarNames = new Set();
        const rulesWithConditions = [];
        for (const rule of potentiallyAffectedRules) {
            const conditions = await runDbQuery(sqliteDB, 'SELECT * FROM rule_conditions WHERE rule_id = ?', [rule.id]);
            rulesWithConditions.push({ ...rule, conditions });
            conditions.forEach(cond => requiredVarNames.add(cond.trigger_variable_name));
        }
        const currentVariableValues = {};
        if (requiredVarNames.size > 0) {
            const placeholders = Array.from(requiredVarNames).map(() => '?').join(',');
            const dbValues = await runDbQuery(sqliteDB, `SELECT NAME, VAR_VALUE FROM QHMI_VARIABLES WHERE NAME IN (${placeholders})`, [...requiredVarNames]);
            dbValues.forEach(val => { currentVariableValues[val.NAME] = val.VAR_VALUE; });
            console.log(`[RulesHandler] Fetched ${dbValues.length} current variable values for evaluation.`);
        }
        currentVariableValues[changedVariableName] = newValue; // Überschreibe mit dem *neuen* Wert
        console.log(`[RulesHandler] Current values for evaluation context:`, currentVariableValues);


        // 3. Evaluiere jede potenziell betroffene Regel
        for (const rule of rulesWithConditions) {
            console.log(`[RulesHandler] Evaluating Rule ID ${rule.id} ('${rule.name || 'Unnamed'}') with logic '${rule.condition_logic}'`);
            let allConditionsMet = true; let anyConditionMet = false; let conditionEvaluationPossible = true;
            if (!rule.conditions || rule.conditions.length === 0) { console.warn(`[RulesHandler] Rule ID ${rule.id} has no conditions.`); continue; }

            // Prüfe jede Bedingung dieser Regel
            for (const condition of rule.conditions) {
                const variableName = condition.trigger_variable_name; const operator = condition.operator || '=';
                const triggerValue = condition.trigger_value; const currentValue = currentVariableValues[variableName];
                if (currentValue === undefined) { console.warn(`Value for '${variableName}' N/A.`); allConditionsMet = false; conditionEvaluationPossible = false; if (rule.condition_logic === 'AND') break; continue; }
                let conditionIsTrue = false;
                console.log(`[RulesHandler]   - Cond ID ${condition.id}: ${variableName} (current='${currentValue}') ${operator} (trigger='${triggerValue}')?`);
                // Vergleichslogik
                if (['>', '<', '>=', '<='].includes(operator)) { const numCurrent = parseFloat(currentValue); const numTrigger = parseFloat(triggerValue); if (!isNaN(numCurrent) && !isNaN(numTrigger)) { console.log(`     (Num: ${numCurrent} ${operator} ${numTrigger})`); switch (operator) { case '>': conditionIsTrue = numCurrent > numTrigger; break; case '<': conditionIsTrue = numCurrent < numTrigger; break; case '>=': conditionIsTrue = numCurrent >= numTrigger; break; case '<=': conditionIsTrue = numCurrent <= numTrigger; break; } } else { console.warn(`     (Num Comp Failed)`); conditionIsTrue = false; } }
                else if (operator === '!=') { console.log(`     (Str !=)`); conditionIsTrue = String(currentValue) !== String(triggerValue); }
                else { console.log(`     (Str ==)`); conditionIsTrue = String(currentValue) === String(triggerValue); }
                console.log(`[RulesHandler]   - Cond Result: ${conditionIsTrue}`);
                if (conditionIsTrue) { anyConditionMet = true; } else { allConditionsMet = false; }
                if (rule.condition_logic === 'AND' && !conditionIsTrue) break; // Abbruch bei AND
                if (rule.condition_logic === 'OR' && conditionIsTrue) break; // Abbruch bei OR
            }

            // 4. Entscheiden, ob die Regel als Ganzes zutrifft
            let ruleIsTrue = (rule.condition_logic === 'OR') ? anyConditionMet : allConditionsMet;
            if (rule.condition_logic === 'AND' && !conditionEvaluationPossible) { ruleIsTrue = false; } // Ungültig bei AND, wenn nicht alle prüfbar waren
            console.log(`[RulesHandler] Rule ID ${rule.id} Overall Result: ${ruleIsTrue}`);

            // 5. Wenn Regel zutrifft, Aktionen ausführen
            if (ruleIsTrue) {
                console.log(`---> [RulesHandler] RULE MATCH! Executing actions for Rule ID ${rule.id}`);
                try {
                    const actions = await runDbQuery(sqliteDB, 'SELECT * FROM rule_actions WHERE rule_id = ? ORDER BY id ASC', [rule.id]);
                    console.log(`[RulesHandler] Found ${actions.length} actions for rule ID ${rule.id}.`);
                    for (const action of actions) {
                        console.log(`[RulesHandler]   - Executing Action ID ${action.id}: Type='${action.action_type}', Target='${action.target_variable_name}', Value='${action.target_value}'`);
                        // Aktionstypen unterscheiden
                        if (action.action_type === 'set_visibility') {
                            const targetVisibleValue = action.target_value === '1' ? 1 : 0;
                            await performVariableUpdate('NAME', action.target_variable_name, 'visible', targetVisibleValue);
                            console.log(`[RulesHandler]   - Visibility update requested for '${action.target_variable_name}' to ${targetVisibleValue}.`);
                        } else if (action.action_type === 'set_logging_enabled') {
                            const targetEnabledValue = action.target_value === '1' ? 1 : 0;
                            const targetTopic = action.target_variable_name;
                            // WICHTIG: performLoggingSettingUpdate muss importiert sein und DB erwarten
                            await performLoggingSettingUpdate(targetTopic, 'enabled', targetEnabledValue, sqliteDB);
                            console.log(`[RulesHandler]   - Logging enable update requested for topic '${targetTopic}' to ${targetEnabledValue}.`);
                        }
                        // --- Hier später weitere action_types hinzufügen (z.B. 'set_value') ---
                        else {
                            console.warn(`[RulesHandler]   - Unknown action_type '${action.action_type}' for action ID ${action.id}. Skipped.`);
                        }
                    } // Ende Schleife über Aktionen
                } catch (actionError) {
                    console.error(`[RulesHandler] Error executing actions for rule ${rule.id}:`, actionError);
                }
            } // Ende if ruleIsTrue
        } // Ende Schleife über potenziell betroffene Regeln

         console.log(`[RulesHandler] Finished evaluating rules triggered by '${changedVariableName}'.`);
    } catch (err) {
        console.error(`[RulesHandler] GENERAL Error during rule evaluation for variable '${changedVariableName}':`, err);
    }
}


/**
 * Richtet Socket.IO Event Listener für Regeln ein.
 * @param {import('socket.io').Server} io
 * @param {sqlite3.Database} sqliteDB
 */
function setupRulesHandlers(io, sqliteDB) {
    io.on('connection', (socket) => {
        console.log(`[RulesHandler] Client ${socket.id} connected, setting up rule listeners.`);

        // Client fragt Regeln an -> Sende verschachtelte Struktur
        socket.on('request-visibility-rules', async () => { // Event-Name wird beibehalten
            console.log(`[RulesHandler] Client ${socket.id} requested rules.`);
            try {
                const rules = await fetchRules(sqliteDB); // Neue Funktion
                socket.emit('visibility-rules-update', rules); // Event-Name wird beibehalten
            } catch (err) {
                 console.error(`[RulesHandler] Error fetching rules for ${socket.id}:`, err);
                 socket.emit('visibility-rules-error', { message: 'Error loading rules.' });
             }
        });

        // Client sendet Regel-Updates -> Speichere verschachtelte Struktur
        socket.on('update-visibility-rules', async (rulesData) => { // Event-Name wird beibehalten
            console.log(`[RulesHandler] Received 'update-visibility-rules' from ${socket.id}.`);
             if (!rulesData || !Array.isArray(rulesData)) {
                 console.error(`[RulesHandler] Invalid data format.`);
                 socket.emit('visibility-rules-error', { message: 'Invalid data format.' });
                 return;
             }
            try {
                await saveRules(sqliteDB, rulesData); // Neue Funktion
                socket.emit('visibility-rules-success', { message: 'Rules saved successfully.' });
                // Sende die aktualisierten Regeln an alle Clients
                const updatedRules = await fetchRules(sqliteDB);
                io.emit('visibility-rules-update', updatedRules);
                console.log(`[RulesHandler] Successfully saved rules and broadcasted update.`);
            } catch (err) {
                 console.error(`[RulesHandler] Error saving rules for ${socket.id}:`, err);
                 socket.emit('visibility-rules-error', { message: `Error saving rules: ${err.message}` });
             }
        });
    });
}

// Exportiere die korrekten Funktionsnamen
module.exports = {
  fetchRules,
  saveRules,
  evaluateRules, // Wichtig: Dieser Name wird jetzt verwendet!
  setupRulesHandlers,
};