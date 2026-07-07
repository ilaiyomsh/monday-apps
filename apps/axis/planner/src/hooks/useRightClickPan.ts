import { useState, useCallback, useRef } from 'react';

interface UseRightClickPanProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Friction coefficient for momentum decay (0-1, lower = more friction) */
  friction?: number;
  /** Minimum velocity to continue momentum animation */
  minVelocity?: number;
  /** Minimum pixels of movement before right-click on a task becomes a pan instead of context menu */
  dragThreshold?: number;
}

interface UseRightClickPanReturn {
  isPanning: boolean;
  handlers: {
    onContextMenu: (e: React.MouseEvent) => void;
    onMouseDown: (e: React.MouseEvent) => void;
  };
}

/**
 * Hook to implement horizontal panning using the right mouse button
 * - Right-click on empty space: immediate pan
 * - Right-click on task bar: if dragged past threshold → pan; if released without drag → let TaskBar show context menu
 * Includes smooth momentum with velocity decay after release
 */
export const useRightClickPan = ({
  containerRef,
  friction = 0.92,
  minVelocity = 0.5,
  dragThreshold = 5,
}: UseRightClickPanProps): UseRightClickPanReturn => {
  const [isPanning, setIsPanning] = useState(false);
  const dragStartRef = useRef<{ x: number; scrollLeft: number } | null>(null);
  const velocityRef = useRef<{ x: number; timestamp: number }>({ x: 0, timestamp: 0 });
  const lastPosRef = useRef<{ x: number; timestamp: number } | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  // Track whether this right-click started on a task bar
  const isOnTaskRef = useRef(false);
  // Track whether we've exceeded the drag threshold (used to suppress context menu)
  const didPanRef = useRef(false);

  // Apply momentum after release
  const applyMomentum = useCallback(() => {
    if (!containerRef.current) return;

    const velocity = velocityRef.current.x;

    // Stop if velocity is too low
    if (Math.abs(velocity) < minVelocity) {
      velocityRef.current = { x: 0, timestamp: 0 };
      animationFrameRef.current = null;
      return;
    }

    // Apply velocity to scroll position
    containerRef.current.scrollLeft -= velocity;

    // Apply friction to decay velocity
    velocityRef.current.x *= friction;

    // Continue animation
    animationFrameRef.current = requestAnimationFrame(applyMomentum);
  }, [containerRef, friction, minVelocity]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Check if it's the right mouse button (button 2)
    if (e.button !== 2 || !containerRef.current) return;

    // Cancel any ongoing momentum animation
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Check if click is on a task bar
    const target = e.target as HTMLElement;
    const isOnTask = !!target.closest('[data-task-id]');
    isOnTaskRef.current = isOnTask;
    didPanRef.current = false;

    const now = performance.now();
    const startX = e.clientX;

    dragStartRef.current = {
      x: startX,
      scrollLeft: containerRef.current.scrollLeft,
    };

    lastPosRef.current = { x: startX, timestamp: now };
    velocityRef.current = { x: 0, timestamp: now };

    // If clicking on empty space, start panning immediately
    if (!isOnTask) {
      setIsPanning(true);
    }

    // Add global event listeners for smooth dragging
    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!dragStartRef.current || !containerRef.current) return;

      const totalDeltaX = Math.abs(moveEvent.clientX - startX);

      // If on a task and haven't exceeded threshold yet, check threshold
      if (isOnTaskRef.current && !didPanRef.current) {
        if (totalDeltaX < dragThreshold) return;
        // Exceeded threshold - start panning
        didPanRef.current = true;
        setIsPanning(true);
      }

      const now = performance.now();
      const deltaX = moveEvent.clientX - dragStartRef.current.x;
      containerRef.current.scrollLeft = dragStartRef.current.scrollLeft - deltaX;

      // Calculate velocity based on recent movement
      if (lastPosRef.current) {
        const dt = now - lastPosRef.current.timestamp;
        if (dt > 0) {
          const rawVelocity = (moveEvent.clientX - lastPosRef.current.x) / dt;
          velocityRef.current = {
            x: rawVelocity * 16,
            timestamp: now,
          };
        }
      }

      lastPosRef.current = { x: moveEvent.clientX, timestamp: now };
    };

    const onMouseUp = () => {
      setIsPanning(false);
      dragStartRef.current = null;
      lastPosRef.current = null;

      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);

      // Start momentum animation if there's velocity
      if (Math.abs(velocityRef.current.x) > minVelocity) {
        animationFrameRef.current = requestAnimationFrame(applyMomentum);
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [containerRef, applyMomentum, minVelocity, dragThreshold]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    // Always prevent browser context menu on the gantt container
    e.preventDefault();

    // If we panned (dragged past threshold), suppress the TaskBar context menu too
    if (didPanRef.current) {
      e.stopPropagation();
    }
    // If we didn't pan and clicked on a task, TaskBar's own onContextMenu will handle it
  }, []);

  return {
    isPanning,
    handlers: {
      onContextMenu: handleContextMenu,
      onMouseDown: handleMouseDown,
    },
  };
};
