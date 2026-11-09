import type { IntelTag } from '@/lib/intel';
/** Button / badge tone per tag (Tailwind classes, light and dark themes). */
export const TAG_TONE: Record<IntelTag, string> = {
  hostile: 'border-destructive/60 bg-destructive/15 text-destructive',
  caution: 'border-warning/60 bg-warning/15 text-warning',
  neutral: 'border-border bg-muted text-foreground',
  friendly: 'border-success/50 bg-success/10 text-success',
  ally: 'border-primary/60 bg-primary/15 text-primary',
};
export const BADGE_VARIANT: Record<IntelTag, 'destructive' | 'warning' | 'muted' | 'success' | 'info'> = {
  hostile: 'destructive',
  caution: 'warning',
  neutral: 'muted',
  friendly: 'success',
  ally: 'info',
};
