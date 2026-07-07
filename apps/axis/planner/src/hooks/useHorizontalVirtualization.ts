import { useMemo } from 'react';

interface UseHorizontalVirtualizationProps {
  scrollLeft: number;
  containerWidth: number;
  itemWidth: number;
  totalItems: number;
  buffer?: number;
}

export interface VirtualRange {
  startIndex: number;
  endIndex: number;
  offsetLeft: number;
}

/**
 * Hook to calculate visible range for horizontal virtualization
 */
export const useHorizontalVirtualization = ({
  scrollLeft,
  containerWidth,
  itemWidth,
  totalItems,
  buffer = 5,
}: UseHorizontalVirtualizationProps): VirtualRange => {
  return useMemo(() => {
    if (containerWidth <= 0 || itemWidth <= 0) {
      return { startIndex: 0, endIndex: totalItems, offsetLeft: 0 };
    }

    // Calculate how many items are visible
    const visibleCount = Math.ceil(containerWidth / itemWidth);
    
    // Calculate start index based on scroll position
    const rawStartIndex = Math.floor(scrollLeft / itemWidth);
    
    // Apply buffer and ensure boundaries
    const startIndex = Math.max(0, rawStartIndex - buffer);
    const endIndex = Math.min(totalItems, rawStartIndex + visibleCount + buffer);
    
    // Calculate the offset for positioning the visible slice
    const offsetLeft = startIndex * itemWidth;

    return {
      startIndex,
      endIndex,
      offsetLeft,
    };
  }, [scrollLeft, containerWidth, itemWidth, totalItems, buffer]);
};
