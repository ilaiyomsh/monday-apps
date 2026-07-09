import React, { useRef, useState } from 'react';
import { Dialog, DialogContentContainer, Avatar, AvatarGroup } from '@vibe/core';
import { StatusBadge } from '@generated/components/StatusBadge';
import { PersonPicker } from '@generated/components/PersonPicker';
import { DatePickerPopover } from '@generated/components/DatePickerPopover';
import { useStatusOptions } from '@generated/hooks/useStatusOptions';
import { computeFloatingPosition } from '@generated/utils/overlayPlacement';
import styles from './TaskCard.module.css';

function initialsOf(name) {
  return (name || '?').split(' ').map((n) => n[0]).join('').slice(0, 2);
}

export function TaskCard({ task, onStatusChange, onAssigneeChange, onDeadlineChange, showSource = false, extra }) {
  const { options: statusOptions, labelById, colorById, doneId } = useStatusOptions();
  const deadline = task.deadlineID;
  const isOverdue = deadline && deadline < new Date() && doneId != null && task.statusID !== doneId;
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusPosition, setStatusPosition] = useState('bottom-end');
  const statusTriggerRef = useRef(null);

  const updateStatusPosition = () => {
    const rect = statusTriggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = computeFloatingPosition({
      anchorRect: rect,
      preferred: 'bottom-end',
      popupWidth: 180,
      popupHeight: Math.max(160, statusOptions.length * 34 + 20),
      offset: 4,
    });
    if (next?.placement) setStatusPosition(next.placement);
  };

  const statusBadge = (
    <StatusBadge label={labelById[task.statusID]} color={colorById[task.statusID]} />
  );

  return (
    <div className={styles.card}>
      <div className={styles.mainRow}>
        {/* Task name — takes remaining space */}
        <span className={styles.title}>{task.name}</span>

        {/* Assignee: editable picker or read-only avatars */}
        {onAssigneeChange ? (
          <div className={styles.assigneeCell}>
            <PersonPicker
              selected={task.responsibilityID || []}
              onChange={(people) => onAssigneeChange(task.id, people)}
              closeOnSelect
              single
              boardKey="tasks"
            />
          </div>
        ) : (
          task.responsibilityID?.length > 0 && (
            <AvatarGroup size="small" max={3}>
              {(task.responsibilityID || []).map((p) => (
                <Avatar
                  key={p.id}
                  size="small"
                  src={p.photo_thumb}
                  text={initialsOf(p.name)}
                  type={p.photo_thumb ? 'img' : 'text'}
                  ariaLabel={p.name}
                />
              ))}
            </AvatarGroup>
          )
        )}

        {/* Deadline: editable picker or read-only tag */}
        {onDeadlineChange ? (
          <div className={styles.deadlineCell}>
            <DatePickerPopover value={deadline} onChange={(date) => onDeadlineChange(task.id, date)} />
          </div>
        ) : (
          deadline && (
            <span className={`${styles.deadline} ${isOverdue ? styles.deadlineOverdue : styles.deadlineNormal}`}>
              {deadline.toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: '2-digit' })}
            </span>
          )
        )}

        {/* Status badge / picker */}
        {onStatusChange ? (
          <Dialog
            open={statusOpen}
            showTrigger={['click']}
            hideTrigger={['clickoutside', 'esc', 'onContentClick']}
            onDialogDidShow={() => { updateStatusPosition(); setStatusOpen(true); }}
            onDialogDidHide={() => setStatusOpen(false)}
            position={statusPosition}
            content={() => (
              <DialogContentContainer>
                <div className={styles.statusMenu}>
                  {statusOptions.map((opt) => (
                    <div
                      key={opt.id}
                      role="option"
                      aria-selected={task.statusID === opt.id}
                      className={`${styles.statusItem} ${task.statusID === opt.id ? styles.statusItemSelected : ''}`}
                      style={{ background: opt.color || 'hsl(var(--status-default))' }}
                      onClick={() => { onStatusChange(task.id, opt.id); setStatusOpen(false); }}
                    >
                      {opt.label}
                    </div>
                  ))}
                </div>
              </DialogContentContainer>
            )}
          >
            <button ref={statusTriggerRef} type="button" className={styles.statusTrigger} onMouseDown={updateStatusPosition}>
              {statusBadge}
            </button>
          </Dialog>
        ) : statusBadge}

        {showSource && task.detailsID && (
          <span className={styles.sourceTag}>{task.detailsID}</span>
        )}
      </div>
      {extra}
    </div>
  );
}

export default TaskCard;
