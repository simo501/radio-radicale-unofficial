(() => {
  const key = 'rr-theme';
  const root = document.documentElement;
  const system = window.matchMedia?.('(prefers-color-scheme: dark)');
  const valid = value => value === 'light' || value === 'dark' ? value : null;
  const stored = () => {
    try { return valid(window.localStorage.getItem(key)); }
    catch { return null; }
  };
  let preference = stored();
  let current = preference || (system?.matches ? 'dark' : 'light');
  let bound = false;

  function apply(theme) {
    current = theme;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    document.getElementById('theme-color')?.setAttribute('content', theme === 'dark' ? '#17191f' : '#ffffff');
    const button = document.getElementById('theme-toggle');
    if (!button) return;
    button.setAttribute('aria-checked', String(theme === 'dark'));
    button.title = theme === 'dark' ? 'Passa al tema chiaro' : 'Passa al tema scuro';
    document.getElementById('theme-icon').textContent = theme === 'dark' ? '☀' : '☾';
    document.getElementById('theme-label').textContent = theme === 'dark' ? 'chiaro' : 'scuro';
  }

  function init() {
    const button = document.getElementById('theme-toggle');
    if (!button) return;
    if (!bound) {
      bound = true;
      button.addEventListener('click', () => {
        preference = current === 'dark' ? 'light' : 'dark';
        try { window.localStorage.setItem(key, preference); }
        catch { /* The switch still works when browser storage is unavailable. */ }
        apply(preference);
      });
    }
    apply(current);
  }

  // Apply before styles load, then bind the switch as soon as its markup exists.
  apply(current);
  window.ArchiveTheme = { init };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

  const followSystem = event => { if (!preference) apply(event.matches ? 'dark' : 'light'); };
  if (system?.addEventListener) system.addEventListener('change', followSystem);
  else system?.addListener?.(followSystem);
  window.addEventListener?.('storage', event => {
    if (event.key !== key && event.key !== null) return;
    preference = event.key === null ? stored() : valid(event.newValue);
    apply(preference || (system?.matches ? 'dark' : 'light'));
  });
})();
