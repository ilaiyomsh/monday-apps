/* eslint-disable react-refresh/only-export-components -- test util module */
import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { MondayContextProvider } from '../contexts/MondayContext';
import { SettingsProvider } from '../contexts/SettingsContext';
import { ActiveProjectsProvider } from '../contexts/ActiveProjectsContext';
import {
  type MondayMock,
  type MondayContextData,
  type MondaySettingsData,
  getMondayMock,
} from './mondayMock';

const SETTINGS_STORAGE_KEY = 'planner_app_settings';

export interface RenderProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Use a specific mock instance. Defaults to the singleton from `getMondayMock()`. */
  monday?: MondayMock;
  /** Partial Monday context to seed before mount. */
  initialContext?: Partial<MondayContextData>;
  /**
   * Partial PlannerSettings to seed into instance storage before mount.
   * The hook reads JSON-serialized settings from `planner_app_settings`.
   */
  initialSettings?: Partial<MondaySettingsData>;
  /**
   * Sugar: sets `context.user.currentLanguage`. Accepts `'he' | 'en'` for the
   * common case, and any string for tests that need to drive unrecognised
   * language codes (BCP-47 region tags, `'fr'`, etc.).
   */
  language?: 'he' | 'en' | string;
  /** Skip ActiveProjectsProvider (handful of components don't need it). */
  withoutActiveProjects?: boolean;
}

const ProvidersWrapper = ({
  children,
  withoutActiveProjects,
}: {
  children: ReactNode;
  withoutActiveProjects?: boolean;
}) => {
  const tree = withoutActiveProjects ? (
    children
  ) : (
    <ActiveProjectsProvider>{children}</ActiveProjectsProvider>
  );
  return (
    <MondayContextProvider>
      <SettingsProvider>{tree}</SettingsProvider>
    </MondayContextProvider>
  );
};

const seedMock = (
  monday: MondayMock,
  options: Pick<RenderProvidersOptions, 'initialContext' | 'initialSettings' | 'language'>
) => {
  const { initialContext, initialSettings, language } = options;

  if (language || initialContext) {
    monday.__seedContext({
      ...(initialContext ?? {}),
      ...(language ? { user: { currentLanguage: language } } : {}),
    });
  }

  if (initialSettings) {
    monday.__seedStorage(SETTINGS_STORAGE_KEY, initialSettings);
  }
};

export const renderWithProviders = (
  ui: ReactElement,
  options: RenderProvidersOptions = {}
): RenderResult & { monday: MondayMock } => {
  const {
    monday = getMondayMock(),
    initialContext,
    initialSettings,
    language,
    withoutActiveProjects,
    ...rest
  } = options;

  seedMock(monday, { initialContext, initialSettings, language });

  const result = render(ui, {
    wrapper: ({ children }) => (
      <ProvidersWrapper withoutActiveProjects={withoutActiveProjects}>{children}</ProvidersWrapper>
    ),
    ...rest,
  });

  return { ...result, monday };
};
