import { useEffect, useRef, useCallback } from 'react';

interface UseAutoScrollProps {
  containerRef: React.RefObject<HTMLElement | null>;
  isActive: boolean;
  /** Distance from edge in pixels to trigger scroll */
  edgeThreshold?: number;
  /** Scroll speed in pixels per frame */
  scrollSpeed?: number;
}

/**
 * Hook to auto-scroll a container when mouse is near the edges
 * Used during drag and resize operations
 */
export const useAutoScroll = ({
  containerRef,
  isActive,
  edgeThreshold = 100,
  scrollSpeed = 15,
}: UseAutoScrollProps) => {
  const scrollDirectionRef = useRef<'left' | 'right' | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const mousePositionRef = useRef<{ x: number; y: number } | null>(null);

  // Track how close the mouse is to the edge (0 = at edge, 1 = at threshold boundary)
  const edgeProximityRef = useRef(0);

  // Continuous scroll loop with progressive speed based on edge proximity
  const scrollLoop = useCallback(() => {
    if (!containerRef.current || !scrollDirectionRef.current) return;

    const direction = scrollDirectionRef.current;
    const container = containerRef.current;
    // Speed ramps up as mouse gets closer to edge (minimum 2px, max = scrollSpeed)
    const speed = Math.max(2, scrollSpeed * edgeProximityRef.current);

    if (direction === 'left') {
      container.scrollLeft = Math.max(0, container.scrollLeft - speed);
    } else if (direction === 'right') {
      container.scrollLeft = container.scrollLeft + speed;
    }

    animationFrameRef.current = requestAnimationFrame(scrollLoop);
  }, [containerRef, scrollSpeed]);

  // Handle mouse position updates
  const updateScrollDirection = useCallback((clientX: number) => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const previousDirection = scrollDirectionRef.current;

    if (clientX < rect.left + edgeThreshold) {
      scrollDirectionRef.current = 'left';
      // Calculate proximity: 1 = at edge, 0 = at threshold boundary
      edgeProximityRef.current = Math.max(0, 1 - (clientX - rect.left) / edgeThreshold);
    } else if (clientX > rect.right - edgeThreshold) {
      scrollDirectionRef.current = 'right';
      edgeProximityRef.current = Math.max(0, 1 - (rect.right - clientX) / edgeThreshold);
    } else {
      scrollDirectionRef.current = null;
      edgeProximityRef.current = 0;
    }

    // Start scroll loop if direction changed and we have a direction
    if (scrollDirectionRef.current && !previousDirection) {
      scrollLoop();
    }
  }, [containerRef, edgeThreshold, scrollLoop]);

  useEffect(() => {
    if (!isActive) {
      // Cleanup when not active
      scrollDirectionRef.current = null;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      mousePositionRef.current = { x: e.clientX, y: e.clientY };
      updateScrollDirection(e.clientX);
    };

    const handleMouseUp = () => {
      scrollDirectionRef.current = null;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      scrollDirectionRef.current = null;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isActive, updateScrollDirection]);

  return {
    /** Manually trigger scroll direction update from current mouse position */
    updateFromMouse: (clientX: number) => {
      if (isActive) {
        updateScrollDirection(clientX);
      }
    },
  };
};
