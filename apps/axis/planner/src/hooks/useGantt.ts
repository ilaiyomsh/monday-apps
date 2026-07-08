import { useContext } from 'react';
import { GanttContext } from '../components/Gantt/GanttContext';

export const useGantt = () => {
  const context = useContext(GanttContext);
  if (!context) throw new Error('useGantt must be used within a GanttProvider');
  return context;
};
