// MCPForge — the pre-paint theme script (03 §13.2 rule 4).
//
// Exported as a plain string (not inlined in layout.tsx) so theme-init.test.ts
// can run the exact production script text in a sandbox and assert its
// try/catch behaviour, rather than testing a reimplementation of it.
//
// Reads the same `mcpforge-theme` key the topbar's theme toggle will later
// write, and stamps `data-theme` on <html> only for an explicit light/dark
// choice — "system" (no stored value, or a value that isn't "light"/"dark")
// stamps nothing and tokens.semantic.css's prefers-color-scheme block takes
// over. Wrapped in try/catch: localStorage throws in some contexts (private
// browsing, disabled storage) and the page must still render correctly.
export const THEME_INIT_SCRIPT = `(function () {
  try {
    var theme = window.localStorage.getItem('mcpforge-theme');
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  } catch (e) {
    /* localStorage blocked or unavailable — fall back to system theme. */
  }
})();`;
