/** Support links shown at the bottom of the hub sidebar (after SC-ORG-BOT's footer). */
export const BUYMEACOFFEE_URL = 'https://buymeacoffee.com/zedwil';

export interface ReferralLead {
  name: string;
  /** RSI referral code (`STAR-XXXX-XXXX`). */
  id: string;
}

/** Rotated every 10 s when there is more than one lead. */
export const REFERRAL_LEADS: readonly ReferralLead[] = [{ name: 'Zedwil', id: 'STAR-9KJY-9C9H' }];

export const REFERRAL_ROTATE_MS = 10_000;

export const enlistUrl = (code: string) => `https://www.robertsspaceindustries.com/enlist?referral=${encodeURIComponent(code)}`;
