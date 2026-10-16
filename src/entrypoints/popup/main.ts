import { mount } from 'svelte';
import '@/app.css';
import App from './App.svelte';
import { initTheme } from '@/lib/theme';
import { initPrivacy } from '@/lib/privacy.svelte';

initTheme();
initPrivacy();
mount(App, { target: document.getElementById('app')! });
