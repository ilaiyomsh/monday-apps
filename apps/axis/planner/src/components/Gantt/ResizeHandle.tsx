import React, { useCallback, useEffect, useState, useRef } from 'react';
import { useGantt } from '../../hooks/useGantt';

export const ResizeHandle: React.FC = () => {
  const { sidebarWidth, setSidebarWidth, saveSidebarWidth } = useGantt();
  const [isResizing, setIsResizing] = useState(false);
  const widthRef = useRef(sidebarWidth);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    widthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = e.clientX;
      widthRef.current = newWidth;
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      saveSidebarWidth(widthRef.current);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{ left: sidebarWidth }}
      className={`absolute top-0 w-1.5 h-full cursor-col-resize z-[60] transition-colors hover:bg-accent/50 -translate-x-1/2 ${
        isResizing ? 'bg-accent w-1' : 'bg-transparent'
      }`}
    />
  );
};
