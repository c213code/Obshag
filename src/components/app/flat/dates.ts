/** 'YYYY-MM-DD' -> 'DD.MM' (string slicing: no time zone can shift the day). */
/** 'YYYY-MM-DD' -> '20 нояб' (same abbreviations as the Telegram post). */
export const formatAwayShort = (iso: string): string =>
  `${Number(iso.slice(8, 10))} ${["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "нояб", "дек"][Number(iso.slice(5, 7)) - 1]}`;
export const formatAway = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
