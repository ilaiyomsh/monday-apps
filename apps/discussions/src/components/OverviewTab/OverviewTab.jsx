import React from 'react';
import { Text } from '@vibe/core';
import { PersonList } from '@generated/components/PersonAvatar';
import { useTemplates } from '@generated/contexts/TemplatesContext.jsx';
import styles from './OverviewTab.module.css';

export function OverviewTab({ discussion }) {
  // "סוג" is a dropdown value = the label TEXT; its color comes from app storage.
  const { typeColor } = useTemplates();
  const typeLabel = discussion.discussionTypeID || null;
  const participants = discussion.participantsID || [];
  const date = discussion.discussionDateID;
  const totalTopics = discussion.totalTopicsID;
  const totalTasks = discussion.completionPctID;
  const executionPct = discussion.totalTasksID;
  const delayPct = discussion.completedTasksID;
  const leader = discussion.delayedPctID;

  return (
    <div className={styles.root}>
      <div className={styles.statGrid}>
        <div className={styles.statCard}>
          <div className={styles.statStripe} style={{ backgroundColor: 'hsl(var(--dept-legal))' }} />
          <div className={styles.statBody}>
            <p className={styles.statValue}>{totalTopics || '0'}</p>
            <p className={styles.statLabel}>נושאים</p>
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statStripe} style={{ backgroundColor: 'hsl(var(--status-done))' }} />
          <div className={styles.statBody}>
            <p className={styles.statValue}>{totalTasks || '0'}</p>
            <p className={styles.statLabel}>משימות</p>
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statStripe} style={{ backgroundColor: 'hsl(var(--dept-hr))' }} />
          <div className={styles.statBody}>
            <p className={styles.statValue}>{executionPct || '0%'}</p>
            <p className={styles.statLabel}>ביצוע</p>
          </div>
        </div>
      </div>

      <div className={styles.detailsCard}>
        <div className={styles.detailsBody}>
          <div className={styles.detailRow}>
            <span className={styles.detailKey}>תאריך</span>
            <span className={styles.detailValue}>
              {date ? date.toLocaleDateString('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : 'לא נקבע'}
            </span>
          </div>

          {typeLabel && (
            <div className={styles.detailRow}>
              <span className={styles.detailKey}>סוג</span>
              <span className={styles.detailValue} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: typeColor(typeLabel) }} />
                {typeLabel}
              </span>
            </div>
          )}

          {leader && leader.length > 0 && (
            <div className={styles.detailRow}>
              <span className={styles.detailKey}>מוביל/ת</span>
              <PersonList people={leader} showNames={true} max={3} />
            </div>
          )}

          <div className={styles.participantsBlock}>
            <span className={styles.detailKey}>משתתפים</span>
            <div className={styles.participantsList}>
              {participants.length > 0 ? (
                <PersonList people={participants} showNames={true} max={10} />
              ) : (
                <Text type={"text2"} className={styles.muted}>לא הוגדרו משתתפים</Text>
              )}
            </div>
          </div>

          {delayPct && (
            <div className={styles.detailRow}>
              <span className={styles.detailKey}>עיכוב</span>
              <span className={styles.delayValue}>{delayPct}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
