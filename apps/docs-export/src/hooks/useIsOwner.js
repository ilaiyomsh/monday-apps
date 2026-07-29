/**
 * Is the current user an owner of the board this view sits on?
 *
 * @module hooks/useIsOwner
 *
 * **This gates SETTINGS ONLY.** The per-user PERSONAL SCOPE of the report — the
 * `person` column filter that limits every user to items they appear in — applies
 * to owners and account admins exactly like everyone else. Owner-ness buys the
 * right to CONFIGURE the app, never a wider view of the data.
 *
 * The question is asked against `context.boardId` (the board the view is mounted
 * on), NOT `settings.boardId` (the board the report reads). Those are usually
 * different boards, and the one whose owners may configure this view is the one the
 * view lives on.
 *
 * Three behaviours worth knowing before changing this:
 *
 *  1. **Loading is a real state.** A board_view context arrives asynchronously, so
 *     until it does the hook answers `isLoading: true`. Anything else flashes the
 *     wrong surface: an early `false` shows a non-owner screen to the owner, an
 *     early `true` shows the settings surface to everyone.
 *  2. **No ids, no query — fail closed and say so.** The watchdog context (`{}`,
 *     installed when there is no monday around us) carries no boardId or user, and
 *     `services/owners` would refuse it anyway. Answering `false` WITH a warn keeps
 *     "the gate is closed for everyone" visible in telemetry instead of looking like
 *     an app that simply has no settings button.
 *  3. **A stale answer must never land.** The context can re-emit with a different
 *     board/user; the abandoned pair's response can arrive last and would otherwise
 *     grant or revoke access based on a board nobody is looking at. The single
 *     defence is the per-effect `cancelled` flag — React runs the cleanup before
 *     re-running the effect, so an id-comparison ref on top of it would be dead
 *     weight (proven: a mutation removing such a ref was indistinguishable).
 */
import { useEffect, useState } from 'react';
import { isBoardOwner } from '../services/owners.js';
import { useMonday } from '../contexts/MondayContext.jsx';
import logger from '../utils/logger.js';

const CLOSED = { isOwner: false, isLoading: false };
const PENDING = { isOwner: false, isLoading: true };

/**
 * `pnpm dev:mock` swaps the whole SDK for `src/dev-harness/monday-sdk-stub.js`,
 * which has no board-owners fixture — so every ownership check there resolves to
 * "not an owner" and the owner-only settings surface becomes unreachable outside
 * the iframe. This flag is set ONLY by that script and is inlined at build time, so
 * a production bundle cannot carry it (and a bundle that did would have a stubbed
 * SDK and no real data to protect).
 *
 * Read per call rather than cached in a module const: Vite still inlines the
 * literal at build time (so the branch is dead code in production), while tests
 * can drive both sides of it with `vi.stubEnv`.
 */
const isDevHarness = () => Boolean(import.meta.env?.VITE_MONDAY_MOCK);

/**
 * @returns {{isOwner: boolean, isLoading: boolean}}
 */
export function useIsOwner() {
  const { context } = useMonday();
  const boardId = context?.boardId;
  const userId = context?.user?.id;

  const [state, setState] = useState(PENDING);

  useEffect(() => {
    // context === null means MondayProvider has neither resolved the context nor
    // hit its watchdog yet. Stay pending rather than guess.
    if (!context) {
      setState(PENDING);
      return undefined;
    }

    if (isDevHarness()) {
      setState({ isOwner: true, isLoading: false });
      return undefined;
    }

    if (!boardId || !userId) {
      logger.warn('useIsOwner', 'בדיקת בעלות דולגה — בהקשר של monday חסר מזהה לוח או משתמש', {
        boardId: boardId ?? null,
        userId: userId ?? null,
      });
      setState(CLOSED);
      return undefined;
    }

    let cancelled = false;
    setState(PENDING);

    isBoardOwner(boardId, userId)
      .then((owner) => {
        if (cancelled) return;
        setState({ isOwner: Boolean(owner), isLoading: false });
      })
      .catch((err) => {
        // `services/owners` already fails closed internally, so reaching here means
        // something unexpected broke (a bug, a module-load failure). Without this
        // catch the hook would stay LOADING forever and the app would sit on a
        // spinner — so: closed, recorded, settled.
        logger.error('useIsOwner', 'בדיקת הבעלות על הלוח נכשלה — ההרשאה נסגרת', err, {
          boardId,
        });
        if (cancelled) return;
        setState(CLOSED);
      });

    return () => {
      cancelled = true;
    };
  }, [context, boardId, userId]);

  return state;
}

export default useIsOwner;
