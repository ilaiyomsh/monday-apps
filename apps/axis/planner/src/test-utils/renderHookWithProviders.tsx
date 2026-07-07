import type { ReactNode } from 'react';
import { renderHook, type RenderHookOptions, type RenderHookResult } from '@testing-library/react';
import { MondayContextProvider } from '../contexts/MondayContext';
import { SettingsProvider } from '../contexts/SettingsContext';
import { ActiveProjectsProvider } from '../contexts/ActiveProjectsContext';
import { type MondayMock, getMondayMock } from './mondayMock';
import type { RenderProvidersOptions } from './renderWithProviders';

const SETTINGS_STORAGE_KEY = 'planner_app_settings';

export type RenderHookProvidersOptions<TProps> = Omit<
  RenderHookOptions<TProps>,
  'wrapper'
> & Pick<
  RenderProvidersOptions,
  'monday' | 'initialContext' | 'initialSettings' | 'language' | 'withoutActiveProjects'
>;

const wrapTree = (children: ReactNode, withoutActiveProjects?: boolean) => {
  const inner = withoutActiveProjects ? children : <ActiveProjectsProvider>{children}</ActiveProjectsProvider>;
  return (
    <MondayContextProvider>
      <SettingsProvider>{inner}</SettingsProvider>
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

export const renderHookWithProviders = <TResult, TProps>(
  hook: (props: TProps) => TResult,
  options: RenderHookProvidersOptions<TProps> = {}
): RenderHookResult<TResult, TProps> & { monday: MondayMock } => {
  const {
    monday = getMondayMock(),
    initialContext,
    initialSettings,
    language,
    withoutActiveProjects,
    ...rest
  } = options;

  seedMock(monday, { initialContext, initialSettings, language });

  const result = renderHook(hook, {
    wrapper: ({ children }) => <>{wrapTree(children, withoutActiveProjects)}</>,
    ...rest,
  });

  return { ...result, monday };
};
