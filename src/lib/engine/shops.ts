/**
 * The 30 CRS shops of Madurai Region — ported from CRS_LIST (02-masters.js)
 * with the office's real names from 02a-crs-names.js.
 *
 * NOT derived from the `__shops` master: that crs_state row still holds the
 * original port's nine demo records, which is why screens reading it listed
 * only CRS 1–9. The legacy app itself never reads `__shops` for its
 * dropdowns — every screen uses CRS_LIST, and so do the converted ones now.
 */
export const CRS_NAMES: Record<number, string> = {
  1: 'அண்ணா நகர்',
  2: 'கே. கே. நகர்',
  3: 'காந்திபுரம் – புதுார்',
  4: 'மானகிரி',
  5: 'காமராஜர் சாலை',
  6: 'இஸ்மாயில்புரம்',
  7: 'இராமசாமி அய்யர் சாலை',
  8: 'NMR ரோடு காமராஜபுரம்',
  9: 'பாலரெங்காபுரம்',
  10: 'சின்ன அனுப்பானடி',
  11: 'அனுப்பானடி',
  12: 'மீனாட்சிபுரம்',
  13: 'திருமால் நதி சாலை',
  14: 'கார்பன்கடை',
  15: 'ராஜா தெரு',
  16: 'சிம்மக்கல்',
  17: 'பழங்காநத்தம்',
  18: 'மேல்பொன்னகரம் பிராட்வே',
  19: 'காக்காதோப்பு',
  20: 'சுப்பிரமணியபுரம்',
  21: 'வி.பி. சதுக்கம்',
  22: 'மேற்கு பொன்னகரம்',
  23: 'திருமலை காலனி',
  24: 'ஜெய்ஹிந்புரம்',
  25: 'காஜா தெரு',
  26: 'எழில் நகர்',
  27: 'எல்லீஸ் நகர்',
  28: 'நடராஜ் தியேட்டர்',
  29: 'கூடல் நகர்',
  30: 'அனுப்பானடி',
};

export type Shop = { id: number; name: string };

/** All 30 shops, in CRS number order. */
export const SHOPS: Shop[] = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: CRS_NAMES[i + 1] }));

export const SHOP_IDS: number[] = SHOPS.map((s) => s.id);

export function shopName(id: number | string | null | undefined): string {
  return CRS_NAMES[Number(id)] ?? '';
}

export function shopLabel(id: number | string): string {
  return `CRS ${id} — ${shopName(id)}`;
}
