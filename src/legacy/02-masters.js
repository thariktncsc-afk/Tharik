/* CRS shop + commodity master tables
   Verbatim from TNCSC_CRS_Demo_19 (1).html lines 1843-1887.
   These parts are concatenated back into one classic script by
   tools/bundle-engine.mjs - the code hoists across the whole block and
   its declarations must stay global for the markup's inline handlers. */
function buildCrsTable(){
  const tbody=document.getElementById('crs-tbody');
  tbody.innerHTML=CRS_SHOPS.map((s,i)=>`
    <tr>
      <td><strong style="color:var(--navy);font-family:monospace">${s.code}</strong></td>
      <td><strong>${s.name}</strong></td>
      <td>${s.district}</td>
      <td>${s.taluk}</td>
      <td>${s.cards.toLocaleString()}</td>
      <td><span class="badge ${s.active?'badge-green':'badge-red'}">${s.active?'Active':'Inactive'}</span></td>
      <td><div class="flex gap-2">
        <button class="btn btn-outline btn-sm">Edit</button>
        <button class="btn btn-outline btn-sm" style="color:${s.active?'var(--red)':'var(--green)'}">${s.active?'Disable':'Enable'}</button>
      </div></td>
    </tr>`).join('');
}

function filterTable(input,tableId){
  const q=input.value.toLowerCase();
  document.querySelectorAll(`#${tableId} tbody tr`).forEach(tr=>{
    tr.style.display=tr.textContent.toLowerCase().includes(q)?'':'none';
  });
}


// ═══ DAILY ENTRY — TNCSC DSS OFFICIAL FORMAT ══════════════════════════════
// Based on: D.S.S. CRS 18 JUNE 26 PDF
// Section A: 19 commodities (Main Ration)
// Section B: 5 commodities (Police Ration / காவலர் அட்டை)

// CRS 1-30
const CRS_LIST = Array.from({length:30}, function(_,i){
  var names = [
    'Madurai Central','Anna Nagar','Thiruparankundram','Villapuram',
    'Sellur','Arapalayam','Koodal Nagar','Tallakulam','Alagarsami',
    'Bypass Road','KK Nagar','Teppakulam','Bibi Kulam','Ellis Nagar',
    'Alagar Kovil Rd','Nagamalai','Othakadai','Sholavandan',
    'Usilampatti','Melur','Madurai South','Madurai North',
    'Madurai East','Madurai West','Thirumangalam','Paravai',
    'Kalavasal','Goripalayam','Sundarapandiam','Avaniyapuram'
  ];
  return {id:i+1, name: names[i] || ('Shop '+(i+1))};
});

// Section A commodities — exact order from PDF
