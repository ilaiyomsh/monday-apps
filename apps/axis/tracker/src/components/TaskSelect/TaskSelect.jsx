import React, { useEffect, useRef, useState, useCallback } from 'react';
import styles from './TaskSelect.module.css';
import { useStableT } from '../../i18n/useStableT';
import { useLocale } from '../../hooks/useLocale';
import { computeDropdownPosition } from '../../utils/dropdownAnchor';

/**
 * רכיב Dropdown למשימות עם אפשרות לחיפוש והוספת משימה חדשה
 */
const TaskSelect = ({
    products: tasks,
    selectedProduct: selectedTask,
    onSelectProduct: onSelectTask,
    onCreateNew,
    isLoading,
    disabled,
    isCreatingProduct: isCreatingTask = false,
    placeholder
}) => {
    const t = useStableT();
    const { dir } = useLocale();
    const resolvedPlaceholder = placeholder ?? t('common.taskSelect.placeholder');
    const [isOpen, setIsOpen] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [newTaskName, setNewTaskName] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [dropdownPosition, setDropdownPosition] = useState({ top: 'auto', bottom: 'auto', width: 'auto' });
    const containerRef = useRef(null);
    const inputRef = useRef(null);
    const searchInputRef = useRef(null);
    const dropdownRef = useRef(null);

    // סינון משימות לפי החיפוש
    const filteredTasks = tasks.filter(task => 
        task.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // בדיקה אם יש התאמה - להצגת הצעה ליצירה
    const showCreateSuggestion = searchTerm.trim().length > 0 && filteredTasks.length === 0;

    // חישוב מיקום ה-dropdown
    const calculateDropdownPosition = useCallback(() => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        setDropdownPosition(computeDropdownPosition({ triggerRect: rect, dir }));
    }, [dir]);

    useEffect(() => {
        if (isOpen) {
            calculateDropdownPosition();
            // פוקוס על תיבת החיפוש כשהדרופדאון נפתח
            setTimeout(() => searchInputRef.current?.focus(), 0);
            const handleScroll = () => calculateDropdownPosition();
            const handleResize = () => calculateDropdownPosition();
            window.addEventListener('scroll', handleScroll, true);
            window.addEventListener('resize', handleResize);
            return () => {
                window.removeEventListener('scroll', handleScroll, true);
                window.removeEventListener('resize', handleResize);
            };
        }
    }, [isOpen, calculateDropdownPosition]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpen(false);
                setIsCreating(false);
                setNewTaskName('');
                setSearchTerm('');
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const selectedOption = tasks.find(t => t.id === selectedTask);

    const handleSelect = (taskId) => {
        onSelectTask(taskId);
        setIsOpen(false);
        setSearchTerm('');
    };

    const handleCreateClick = () => {
        setIsCreating(true);
        // אם יש searchTerm, נשתמש בו כשם המשימה החדשה
        if (searchTerm.trim()) {
            setNewTaskName(searchTerm);
        }
        setTimeout(() => inputRef.current?.focus(), 0);
    };

    const handleCreateTask = async () => {
        if (newTaskName.trim()) {
            await onCreateNew(newTaskName);
            setNewTaskName('');
            setIsCreating(false);
            setIsOpen(false);
            setSearchTerm('');
        }
    };

    // יצירת משימה חדשה ישירות מהחיפוש (כשאין התאמה)
    const handleCreateFromSearch = async () => {
        if (searchTerm.trim()) {
            await onCreateNew(searchTerm);
            setSearchTerm('');
            setIsOpen(false);
        }
    };

    const handleKeyDown = async (e) => {
        if (e.key === 'Enter') await handleCreateTask();
        else if (e.key === 'Escape') {
            setIsCreating(false);
            setNewTaskName('');
        }
    };

    // טיפול ב-Enter בתיבת החיפוש - יצירה ישירה אם אין התאמה
    const handleSearchKeyDown = async (e) => {
        if (e.key === 'Enter' && showCreateSuggestion) {
            await handleCreateFromSearch();
        } else if (e.key === 'Escape') {
            setSearchTerm('');
            setIsOpen(false);
        }
    };

    return (
        <div className={styles.container} ref={containerRef}>
            <div 
                className={`${styles.trigger} ${disabled ? styles.disabled : ''}`}
                onClick={() => !disabled && !isLoading && setIsOpen(!isOpen)}
            >
                <span className={styles.triggerText}>
                    {isCreatingTask
                        ? t('common.taskSelect.creating')
                        : (selectedOption
                            ? selectedOption.name
                            : (isLoading ? t('common.loading') : resolvedPlaceholder)
                        )
                    }
                </span>
                <div className={styles.triggerIcon}>
                    {isLoading ? "⏳" : (isOpen ? "▲" : "▼")}
                </div>
            </div>

            {isOpen && !disabled && (
                <div
                    ref={dropdownRef}
                    className={styles.dropdown}
                    style={dropdownPosition}
                >
                    {/* תיבת חיפוש */}
                    <div className={styles.searchContainer}>
                        <input
                            ref={searchInputRef}
                            type="text"
                            className={styles.searchInput}
                            placeholder={t('common.taskSelect.searchPlaceholder')}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            onKeyDown={handleSearchKeyDown}
                            onClick={(e) => e.stopPropagation()}
                        />
                        <div className={styles.searchIcon}>🔍</div>
                    </div>

                    <div className={styles.tasksList}>
                        {filteredTasks.length > 0 ? (
                            filteredTasks.map((task) => (
                                <div
                                    key={task.id}
                                    className={`${styles.taskItem} ${
                                        selectedTask === task.id ? styles.selected : ''
                                    }`}
                                    onClick={() => handleSelect(task.id)}
                                >
                                    {task.name}
                                </div>
                            ))
                        ) : showCreateSuggestion ? (
                            // הצעה ליצירת משימה חדשה כשאין התאמה
                            <div 
                                className={styles.createSuggestion}
                                onClick={handleCreateFromSearch}
                            >
                                <span className={styles.createSuggestionIcon}>+</span>
                                <span>{t('common.taskSelect.createSuggestion', { term: searchTerm })}</span>
                            </div>
                        ) : (
                            <div className={styles.emptyState}>
                                {t('common.taskSelect.noTasks')}
                            </div>
                        )}
                    </div>

                    <div className={styles.footer}>
                        {!isCreating ? (
                            <button onClick={handleCreateClick} className={styles.addButton}>
                                {t('common.taskSelect.addNew')}
                            </button>
                        ) : (
                            <div className={styles.createForm}>
                                <input
                                    ref={inputRef}
                                    type="text"
                                    placeholder={t('common.taskSelect.newTaskName')}
                                    value={newTaskName}
                                    onChange={(e) => setNewTaskName(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    className={styles.createInput}
                                />
                                <button onClick={handleCreateTask} className={styles.createButton}>✓</button>
                                <button onClick={() => { setIsCreating(false); setNewTaskName(''); }} className={styles.cancelButton}>✕</button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default TaskSelect;
