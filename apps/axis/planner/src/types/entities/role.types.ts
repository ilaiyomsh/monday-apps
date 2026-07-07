export interface Role {
  id: string;
  name: string;
  hex?: string; // צבע מ-monday.com API
  dailyHours?: number;
}

// מיפוי צבעים לפי שם תפקיד
export type RoleColorMap = Record<string, string>;

// צבע ברירת מחדל לתפקיד ללא צבע מוגדר — Monday's blue (vibrant-5).
// Resolved at runtime from --project-color-vibrant-5; literal hex retained
// as fallback for SSR/tests where computed styles are not available.
import { getToken } from '../../styles/tokenAccess';

// eslint-disable-next-line no-restricted-syntax -- intentional SSR/test fallback for --project-color-vibrant-5
const DEFAULT_ROLE_COLOR_FALLBACK = '#579bfc';
export const DEFAULT_ROLE_COLOR = (): string =>
  getToken('--project-color-vibrant-5', DEFAULT_ROLE_COLOR_FALLBACK);

/**
 * מחזיר צבע לתפקיד לפי מיפוי צבעים דינמי
 * @param roleName - שם התפקיד
 * @param roleColorMap - מיפוי צבעים מה-API (roleName -> hexColor)
 */
export const getColorForRole = (
  roleName: string | undefined,
  roleColorMap?: RoleColorMap
): string => {
  if (!roleName) return DEFAULT_ROLE_COLOR();
  return roleColorMap?.[roleName] || DEFAULT_ROLE_COLOR();
};
