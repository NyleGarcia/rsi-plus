import type { MuteRules } from './filters';

/** localStorage key (robertsspaceindustries.com origin) the MAIN-world hook reads synchronously at document_start. */
export const HOOK_CONFIG_KEY = 'spectrumplus:config';
export const HOOK_TAG = '__spectrumplus';
export interface HookConfig {
  /** Drop muted threads from list payloads (muteMode 'hide'). */
  dropMuted: boolean;
  mutes: MuteRules;
}

/** Spectrum API paths whose JSON the hook forwards to the content script. */
export const CAPTURE = /\/api\/spectrum\/(forum\/channel\/threads|v2\/forum\/channel\/threads|forum\/thread\/(nested|classic|replies)|v2\/forum\/thread\/(get|replies\/list)|auth\/identify)\b/;
export const LIST_PATH = /\/api\/spectrum\/forum\/channel\/threads\b/;
