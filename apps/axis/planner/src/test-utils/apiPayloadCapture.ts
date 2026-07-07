import type { MondayMock } from './mondayMock';

export interface CapturedApiCall {
  query: string;
  variables?: Record<string, unknown>;
  token?: string;
  /** Best-effort parsed `column_values` from `JSON.stringify(...)` GraphQL inputs. */
  parsedColumnValues?: Record<string, unknown>;
}

const tryParseColumnValues = (
  variables: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  if (!variables) return undefined;
  const cv = variables.columnValues ?? variables.column_values;
  if (typeof cv !== 'string') return undefined;
  try {
    return JSON.parse(cv) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

export interface ApiCapture {
  calls: CapturedApiCall[];
  lastCall: () => CapturedApiCall | undefined;
  findCallsByQuery: (substring: string) => CapturedApiCall[];
  findMutationsByName: (name: string) => CapturedApiCall[];
  reset: () => void;
}

/**
 * Wrap a `MondayMock` so every `monday.api(query, options)` call is recorded.
 * The wrapper preserves any `mockApi(substring, handler)` registrations.
 */
export const captureApi = (monday: MondayMock): ApiCapture => {
  const calls: CapturedApiCall[] = [];
  const originalApi = monday.api.bind(monday);

  monday.api = (async (query: string, options?: { variables?: Record<string, unknown>; token?: string }) => {
    calls.push({
      query,
      variables: options?.variables,
      token: options?.token,
      parsedColumnValues: tryParseColumnValues(options?.variables),
    });
    return originalApi(query, options);
  }) as MondayMock['api'];

  return {
    calls,
    lastCall: () => calls[calls.length - 1],
    findCallsByQuery: (substring) => calls.filter((c) => c.query.includes(substring)),
    findMutationsByName: (name) => calls.filter((c) => c.query.includes(name) && /^\s*mutation/.test(c.query)),
    reset: () => {
      calls.length = 0;
    },
  };
};
