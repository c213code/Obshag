/** 'YYYY-MM-DD' -> 'DD.MM' (string slicing: no time zone can shift the day). */
export const formatAway = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
