// node-backend/mqttConfig.js

/**
 * Zentrale Konfiguration für MQTT-Topics.
 */
module.exports = {
    // === EINGEHENDE Topics (Backend abonniert diese) ===
    INCOMING_MODBUS_DATA: 'modbus/data',
    INCOMING_ALARM_ACK_RESPONSE: 'visu/alarm/acknowledge/response',

    // === AUSGEHENDE Topics (Backend sendet an diese) ===
    OUTGOING_VARIABLE_UPDATE: 'visu/variable/update',
    OUTGOING_IMPORT_STATUS: 'visu/import/status',
    OUTGOING_ALARM_ACK_REQUEST:  'visu/alarm/acknowledge',

    /**
     * Topic, an das spezifische Alarm-Benachrichtigungen gesendet werden,
     * wenn ein Alarm auftritt und die Kriterien (Mute, Priorität) erfüllt sind.
     * Payload: { type: 'email'|'phone', target: '...', alarm: { ...alarm details... } }
     */
    OUTGOING_ALARM_NOTIFICATION: 'notifications/outgoing',

    // --- Nicht mehr verwendet vom Backend ---
    // OUTGOING_NEW_ALARM_EVENT: 'visu/alarm/new',
    // OUTGOING_ACTIVE_ALARMS: 'visu/alarm/data',
    // --- Ende ---

    // === Weitere Topics nach Bedarf ===
};