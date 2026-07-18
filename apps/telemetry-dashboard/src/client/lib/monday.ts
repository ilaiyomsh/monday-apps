// monday-sdk-js singleton + the one seamless-auth read the dashboard needs:
// the sessionToken it forwards to the server so /api/telemetry can verify the
// caller is inside the user's own monday account.

import mondaySdk from 'monday-sdk-js';

const monday = mondaySdk();

let sessionTokenPromise: Promise<string> | null = null;

export function getSessionToken(): Promise<string> {
  if (!sessionTokenPromise) {
    const p = monday
      .get('sessionToken')
      .then((res: { data?: string }) => {
        if (!res?.data) throw new Error('sessionToken unavailable');
        return res.data;
      })
      .catch((err: unknown) => {
        sessionTokenPromise = null; // allow retry on next call
        throw err;
      });
    sessionTokenPromise = p;
    return p;
  }
  return sessionTokenPromise;
}
