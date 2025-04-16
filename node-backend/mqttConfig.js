// node-backend/mqttConfig.js

/**
 * Zentrale Konfiguration für MQTT-Topics.
 * Dies erleichtert die Verwaltung und Änderung der Topics an einer Stelle.
 */
module.exports = {
    // === EINGEHENDE Topics (Backend abonniert diese) ===

    /**
     * Topic für eingehende Rohdaten (z.B. von Modbus, SPS).
     * Wird verarbeitet, um Variablenwerte zu aktualisieren und Alarme auszuwerten.
     */
    INCOMING_MODBUS_DATA: 'modbus/data',

    /**
     * Topic, auf das das Backend hört, um Alarm-Quittierungs-Antworten (z.B. von einer HMI) zu empfangen.
     * Wenn eine Nachricht hier empfangen wird (z.B. "false"), wird dies über Socket.IO an das Frontend gesendet.
     * Der Wert kann über die Umgebungsvariable MQTT_ALARM_ACK_TOPIC überschrieben werden.
     */
    INCOMING_ALARM_ACK_RESPONSE: process.env.MQTT_ALARM_ACK_RESPONSE_TOPIC || 'visu/alarm/acknowledge/response', // Eindeutiger machen?

    // === AUSGEHENDE Topics (Backend sendet an diese) ===

    /**
     * Topic, an das aktualisierte Variablenwerte gesendet werden
     * (ersetzt den alten HTTP POST an Node-RED).
     * Payload: { "name": "VARIABLENNAME", "value": "NEUER_WERT" }
     */
    OUTGOING_VARIABLE_UPDATE: 'visu/variable/update',

    /**
     * Topic für Statusmeldungen nach einem CSV-Variablenimport.
     * Payload: { "status": "success" | "error", "message": "...", "details": {...}, "errors": [...] }
     */
    OUTGOING_IMPORT_STATUS: 'visu/import/status',

    /**
     * Topic, an das die Liste der aktuell aktiven Alarme gesendet wird.
     * Payload: Array von Alarm-Objekten (wie an Socket.IO gesendet).
     */
    OUTGOING_ACTIVE_ALARMS: 'visu/alarm/data',

    /**
     * Topic, an das eine Alarm-Quittierungsanforderung (Reset) vom Backend gesendet wird,
     * typischerweise wenn ein Benutzer im Frontend auf "Reset" klickt.
     * Payload: "true" (oder ein anderes definiertes Signal).
     * Das Zielsystem (z.B. HMI, SPS) sollte darauf reagieren und ggf. eine Antwort
     * an INCOMING_ALARM_ACK_RESPONSE senden.
     */
    OUTGOING_ALARM_ACK_REQUEST: process.env.MQTT_ALARM_ACK_REQUEST_TOPIC || 'visu/alarm/acknowledge', // Eindeutiger machen?

    // === Weitere Topics nach Bedarf ===
    // Beispiel: OUTGOING_SYSTEM_STATUS: 'visu/system/status',

        /**
     * Topic, an das eine Nachricht gesendet wird, wenn ein Alarm NEU AKTIV wird.
     * Payload: { definitionId, timestamp, status: 'active', identifier, bitNumber, rawValue, alarmTextKey, priority }
     */
    OUTGOING_NEW_ALARM_EVENT: 'visu/alarm/new', // Beispiel-Topic
};