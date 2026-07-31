import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

interface UseVirtualFeedOptions<T> {
  items: T[];
  getItemKey: (item: T, index: number) => string;
  estimatedHeight?: number;
  overscan?: number;
  containerRef: React.RefObject<HTMLElement | null>;
}

interface VirtualItem<T> {
  item: T;
  index: number;
  key: string;
  measureRef: (node: HTMLElement | null) => void;
}

interface VirtualFeedResult<T> {
  virtualItems: VirtualItem<T>[];
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  totalHeight: number;
  isVirtualized: boolean;
}

export function useVirtualFeed<T>({
  items,
  getItemKey,
  estimatedHeight = 120,
  overscan = 5,
  containerRef,
}: UseVirtualFeedOptions<T>): VirtualFeedResult<T> {
  const [scrollTop, setScrollTop] = useState(0);
  const [clientHeight, setClientHeight] = useState(0);
  const heightsRef = useRef<Map<string, number>>(new Map());
  const observersRef = useRef<Map<string, ResizeObserver>>(new Map());
  const [, forceUpdate] = useState({});

  // Clean up stale height entries when items list drastically shrinks/resets
  useEffect(() => {
    const activeKeys = new Set(items.map((item, idx) => getItemKey(item, idx)));
    for (const key of heightsRef.current.keys()) {
      if (!activeKeys.has(key)) {
        heightsRef.current.delete(key);
        observersRef.current.get(key)?.disconnect();
        observersRef.current.delete(key);
      }
    }
  }, [items, getItemKey]);

  // Monitor container scroll and dimensions
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      setScrollTop(container.scrollTop);
      setClientHeight(container.clientHeight);
    };

    handleScroll();

    container.addEventListener("scroll", handleScroll, { passive: true });
    const resizeObserver = new ResizeObserver(() => {
      setClientHeight(container.clientHeight);
    });
    resizeObserver.observe(container);

    return () => {
      container.removeEventListener("scroll", handleScroll);
      resizeObserver.disconnect();
    };
  }, [containerRef]);

  // Calculate cumulative position offsets
  const getItemHeight = useCallback(
    (key: string) => heightsRef.current.get(key) ?? estimatedHeight,
    [estimatedHeight]
  );

  let accumulated = 0;
  const offsets: number[] = new Array(items.length);
  const heights: number[] = new Array(items.length);

  for (let i = 0; i < items.length; i++) {
    const key = getItemKey(items[i], i);
    const h = getItemHeight(key);
    offsets[i] = accumulated;
    heights[i] = h;
    accumulated += h;
  }

  const totalHeight = accumulated;

  // Binary search or linear scan for visible start and end index
  let startIndex = 0;
  let endIndex = items.length - 1;

  if (clientHeight > 0 && items.length > 0) {
    const viewportTop = scrollTop;
    const viewportBottom = scrollTop + clientHeight;

    let start = 0;
    while (start < items.length && offsets[start] + heights[start] < viewportTop) {
      start++;
    }
    startIndex = Math.max(0, start - overscan);

    let end = start;
    while (end < items.length && offsets[end] < viewportBottom) {
      end++;
    }
    endIndex = Math.min(items.length - 1, end + overscan);
  }

  // Calculate spacer heights
  const topSpacerHeight = startIndex > 0 ? offsets[startIndex] : 0;
  const bottomSpacerHeight =
    endIndex < items.length - 1
      ? totalHeight - (offsets[endIndex] + heights[endIndex])
      : 0;

  // Callback ref for measuring element heights via ResizeObserver
  const measureRef = useCallback(
    (key: string) => (node: HTMLElement | null) => {
      const existingObserver = observersRef.current.get(key);
      if (existingObserver) {
        existingObserver.disconnect();
        observersRef.current.delete(key);
      }

      if (node) {
        const observer = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const newHeight = entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
            if (newHeight > 0 && heightsRef.current.get(key) !== newHeight) {
              heightsRef.current.set(key, newHeight);
              forceUpdate({});
            }
          }
        });
        observer.observe(node);
        observersRef.current.set(key, observer);
      }
    },
    []
  );

  const virtualItems: VirtualItem<T>[] = [];
  for (let i = startIndex; i <= endIndex && i < items.length; i++) {
    const key = getItemKey(items[i], i);
    virtualItems.push({
      item: items[i],
      index: i,
      key,
      measureRef: measureRef(key),
    });
  }

  return {
    virtualItems,
    topSpacerHeight,
    bottomSpacerHeight,
    totalHeight,
    isVirtualized: items.length > 0,
  };
}
