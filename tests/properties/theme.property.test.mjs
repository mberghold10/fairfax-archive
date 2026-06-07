// Feature: fairfax-archive-site, Property 11: Theme preference round-trip persistence
// **Validates: Requirements 12.5**

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import * as fc from 'fast-check';
import React from 'react';
import { ThemeProvider, useTheme } from '../../src/utils/ThemeProvider.jsx';

const STORAGE_KEY = 'theme';

// Helper component to expose theme context values for testing
function ThemeConsumer() {
  const { theme, toggleTheme } = useTheme();
  return React.createElement('div', null,
    React.createElement('span', { 'data-testid': 'theme-value' }, theme),
    React.createElement('button', { 'data-testid': 'toggle-btn', onClick: toggleTheme }, 'Toggle')
  );
}

// Arbitrary for valid theme values
const themeArb = fc.constantFrom('light', 'dark');

describe('Property 11: Theme preference round-trip persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('writing a theme to localStorage and reading it back produces the same value, and ThemeProvider applies it', () => {
    fc.assert(
      fc.property(themeArb, (themeValue) => {
        // Clean up between iterations
        localStorage.clear();
        document.documentElement.removeAttribute('data-theme');

        // Write the preference to localStorage
        localStorage.setItem(STORAGE_KEY, themeValue);

        // Read it back and verify round-trip
        const stored = localStorage.getItem(STORAGE_KEY);
        expect(stored).toBe(themeValue);

        // Render ThemeProvider to verify it picks up the stored preference
        const { unmount } = render(
          React.createElement(ThemeProvider, null,
            React.createElement(ThemeConsumer)
          )
        );

        // Verify the theme context reflects the stored value
        const displayed = screen.getByTestId('theme-value').textContent;
        expect(displayed).toBe(themeValue);

        // Verify data-theme attribute is applied to document root
        expect(document.documentElement.getAttribute('data-theme')).toBe(themeValue);

        unmount();
      }),
      { numRuns: 100 }
    );
  });

  it('after toggle, localStorage value matches the new theme', () => {
    fc.assert(
      fc.property(themeArb, (initialTheme) => {
        // Clean up between iterations
        localStorage.clear();
        document.documentElement.removeAttribute('data-theme');

        // Set initial theme in localStorage
        localStorage.setItem(STORAGE_KEY, initialTheme);

        const { unmount } = render(
          React.createElement(ThemeProvider, null,
            React.createElement(ThemeConsumer)
          )
        );

        // Verify initial state
        expect(screen.getByTestId('theme-value').textContent).toBe(initialTheme);

        // Toggle the theme
        act(() => {
          screen.getByTestId('toggle-btn').click();
        });

        // Expected new theme after toggle
        const expectedNewTheme = initialTheme === 'light' ? 'dark' : 'light';

        // Verify the displayed theme changed
        expect(screen.getByTestId('theme-value').textContent).toBe(expectedNewTheme);

        // Verify localStorage was updated with the new theme
        expect(localStorage.getItem(STORAGE_KEY)).toBe(expectedNewTheme);

        // Verify data-theme attribute updated
        expect(document.documentElement.getAttribute('data-theme')).toBe(expectedNewTheme);

        unmount();
      }),
      { numRuns: 100 }
    );
  });
});
