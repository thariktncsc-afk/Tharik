/* CRS shop names  [+]
   Added after the port; not part of TNCSC_CRS_Demo_19 (1).html, so
   tools/verify-parity.mjs skips this file (see NEW_ENGINE there).

   The ported CRS_LIST carried placeholder English names ("Madurai Central",
   "Anna Nagar", ...). These are the real shop names, transcribed from the
   office's own list, and they are applied by overwriting the name on each
   record of CRS_LIST in place.

   WHY THIS FILE SORTS WHERE IT DOES. It is the one added part that does not
   live at the end of the sequence. tools/bundle-engine.mjs concatenates by
   filename, so "02a-" lands immediately after 02-masters.js, where CRS_LIST is
   built, and before 03-daily-entry.js, whose init already fills the Daily Entry
   shop dropdown from it. Every screen, dropdown, statement and export reads
   `CRS_LIST.find(...).name` at the moment it renders, so renaming the records
   before anything reads them is all that is needed for the whole application to
   agree -- no screen keeps its own copy of a shop name.

   CRS_LIST is declared `const`, which fixes the binding, not the objects it
   holds; assigning to `.name` on each element is what the rest of the engine
   reads and is deliberate. */

var CRS_NAMES = {
  1:  'அண்ணா நகர்',
  2:  'கே. கே. நகர்',
  3:  'காந்திபுரம் – புதுார்',
  4:  'மானகிரி',
  5:  'காமராஜர் சாலை',
  6:  'இஸ்மாயில்புரம்',
  7:  'இராமசாமி அய்யர் சாலை',
  8:  'NMR ரோடு காமராஜபுரம்',
  9:  'பாலரெங்காபுரம்',
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

(function applyCrsNames(){
  if(typeof CRS_LIST === 'undefined') return;
  CRS_LIST.forEach(function(c){
    if(CRS_NAMES[c.id]) c.name = CRS_NAMES[c.id];
  });
  // CRS_SHOPS (01-core.js) held nine demo rows for the ported CRS Shops table.
  // That table is now the master in 23-crs-master.js and reads CRS_LIST, so
  // these are kept in step only so nothing left reading the old array can
  // disagree with the rest of the application.
  if(typeof CRS_SHOPS !== 'undefined'){
    CRS_SHOPS.forEach(function(s){
      var n = parseInt(String(s.code).replace(/\D/g, ''), 10);
      if(CRS_NAMES[n]) s.name = CRS_NAMES[n];
    });
  }
})();
