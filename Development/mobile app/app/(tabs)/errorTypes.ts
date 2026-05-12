export interface ErrorTypeDisplay {
  en: string;
  color: string;
}

const ERROR_TYPES: Record<string, ErrorTypeDisplay> = {
  missing_tafkheem: { en: 'Missing Tafkheem', color: '#EF4444' },
  incorrect_tafkheem: { en: 'Incorrect Tafkheem', color: '#F59E0B' },
  missing_ghunnah: { en: 'Missing Ghunnah', color: '#EF4444' },
  missing_qalqala: { en: 'Missing Qalqala', color: '#EF4444' },
  missing_shaddah: { en: 'Missing Shaddah', color: '#EF4444' },
  missing_ikhfaa: { en: 'Missing Ikhfaa', color: '#A020F0' },
  missing_idgham_ghunnah: { en: 'Missing Idgham (Ghunnah)', color: '#169200' },
  short_vowel: { en: 'Short Vowel', color: '#F59E0B' },
  long_vowel: { en: 'Long Vowel', color: '#F59E0B' },
  madd_too_short: { en: 'Madd Too Short', color: '#F59E0B' },
  madd_too_long: { en: 'Madd Too Long', color: '#F59E0B' },
  madd_medium_too_short: { en: 'Medium Madd Too Short', color: '#F59E0B' },
  madd_medium_too_long: { en: 'Medium Madd Too Long', color: '#F59E0B' },
  madd_long_too_short: { en: 'Long Madd Too Short', color: '#F59E0B' },
  omission: { en: 'Missing Sound', color: '#EF4444' },
  insertion: { en: 'Extra Sound', color: '#F59E0B' },
  pronunciation: { en: 'Pronunciation Error', color: '#F59E0B' },
  pronunciation_ha_deep: { en: 'Ha Pronunciation', color: '#F59E0B' },
  pronunciation_ha_mid: { en: 'Ha Pronunciation', color: '#F59E0B' },
  pronunciation_ain: { en: 'Ain Pronunciation', color: '#F59E0B' },
  pronunciation_thal: { en: 'Dhal Pronunciation', color: '#F59E0B' },
};

export function getErrorTypeDisplay(errorType: string): ErrorTypeDisplay {
  return ERROR_TYPES[errorType] || { en: 'Error', color: '#EF4444' };
}
