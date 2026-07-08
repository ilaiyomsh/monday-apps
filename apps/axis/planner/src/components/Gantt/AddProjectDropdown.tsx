import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../contexts/SettingsContext';
import { useLocale } from '../../hooks/useLocale';
import { classifyProject, isClassificationEnabled, CLASSIFICATION_LABEL_KEYS, CLASSIFICATION_ORDER } from '../../utils/projectClassification';
import type { ProjectClassification } from '../../types/gantt.types';

interface AddProjectDropdownProps {
  activeProjects: Array<{id: string, name: string, [key: string]: any}> | null;
  allProjects: Array<{id: string, name: string, [key: string]: any}> | null;
  visibleGroupIds: string[];
  onSelect: (projectId: string, projectName: string) => void;
  loading?: boolean;
  onOpen?: () => void; // called once when dropdown is opened — triggers lazy project fetch
}

/**
 * AddProjectDropdown - Shows a "+" button that opens a dropdown of active projects
 * that are not currently visible in the Gantt (projects without allocations).
 */
export const AddProjectDropdown: React.FC<AddProjectDropdownProps> = ({
  activeProjects,
  allProjects,
  visibleGroupIds,
  onSelect,
  loading = false,
  onOpen,
}) => {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const locale = useLocale();

  // Show only active projects (not completed) so the "+" button doesn't offer finished projects
  const availableProjects = activeProjects ?? allProjects;
  // Only show in-flight loading on the button — `availableProjects === null` just means
  // the lazy fetch hasn't been triggered yet, and the user's click is what triggers it.
  const isLoading = loading;

  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });

  // Calculate dropdown position from trigger button
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setDropdownPos({
      top: rect.bottom + 4,
      left: rect.left,
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
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen, updatePosition]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  // Filter to show only projects that are NOT currently visible
  const hiddenProjects = useMemo(() => {
    if (!availableProjects) return [];
    const visibleSet = new Set(visibleGroupIds);
    return availableProjects.filter(p => !visibleSet.has(p.id.toString()));
  }, [availableProjects, visibleGroupIds]);

  // Apply search filter
  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return hiddenProjects;
    const query = searchQuery.toLowerCase();
    return hiddenProjects.filter(p => p.name.toLowerCase().includes(query));
  }, [hiddenProjects, searchQuery]);

  // Partition by classification (when feature is enabled), preserving order within each bucket
  const classificationOn = isClassificationEnabled(settings);
  const sections = useMemo(() => {
    if (!classificationOn) return null;
    const buckets = new Map<ProjectClassification, typeof filteredProjects>();
    for (const cls of CLASSIFICATION_ORDER) buckets.set(cls, []);
    filteredProjects.forEach(p => {
      const cls = classifyProject(p, settings);
      buckets.get(cls)!.push(p);
    });
    return CLASSIFICATION_ORDER
      .map(cls => ({ cls, projects: buckets.get(cls)! }))
      .filter(s => s.projects.length > 0);
  }, [classificationOn, filteredProjects, settings]);

  // Handle project selection
  const handleSelect = (projectId: string, projectName: string) => {
    onSelect(projectId, projectName);
    setIsOpen(false);
    setSearchQuery('');
  };

  const allVisible = !isLoading && availableProjects !== null && hiddenProjects.length === 0;

  return (
    <div className="relative flex-shrink-0">
      {/* Add Button */}
      <button
        ref={triggerRef}
        onClick={() => {
          if (isLoading || allVisible) return;
          if (!isOpen) onOpen?.();
          setIsOpen(!isOpen);
        }}
        disabled={isLoading || allVisible}
        className={`w-[32px] h-[32px] flex items-center justify-center bg-bg-surface border border-border-subtle rounded-lg transition-all duration-150 ${
          isLoading || allVisible
            ? 'opacity-40 cursor-not-allowed'
            : 'hover:bg-bg-hover hover:border-border-default hover:scale-105 hover:shadow-md'
        }`}
        title={isLoading ? t('addProject.loading') : allVisible ? t('addProject.allShown') : t('addProject.button')}
      >
        {isLoading ? (
          <svg
            className="w-4 h-4 text-text-subtle animate-spin"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        ) : (
          <svg
            className="w-4 h-4 text-text-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && createPortal(
        <div
          ref={dropdownRef}
          className="fixed bg-bg-surface rounded-lg shadow-xl border border-border-subtle z-[9999] w-64"
          dir={locale.dir}
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          {/* Search Input */}
          <div className="p-2 border-b border-border-faint">
            <div className="relative">
              <input
                ref={searchInputRef}
                type="text"
                placeholder={t('addProject.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-[32px] ps-3 pe-8 border border-border-subtle rounded-lg text-sm bg-bg-surface focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all placeholder:text-text-subtle"
                dir={locale.dir}
              />
              <svg
                className="absolute end-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-subtle pointer-events-none"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>

          {/* Project List */}
          <div className="max-h-60 overflow-y-auto p-1">
            {isLoading || availableProjects === null ? (
              <div className="px-3 py-4 text-center text-sm text-text-muted">
                {t('addProject.loading')}
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-text-muted">
                {searchQuery ? t('addProject.noResults') : t('addProject.allAlreadyShown')}
              </div>
            ) : classificationOn && sections ? (
              sections.map(({ cls, projects }) => (
                <div key={cls}>
                  <div className="px-3 py-1.5 text-xs font-semibold text-text-muted bg-bg-app sticky top-0">
                    {t(CLASSIFICATION_LABEL_KEYS[cls])}
                    <span className="mr-1 text-text-subtle">({projects.length})</span>
                  </div>
                  {projects.map(project => (
                    <button
                      key={project.id}
                      onClick={() => handleSelect(project.id, project.name)}
                      className="w-full text-right px-3 py-2 rounded-md text-sm transition-all duration-150 hover:bg-bg-hover text-text-secondary flex items-center gap-2"
                    >
                      <span className="w-2 h-2 rounded-full bg-bg-emphasis flex-shrink-0" />
                      <span className="truncate">{project.name}</span>
                    </button>
                  ))}
                </div>
              ))
            ) : (
              filteredProjects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => handleSelect(project.id, project.name)}
                  className="w-full text-right px-3 py-2 rounded-md text-sm transition-all duration-150 hover:bg-bg-hover text-text-secondary flex items-center gap-2"
                >
                  <span className="w-2 h-2 rounded-full bg-bg-emphasis flex-shrink-0" />
                  <span className="truncate">{project.name}</span>
                </button>
              ))
            )}
          </div>

          {/* Helper Text */}
          <div className="px-3 py-2 border-t border-border-faint text-xs text-text-subtle">
            {t('addProject.helper')}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
