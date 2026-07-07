import React from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ProjectColorsTab from '../SettingsDialog/ProjectColorsTab';
import styles from './ProjectColorsDialog.module.css';

/**
 * דיאלוג עצמאי לעריכת צבעי פרויקטים — נפתח מאייקון בטולבר היומן.
 * חשוף לכל משתמש, לא תלוי בהרשאות.
 */
const ProjectColorsDialog = ({ isOpen, onClose }) => {
    const { t } = useTranslation();
    if (!isOpen) return null;

    return (
        <div
            className={styles.overlay}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className={styles.dialog} role="dialog" aria-modal="true">
                <div className={styles.header}>
                    <h2 className={styles.title}>{t('settings.projectColors.title')}</h2>
                    <button
                        type="button"
                        className={styles.closeBtn}
                        onClick={onClose}
                        aria-label={t('eventModal.closeAria')}
                    >
                        <X size={20} />
                    </button>
                </div>
                <div className={styles.body}>
                    <ProjectColorsTab />
                </div>
            </div>
        </div>
    );
};

export default ProjectColorsDialog;
