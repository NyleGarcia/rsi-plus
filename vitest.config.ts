import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

// svelte(): compiles `.svelte.ts` rune modules (e.g. privacy.svelte.ts) that WxtVitest alone leaves untouched.
export default defineConfig({ plugins: [svelte(), WxtVitest()] });
