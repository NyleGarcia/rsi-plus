/** The boolean settings as switches — one wording for the hub Settings page and the popup (`quick` = also in the popup). */
import type { Settings } from './settings';

export interface SettingToggle {
  key: keyof Settings;
  label: string;
  hint?: string;
  quick?: boolean;
}
export const SETTING_TOGGLES: SettingToggle[] = [
  { key: 'readTracking', label: 'Read tracking', hint: '"+N new" badges, read threads dimmed', quick: true },
  { key: 'hideRead', label: 'Hide read threads', hint: 'Unless they have new replies, are pinned or watched', quick: true },
  { key: 'devHighlight', label: 'Highlight dev posts' },
  { key: 'keyboard', label: 'Keyboard shortcuts', hint: 'Press ? on Spectrum' },
  { key: 'theme', label: 'Modern theme on Spectrum', hint: 'Spacing, readable widths, softer chrome on the RSI site itself' },
  { key: 'wide', label: 'Full-width threads' },
  { key: 'compact', label: 'Compact replies' },
  { key: 'muteReplies', label: 'Collapse replies by muted authors' },
  { key: 'pollAuto', label: 'Check watches automatically', hint: 'Off = passive: no background checks or traffic; the Feed updates only when you press Check now', quick: true },
  { key: 'notify', label: 'Desktop notifications', quick: true },
  { key: 'notifyAllFriends', label: 'Notify for every friend coming online', hint: 'Otherwise only friends marked with the bell' },
  { key: 'partySound', label: 'Ding on party auto-accept', hint: 'Short sound when party mode accepts a request' },
  { key: 'siteBar', label: 'RSI+ bar on store & account pages' },
];
export const QUICK_TOGGLES = SETTING_TOGGLES.filter((t) => t.quick);
/** `muteMode` options — Mutes page and Settings use the same words. */
export const MUTE_MODES: { id: Settings['muteMode']; label: string; hint: string }[] = [
  { id: 'dim', label: 'Dim', hint: 'Collapsed to one faint line; hover to peek' },
  { id: 'hide', label: 'Hide', hint: 'Removed from lists completely' },
];

/** The number settings that sit next to a switch — same words, bounds and fallback on every page that shows them. */
export interface NumberSetting {
  key: 'pollMinutes' | 'partyRemindHours';
  /** Text before the field. */
  label: string;
  /** Text after the field. */
  unit: string;
  min: number;
  max: number;
  /** Used when the field is emptied or not a number. */
  fallback: number;
}
export const POLL_MINUTES: NumberSetting = { key: 'pollMinutes', label: 'every', unit: 'min', min: 2, max: 120, fallback: 5 };
export const PARTY_REMIND: NumberSetting = { key: 'partyRemindHours', label: 'Party reminder after', unit: 'h (0 = never)', min: 0, max: 720, fallback: 0 };
export const clampSetting = (n: NumberSetting, raw: unknown) => Math.max(n.min, Number(raw) || n.fallback);
/** One toggle's wording by key (pages that show a single switch outside the Settings list). */
export const toggleOf = (key: keyof Settings): SettingToggle => SETTING_TOGGLES.find((t) => t.key === key) ?? { key, label: String(key) };
