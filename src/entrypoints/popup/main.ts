import { mount } from 'svelte';
import '@/app.css';
import App from './App.svelte';
import { initTheme } from '@/lib/theme';
import { initPrivacy } from '@/lib/privacy.svelte';
import { initCurrency } from '@/lib/settings';

initTheme();
initPrivacy();
// Mount after the display currency is known, so the first paint already shows it.
void initCurrency()
  .catch(() => {})
  .finally(() => mount(App, { target: document.getElementById('app')! }));
