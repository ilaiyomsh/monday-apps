import { useState, useEffect, useCallback } from 'react';
import { safeApi } from '../utils/mondayApi';
import logger from '../utils/logger';

/**
 * Hook לבדיקת סטטוס owner של הלוח
 * בודק אם המשתמש הנוכחי הוא owner של הלוח
 */
export const useBoardOwner = (monday) => {
    const [isOwner, setIsOwner] = useState(false);
    const [loading, setLoading] = useState(true);

    const checkOwnerStatus = useCallback(async () => {
        if (!monday) {
            setIsOwner(false);
            setLoading(false);
            return;
        }

        try {
            logger.functionStart('useBoardOwner.checkOwnerStatus');
            
            const context = await monday.get('context');
            const boardId = context.data?.boardId;
            const userId = context.data?.user?.id;
            
            if (!boardId || !userId) {
                logger.warn('useBoardOwner.checkOwnerStatus', 'Missing boardId or userId', { boardId, userId });
                setIsOwner(false);
                setLoading(false);
                return;
            }
            
            const query = `
                query {
                    boards(ids: [${boardId}]) {
                        owners {
                            id
                        }
                    }
                }
            `;
            
            const response = await safeApi(monday, 'useBoardOwner.checkOwnerStatus', query);
            
            if (response.data?.boards?.[0]?.owners) {
                const owners = response.data.boards[0].owners;
                const isUserOwner = owners.some(owner => String(owner.id) === String(userId));

                setIsOwner(isUserOwner);
                logger.functionEnd('useBoardOwner.checkOwnerStatus', { isOwner: isUserOwner });
            } else {
                logger.warn('useBoardOwner.checkOwnerStatus', 'No owners found in response');
                setIsOwner(false);
            }
        } catch (error) {
            logger.error('useBoardOwner.checkOwnerStatus', 'Error checking owner status', error);
            setIsOwner(false);
        } finally {
            setLoading(false);
        }
    }, [monday]);

    // טעינת סטטוס owner בעת טעינת הקומפוננטה
    useEffect(() => {
        checkOwnerStatus();
    }, [checkOwnerStatus]);

    return {
        isOwner,
        loading,
        checkOwnerStatus
    };
};

