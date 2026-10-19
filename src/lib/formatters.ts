import type { DocumentType } from '../types/schema.ts';

const LOCALE = 'pl-PL';
const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1024 * 1024;

export const DOCUMENT_TYPE_LABELS: Readonly<Record<DocumentType, string>> = {
  umowa: 'Umowa',
  faktura: 'Faktura',
  oferta: 'Oferta',
  raport: 'Raport',
  inne: 'Inny dokument',
};

// Rounds up, so a file just over a limit never shows as exactly the limit (10 MB + 1 B → 10,1 MB).
const sizeFormatter = new Intl.NumberFormat(LOCALE, {
  maximumFractionDigits: 1,
  roundingMode: 'ceil',
});
const numberFormatter = new Intl.NumberFormat(LOCALE);
// Calendar dates carry no time zone, so they are formatted in UTC to avoid a day shift.
const calendarDateFormatter = new Intl.DateTimeFormat(LOCALE, {
  dateStyle: 'long',
  timeZone: 'UTC',
});
const timestampFormatter = new Intl.DateTimeFormat(LOCALE, {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const languageNames = new Intl.DisplayNames([LOCALE], { type: 'language' });
const pluralRules = new Intl.PluralRules(LOCALE);

const PAGE_FORMS: Readonly<Record<Intl.LDMLPluralRule, string>> = {
  zero: 'stron',
  one: 'strona',
  two: 'strony',
  few: 'strony',
  many: 'stron',
  other: 'strony',
};

export function formatFileSize(bytes: number): string {
  if (bytes < BYTES_PER_MB) {
    return `${sizeFormatter.format(bytes / BYTES_PER_KB)} kB`;
  }
  return `${sizeFormatter.format(bytes / BYTES_PER_MB)} MB`;
}

/** Formats a number with Polish grouping, e.g. 150 000. */
export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

/** Formats an amount in its ISO 4217 currency, e.g. "1 230,00 zł". */
export function formatAmount(value: number, currency: string): string {
  return new Intl.NumberFormat(LOCALE, { style: 'currency', currency }).format(value);
}

/** Formats an ISO 8601 calendar date (YYYY-MM-DD), e.g. "15 marca 2024". */
export function formatCalendarDate(isoDate: string): string {
  return calendarDateFormatter.format(new Date(`${isoDate}T00:00:00Z`));
}

/** Formats an ISO 8601 timestamp in the viewer's time zone. */
export function formatTimestamp(isoDateTime: string): string {
  return timestampFormatter.format(new Date(isoDateTime));
}

/** Polish name of an ISO 639-1 language code, e.g. "pl" becomes "polski". */
export function formatLanguage(code: string): string {
  return languageNames.of(code) ?? code;
}

/** Page count with the correct Polish plural form, e.g. "1 strona", "3 strony", "5 stron". */
export function formatPageCount(pages: number): string {
  return `${formatNumber(pages)} ${PAGE_FORMS[pluralRules.select(pages)]}`;
}
