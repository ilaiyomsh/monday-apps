import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import mondaySdk from 'monday-sdk-js';
import { mondayService } from '../services/mondayService';
import { logger } from '../utils/Logger';

const monday = mondaySdk();
const PHOTOS_STORAGE_KEY = 'planner_user_photos';

interface UserPhotoCache {
  photos: Record<string, string>;  // userId -> photoUrl
  lastUpdated: string;             // ISO timestamp
}

export const useUserPhotos = (isAdmin: boolean, userIds: string[]) => {
  const [photoMap, setPhotoMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const initialLoadDoneRef = useRef(false);

  // Memoize userIds key to avoid dependency issues
  const userIdsKey = useMemo(() => userIds.join(','), [userIds]);

  // Load cached photos from storage
  const loadCachedPhotos = useCallback(async () => {
    try {
      const response = await (monday.storage.instance as any).getItem(PHOTOS_STORAGE_KEY);
      if (response.data?.value) {
        const cache: UserPhotoCache = JSON.parse(response.data.value);
        setPhotoMap(new Map(Object.entries(cache.photos)));
        logger.debug('[useUserPhotos] Loaded cached photos:', Object.keys(cache.photos).length);
      }
    } catch (err) {
      logger.warn('[useUserPhotos] Failed to load cached photos:', err);
    }
  }, []);

  // Refresh photos from API (admin only)
  const refreshPhotos = useCallback(async (idsToFetch: string[]) => {
    if (!isAdmin || idsToFetch.length === 0) return;

    try {
      const freshPhotos = await mondayService.fetchUserPhotos(idsToFetch);

      // Merge with existing cache
      const newPhotos: Record<string, string> = {};
      freshPhotos.forEach((url, id) => {
        newPhotos[id] = url;
      });

      const cache: UserPhotoCache = {
        photos: newPhotos,
        lastUpdated: new Date().toISOString()
      };

      await (monday.storage.instance as any).setItem(
        PHOTOS_STORAGE_KEY,
        JSON.stringify(cache)
      );

      setPhotoMap(new Map(Object.entries(newPhotos)));
      logger.debug('[useUserPhotos] Refreshed photo cache:', freshPhotos.size, 'photos');
    } catch (err) {
      logger.warn('[useUserPhotos] Failed to refresh photos:', err);
    }
  }, [isAdmin]);

  // Initial load and refresh on userIds change
  useEffect(() => {
    const init = async () => {
      if (!initialLoadDoneRef.current) {
        await loadCachedPhotos();
        initialLoadDoneRef.current = true;
      }

      // If admin, refresh photos
      if (isAdmin && userIds.length > 0) {
        await refreshPhotos(userIds);
      }

      setLoading(false);
    };
    init();
  }, [isAdmin, userIdsKey, loadCachedPhotos, refreshPhotos, userIds]);

  const getPhotoUrl = useCallback((userId: string) => {
    return photoMap.get(userId);
  }, [photoMap]);

  return {
    photoMap,
    loading,
    getPhotoUrl,
    refreshPhotos
  };
};
