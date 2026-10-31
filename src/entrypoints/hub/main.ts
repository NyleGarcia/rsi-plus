import { mount } from 'svelte';
import '@/app.css';
import Hub from './Hub.svelte';
import { initTheme } from '@/lib/theme';
import { initPrivacy } from '@/lib/privacy.svelte';
import { initCurrency } from '@/lib/settings';

initTheme();
initPrivacy();
// Mount after the display currency is known, so the first paint already shows it.
void initCurrency()
  .catch(() => {})
  .finally(() => mount(Hub, { target: document.getElementById('app')! }));
