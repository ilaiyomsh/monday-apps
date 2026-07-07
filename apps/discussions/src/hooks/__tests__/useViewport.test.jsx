import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MondayContext } from '../../contexts/MondayContext.jsx';
import { useViewport, useIsMobile } from '../useViewport.js';

// setupTests stubs window.matchMedia to always report matches:false, so every
// media query resolves to "no match" => desktop. That gives us a deterministic
// default to assert against, and a clean way to prove the SDK-mode branch.
describe('useViewport', () => {
  it('defaults to desktop when there is no provider and matchMedia reports no match', () => {
    const { result } = renderHook(() => useViewport());
    expect(result.current.isMobile).toBe(false);
    expect(result.current.isTablet).toBe(false);
    expect(result.current.isDesktop).toBe(true);
    expect(result.current.isPhoneViewport).toBe(false);
    expect(result.current.sdkMobile).toBe(false);
  });

  it('useIsMobile() returns false by default', () => {
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('is mobile when the monday SDK context.mode is mobile, even on a wide viewport', () => {
    const wrapper = ({ children }) => (
      <MondayContext.Provider
        value={{ context: { mode: 'mobile' }, currentUser: null, isMobile: true }}
      >
        {children}
      </MondayContext.Provider>
    );
    const { result } = renderHook(() => useViewport(), { wrapper });
    expect(result.current.sdkMobile).toBe(true);
    expect(result.current.isMobile).toBe(true);
    expect(result.current.isDesktop).toBe(false);
  });

  it('treats a present-but-non-mobile context as desktop (soft read, no throw)', () => {
    const wrapper = ({ children }) => (
      <MondayContext.Provider
        value={{ context: { mode: 'desktop' }, currentUser: null, isMobile: false }}
      >
        {children}
      </MondayContext.Provider>
    );
    const { result } = renderHook(() => useViewport(), { wrapper });
    expect(result.current.sdkMobile).toBe(false);
    expect(result.current.isMobile).toBe(false);
  });
});
