export interface FilamentSpool {
  id: string;
  brand: string;
  name: string;
  material: 'PLA' | 'PLA Matte' | 'PLA+' | 'PETG' | 'PLA Silk' | 'CMYK Litho' | 'ABS' | 'ASA' | 'TPU' | 'COPE';
  hex: string;
  /** Transmission Distance in millimeters (100% opacity threshold on black backing) */
  td: number;
  owned?: boolean;
  amsSlot?: string; // e.g. "AMS 1 - A1"
  libraryId?: string;
  libraryName?: string;
}

export const VERIFIED_FILAMENT_CATALOG: FilamentSpool[] = [
  // Bambu Lab PLA Basic & Matte & CMYK
  { id: 'bambu-pla-black', brand: 'Bambu Lab', name: 'PLA Basic Black (10101)', material: 'PLA', hex: '#141414', td: 0.6, owned: true, amsSlot: 'AMS 1 - A1' },
  { id: 'bambu-pla-charcoal', brand: 'Bambu Lab', name: 'PLA Matte Charcoal (11101)', material: 'PLA Matte', hex: '#232428', td: 0.5, owned: true },
  { id: 'bambu-pla-dark-gray', brand: 'Bambu Lab', name: 'PLA Basic Dark Gray', material: 'PLA', hex: '#4B4E54', td: 1.4, owned: true },
  { id: 'bambu-pla-blue-gray', brand: 'Bambu Lab', name: 'PLA Basic Blue Gray (10602)', material: 'PLA', hex: '#5A6E7F', td: 2.2, owned: true },
  { id: 'bambu-pla-ash-gray', brand: 'Bambu Lab', name: 'PLA Matte Ash Gray (11102)', material: 'PLA Matte', hex: '#8F9499', td: 2.0, owned: true },
  { id: 'bambu-pla-silver', brand: 'Bambu Lab', name: 'PLA Basic Silver (10102)', material: 'PLA', hex: '#A4A9AD', td: 1.5, owned: true },
  { id: 'bambu-pla-brown', brand: 'Bambu Lab', name: 'PLA Basic Brown (10800)', material: 'PLA', hex: '#633B27', td: 1.8, owned: true, amsSlot: 'AMS 1 - A2' },
  { id: 'bambu-pla-latte-brown', brand: 'Bambu Lab', name: 'PLA Matte Latte Brown (11800)', material: 'PLA Matte', hex: '#C69C72', td: 2.8, owned: true },
  { id: 'bambu-pla-desert-tan', brand: 'Bambu Lab', name: 'PLA Matte Desert Tan (11401)', material: 'PLA Matte', hex: '#DFC7A7', td: 3.1, owned: true },
  { id: 'bambu-pla-orange', brand: 'Bambu Lab', name: 'PLA Basic Orange (10300)', material: 'PLA', hex: '#FF6A13', td: 4.8, owned: true, amsSlot: 'AMS 1 - A3' },
  { id: 'bambu-pla-mandarin-orange', brand: 'Bambu Lab', name: 'PLA Matte Mandarin Orange', material: 'PLA Matte', hex: '#F57E2E', td: 3.5, owned: true },
  { id: 'bambu-pla-gold', brand: 'Bambu Lab', name: 'PLA Basic Gold (10401)', material: 'PLA', hex: '#D8A236', td: 2.6, owned: true },
  { id: 'bambu-pla-yellow', brand: 'Bambu Lab', name: 'PLA Basic Yellow (10400)', material: 'PLA', hex: '#FCE300', td: 6.2, owned: true },
  { id: 'bambu-pla-jade-white', brand: 'Bambu Lab', name: 'PLA Basic Jade White (10100)', material: 'PLA', hex: '#F6F7F4', td: 5.0, owned: true, amsSlot: 'AMS 1 - A4' },
  { id: 'bambu-pla-ivory-white', brand: 'Bambu Lab', name: 'PLA Matte Ivory White (11100)', material: 'PLA Matte', hex: '#F1EFEA', td: 3.4, owned: true },
  { id: 'bambu-pla-red', brand: 'Bambu Lab', name: 'PLA Basic Red (10200)', material: 'PLA', hex: '#C81E2B', td: 3.8, owned: true },
  { id: 'bambu-pla-scarlet-red', brand: 'Bambu Lab', name: 'PLA Matte Scarlet Red', material: 'PLA Matte', hex: '#D62E38', td: 2.9, owned: true },
  { id: 'bambu-pla-blue', brand: 'Bambu Lab', name: 'PLA Basic Blue (10601)', material: 'PLA', hex: '#0047AB', td: 2.7, owned: true },
  { id: 'bambu-pla-cyan', brand: 'Bambu Lab', name: 'PLA Basic Cyan (10603)', material: 'PLA', hex: '#0096D6', td: 3.9, owned: true },
  { id: 'bambu-pla-green', brand: 'Bambu Lab', name: 'PLA Basic Bambu Green (10501)', material: 'PLA', hex: '#00AE42', td: 4.1, owned: true },
  { id: 'bambu-pla-mistletoe-green', brand: 'Bambu Lab', name: 'PLA Basic Mistletoe Green', material: 'PLA', hex: '#1F5C3A', td: 1.9, owned: true },
  // Bambu CMYK Lithophane Set
  { id: 'bambu-cmyk-cyan', brand: 'Bambu Lab', name: 'PLA CMYK Cyan (10603)', material: 'CMYK Litho', hex: '#0088CE', td: 3.5, owned: true },
  { id: 'bambu-cmyk-magenta', brand: 'Bambu Lab', name: 'PLA CMYK Magenta (10202)', material: 'CMYK Litho', hex: '#D81B60', td: 3.2, owned: true },
  { id: 'bambu-cmyk-yellow', brand: 'Bambu Lab', name: 'PLA CMYK Yellow (10402)', material: 'CMYK Litho', hex: '#F9E11E', td: 6.5, owned: true },
  { id: 'bambu-cmyk-white', brand: 'Bambu Lab', name: 'PLA CMYK Lithophane White', material: 'CMYK Litho', hex: '#F7F8F5', td: 4.8, owned: true },

  // Polymaker / Panchroma (PolyTerra & PolyLite)
  { id: 'poly-charcoal-black', brand: 'Polymaker', name: 'PolyTerra Charcoal Black', material: 'PLA Matte', hex: '#1B1C1E', td: 0.4, owned: true },
  { id: 'poly-earth-brown', brand: 'Polymaker', name: 'PolyTerra Earth Brown', material: 'PLA Matte', hex: '#6E4934', td: 1.2, owned: false },
  { id: 'poly-peanut', brand: 'Polymaker', name: 'PolyTerra Peanut', material: 'PLA Matte', hex: '#AC7F54', td: 2.1, owned: false },
  { id: 'poly-sunrise-orange', brand: 'Polymaker', name: 'PolyTerra Sunrise Orange', material: 'PLA Matte', hex: '#F37021', td: 3.4, owned: false },
  { id: 'poly-savannah-yellow', brand: 'Polymaker', name: 'PolyTerra Savannah Yellow', material: 'PLA Matte', hex: '#F6C63C', td: 4.2, owned: false },
  { id: 'poly-cotton-white', brand: 'Polymaker', name: 'PolyTerra Cotton White', material: 'PLA Matte', hex: '#F3F4F0', td: 2.8, owned: true },
  { id: 'poly-natural-clear', brand: 'Polymaker', name: 'PolyLite Natural Translucent', material: 'PLA', hex: '#EDEFE8', td: 22.0, owned: false },
  { id: 'poly-army-red', brand: 'Polymaker', name: 'PolyTerra Army Red', material: 'PLA Matte', hex: '#8C2323', td: 1.6, owned: false },
  { id: 'poly-sapphire-blue', brand: 'Polymaker', name: 'PolyTerra Sapphire Blue', material: 'PLA Matte', hex: '#1B4F91', td: 2.0, owned: false },

  // Sunlu & eSun & Elegoo
  { id: 'sunlu-pla-black', brand: 'Sunlu', name: 'PLA+ Black', material: 'PLA+', hex: '#151517', td: 0.7, owned: true },
  { id: 'sunlu-pla-grey', brand: 'Sunlu', name: 'PLA+ Grey', material: 'PLA+', hex: '#7A8086', td: 2.1, owned: true },
  { id: 'sunlu-pla-skin', brand: 'Sunlu', name: 'PLA+ Skin / Peach', material: 'PLA+', hex: '#F2C39E', td: 4.5, owned: false },
  { id: 'sunlu-pla-white', brand: 'Sunlu', name: 'PLA+ White', material: 'PLA+', hex: '#FAFAFA', td: 6.4, owned: true },
  { id: 'esun-pla-cold-white', brand: 'eSun', name: 'PLA+ Cold White', material: 'PLA+', hex: '#F8FAFC', td: 5.8, owned: false },
  { id: 'esun-pla-fire-engine-red', brand: 'eSun', name: 'PLA+ Fire Engine Red', material: 'PLA+', hex: '#D11A2A', td: 4.2, owned: false },
  { id: 'elegoo-pla-black', brand: 'Elegoo', name: 'PLA Black', material: 'PLA', hex: '#171717', td: 0.6, owned: false },
  { id: 'elegoo-pla-white', brand: 'Elegoo', name: 'PLA White', material: 'PLA', hex: '#F5F6F7', td: 5.2, owned: false },
];
