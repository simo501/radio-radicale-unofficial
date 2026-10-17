import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/ui/theme.js', import.meta.url), 'utf8');

function setup({ storage = new Map(), dark = false, blocked = false, loading = false } = {}) {
  class Element extends EventTarget {
    setAttribute(name, value) { this[name] = value; }
  }
  const root = { dataset: {}, style: {} };
  const ids = new Map(['theme-color', 'theme-toggle', 'theme-icon', 'theme-label'].map(id => [id, new Element()]));
  let mounted = !loading;
  const document = Object.assign(new EventTarget(), {
    documentElement: root,
    readyState: loading ? 'loading' : 'complete',
    getElementById: id => mounted || id === 'theme-color' ? ids.get(id) || null : null
  });
  const system = Object.assign(new EventTarget(), { matches: dark });
  const window = Object.assign(new EventTarget(), {
    matchMedia: () => system,
    localStorage: {
      getItem(key) { if (blocked) throw new Error('Storage blocked'); return storage.get(key) ?? null; },
      setItem(key, value) { if (blocked) throw new Error('Storage blocked'); storage.set(key, value); }
    }
  });
  vm.runInNewContext(source, { window, document });
  const emit = (target, type, values = {}) => target.dispatchEvent(Object.assign(new Event(type), values));
  return {
    root, storage, element: id => ids.get(id),
    toggle: () => emit(ids.get('theme-toggle'), 'click'),
    mount() { mounted = true; window.ArchiveTheme.init(); emit(document, 'DOMContentLoaded'); },
    systemTheme(matches) { system.matches = matches; emit(system, 'change', { matches }); },
    storageTheme(value) {
      if (value === null) storage.delete('rr-theme'); else storage.set('rr-theme', value);
      emit(window, 'storage', { key: 'rr-theme', newValue: value });
    }
  };
}

test('saved theme applies before the page markup loads and binds the switch once', () => {
  const theme = setup({ storage: new Map([['rr-theme', 'dark']]), loading: true });
  assert.equal(theme.root.dataset.theme, 'dark');
  assert.equal(theme.root.style.colorScheme, 'dark');
  assert.equal(theme.element('theme-color').content, '#17191f');
  theme.mount();
  assert.equal(theme.element('theme-toggle')['aria-checked'], 'true');
  assert.equal(theme.element('theme-label').textContent, 'chiaro');
  theme.toggle();
  assert.equal(theme.root.dataset.theme, 'light');
  assert.equal(theme.storage.get('rr-theme'), 'light');
});

test('manual theme choice persists on reload and overrides the system theme', () => {
  const storage = new Map();
  const first = setup({ storage });
  first.toggle();
  assert.equal(first.root.dataset.theme, 'dark');
  const reloaded = setup({ storage, dark: false });
  assert.equal(reloaded.root.dataset.theme, 'dark');
  reloaded.systemTheme(false);
  assert.equal(reloaded.root.dataset.theme, 'dark');
  reloaded.toggle();
  assert.equal(reloaded.element('theme-toggle')['aria-checked'], 'false');
  assert.equal(reloaded.element('theme-label').textContent, 'scuro');
  assert.equal(reloaded.element('theme-color').content, '#ffffff');
});

test('theme follows device changes until the user makes a selection', () => {
  const theme = setup();
  assert.equal(theme.root.dataset.theme, 'light');
  theme.systemTheme(true);
  assert.equal(theme.root.dataset.theme, 'dark');
  theme.toggle();
  theme.systemTheme(true);
  assert.equal(theme.root.dataset.theme, 'light');
});

test('theme switch works when browser storage is blocked', () => {
  const theme = setup({ dark: true, blocked: true });
  assert.equal(theme.root.dataset.theme, 'dark');
  theme.toggle();
  assert.equal(theme.root.dataset.theme, 'light');
  theme.systemTheme(true);
  assert.equal(theme.root.dataset.theme, 'light');
});

test('invalid preferences fall back to the device and storage changes sync other pages', () => {
  const theme = setup({ storage: new Map([['rr-theme', 'invalid']]), dark: true });
  assert.equal(theme.root.dataset.theme, 'dark');
  theme.storageTheme('light');
  assert.equal(theme.root.dataset.theme, 'light');
  theme.storageTheme(null);
  assert.equal(theme.root.dataset.theme, 'dark');
});
