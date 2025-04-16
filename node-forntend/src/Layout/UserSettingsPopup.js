// src/Layout/UserSettingsPopup.js
import React from 'react';
import { Modal, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useUser } from '../UserContext'; // Importiere den User-Context

const { Title, Text } = Typography;

const UserSettingsPopup = ({ visible, onClose }) => {
    const { t } = useTranslation();
    const { user } = useUser(); // Hole den aktuellen Benutzer

    return (
        <Modal
            title={t('userSettingsTitle', 'Benutzereinstellungen')}
            open={visible}
            onCancel={onClose}
            footer={null} // Kein Standard-Footer (OK/Cancel)
            width={400} // Beispielbreite
        >
            {user ? (
                <div>
                    <Title level={4}>{t('currentUser', 'Aktueller Benutzer')}:</Title>
                    <Text strong style={{ fontSize: '1.2em' }}>{user}</Text>
                    {/* Hier könnten weitere Einstellungen hinzugefügt werden */}
                    {/* z.B. Button "PIN ändern", "Abmelden" etc. */}
                    <div style={{ marginTop: '20px', color: 'grey' }}>
                        ({t('userSettingsPlaceholder', 'Weitere Einstellungen folgen...')})
                    </div>
                </div>
            ) : (
                 <Text>{t('notLoggedIn', 'Nicht angemeldet.')}</Text>
            )}
        </Modal>
    );
};

export default UserSettingsPopup;