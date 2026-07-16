import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Avatar } from './Avatar';
import { Employee } from '../../types/gantt.types';
import { useSettings } from '../../contexts/SettingsContext';
import { useGantt } from '../../hooks/useGantt';
import { mondayService } from '../../services/mondayService';
import { logger } from '../../utils/Logger';

interface PMSelectorProps {
  projectId: string;
  currentManagerName?: string;
  currentManagerPhotoUrl?: string;
  employees: Employee[];
  onUpdate: (newManagerId?: string) => void;
}

export const PMSelector: React.FC<PMSelectorProps> = ({
  projectId,
  currentManagerName,
  currentManagerPhotoUrl,
  employees,
  onUpdate
}) => {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const { patchProjectData } = useGantt();
  const [isOpen, setIsOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // Local override so only this component re-renders, not the whole app
  const [localPM, setLocalPM] = useState<{ name: string; photoUrl?: string } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });

  // All employees with userId can be PM candidates
  const pmCandidates = useMemo(() => {
    return employees.filter(emp => emp.userId);
  }, [employees]);

  // Filter by search query
  const filteredCandidates = useMemo(() => {
    if (!searchQuery.trim()) return pmCandidates;
    const query = searchQuery.toLowerCase();
    return pmCandidates.filter(emp => emp.name.toLowerCase().includes(query));
  }, [pmCandidates, searchQuery]);

  // Calculate dropdown position from trigger button
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    // Position dropdown below trigger, aligned to left edge
    let left = rect.left;
    const dropdownWidth = 220;
    // Keep dropdown within viewport
    if (left + dropdownWidth > window.innerWidth) {
      left = window.innerWidth - dropdownWidth - 8;
    }
    setDropdownPos({
      top: rect.bottom + 4,
      left,
    });
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    updatePosition();
    const handleClick = (e: MouseEvent) => {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        dropdownRef.current?.contains(e.target as Node)
      ) return;
      setIsOpen(false);
      setSearchQuery('');
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        setSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, updatePosition]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  const displayName = localPM?.name ?? currentManagerName;
  const displayPhoto = localPM?.photoUrl ?? currentManagerPhotoUrl;

  const handleSelectPM = async (employeeId: string) => {
    if (!settings?.projectsBoardId || !settings?.projectManagerColumnId) return;

    const employee = employees.find(e => e.id === employeeId);
    if (!employee?.userId) return;

    // Instant local update
    setLocalPM({ name: employee.name, photoUrl: employee.photoUrl });
    setIsUpdating(true);
    setIsOpen(false);
    setSearchQuery('');

    try {
      await mondayService.updateItem(
        settings.projectsBoardId,
        projectId,
        {
          [settings.projectManagerColumnId]: {
            personsAndTeams: [{ id: parseInt(employee.userId), kind: 'person' }]
          }
        }
      );
      patchProjectData(projectId, {
        [settings.projectManagerColumnId]: employee.name,
        [settings.projectManagerColumnId + '_id']: employee.userId,
      });
      // Bulk update allocation PM columns in background
      onUpdate(employee.userId);
    } catch (error) {
      logger.error('[PMSelector] Failed to update PM:', error);
      setLocalPM(null);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="relative min-w-0 flex">
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        disabled={isUpdating}
        // Border + background are hover-only (transparent border keeps the layout
        // from shifting on hover); at rest the PM reads as plain text + avatar.
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-transparent hover:border-border-faint hover:bg-bg-hover transition-all duration-150 hover:scale-[1.02] hover:shadow-md cursor-pointer min-w-0 max-w-full"
      >
        {displayName ? (
          <>
            <span dir="ltr" className="truncate font-medium text-text-secondary text-xs min-w-0 text-start">
              {displayName}
            </span>
            <Avatar name={displayName} url={displayPhoto} size={24} />
          </>
        ) : (
          <span className="text-xs text-text-muted">{t('pmSelector.selectManager')}</span>
        )}
        {isUpdating && <span className="w-4 h-4 border-2 border-border-default border-t-accent rounded-full animate-spin flex-shrink-0" />}
      </button>

      {isOpen && createPortal(
        <div
          ref={dropdownRef}
          className="fixed bg-bg-surface rounded-lg shadow-xl border border-border-subtle z-[9999] w-[220px]"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
          dir="rtl"
        >
          {/* Search Input */}
          <div className="p-2 border-b border-border-faint">
            <input
              ref={searchInputRef}
              type="text"
              placeholder={t('common.search')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-[32px] px-3 border border-border-subtle rounded-lg text-sm bg-bg-surface focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent placeholder:text-text-subtle"
              dir="rtl"
            />
          </div>

          {/* Candidates List */}
          <div className="max-h-[200px] overflow-y-auto py-1">
            {filteredCandidates.length === 0 ? (
              <div className="px-3 py-3 text-center text-sm text-text-subtle">
                {searchQuery ? t('common.noResults') : t('pmSelector.noEmployees')}
              </div>
            ) : (
              filteredCandidates.map(emp => (
                <button
                  key={emp.id}
                  onClick={() => handleSelectPM(emp.id)}
                  className="w-full px-3 py-2 flex items-center gap-2 hover:bg-accent-bg-soft text-right transition-all duration-150"
                >
                  <Avatar name={emp.name} size={24} />
                  <span className="text-sm truncate">{emp.name}</span>
                </button>
              ))
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
