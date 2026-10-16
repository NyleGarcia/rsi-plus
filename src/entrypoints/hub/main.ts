import { mount } from 'svelte';
import '@/app.css';
import Hub from './Hub.svelte';
import { initTheme } from '@/lib/theme';
import { initPrivacy } from '@/lib/privacy.svelte';

initTheme();
initPrivacy();
mount(Hub, { target: document.getElementById('app')! });
