/* TN government holiday calendar
   Verbatim from TNCSC_CRS_Demo_19 (1).html lines 5200-5370.
   These parts are concatenated back into one classic script by
   tools/bundle-engine.mjs - the code hoists across the whole block and
   its declarations must stay global for the markup's inline handlers. */
var TN_GOVT_HOLIDAYS = {
  2025: [
    {d:'2025-01-01', name:'New Year\'s Day'},
    {d:'2025-01-14', name:'Pongal'},
    {d:'2025-01-15', name:'Thiruvalluvar Day'},
    {d:'2025-01-16', name:'Uzhavar Thirunal'},
    {d:'2025-01-26', name:'Republic Day'},
    {d:'2025-02-26', name:'Maha Shivaratri'},
    {d:'2025-04-01', name:'Ugadi / Tamil New Year (Eve)'},
    {d:'2025-04-10', name:'Good Friday'},
    {d:'2025-04-14', name:'Tamil New Year / Dr. Ambedkar Jayanthi'},
    {d:'2025-05-01', name:'May Day / Labour Day'},
    {d:'2025-06-07', name:'Eid ul-Adha'},
    {d:'2025-08-15', name:'Independence Day'},
    {d:'2025-08-16', name:'Krishna Jayanthi'},
    {d:'2025-09-05', name:'Vinayagar Chaturthi'},
    {d:'2025-10-02', name:'Gandhi Jayanthi'},
    {d:'2025-10-02', name:'Mahalaya Amavasai'},
    {d:'2025-10-20', name:'Ayutha Pooja'},
    {d:'2025-10-21', name:'Vijaya Dasami'},
    {d:'2025-11-01', name:'Deepavali'},
    {d:'2025-12-25', name:'Christmas Day'},
  ],
  2026: [
    {d:'2026-01-01', name:'New Year\'s Day'},
    {d:'2026-01-14', name:'Pongal'},
    {d:'2026-01-15', name:'Thiruvalluvar Day'},
    {d:'2026-01-16', name:'Uzhavar Thirunal'},
    {d:'2026-01-26', name:'Republic Day'},
    {d:'2026-02-15', name:'Maha Shivaratri'},
    {d:'2026-03-22', name:'Holi'},
    {d:'2026-04-03', name:'Good Friday'},
    {d:'2026-04-14', name:'Tamil New Year / Dr. Ambedkar Jayanthi'},
    {d:'2026-04-15', name:'Mahavir Jayanthi'},
    {d:'2026-05-01', name:'May Day / Labour Day'},
    {d:'2026-05-24', name:'Buddha Purnima'},
    {d:'2026-06-27', name:'Eid ul-Adha'},
    {d:'2026-07-17', name:'Muharram'},
    {d:'2026-08-15', name:'Independence Day'},
    {d:'2026-08-25', name:'Krishna Jayanthi'},
    {d:'2026-09-17', name:'Vinayagar Chaturthi'},
    {d:'2026-10-02', name:'Gandhi Jayanthi'},
    {d:'2026-10-08', name:'Ayutha Pooja'},
    {d:'2026-10-09', name:'Vijaya Dasami'},
    {d:'2026-10-19', name:'Deepavali'},
    {d:'2026-11-05', name:'Milad-un-Nabi'},
    {d:'2026-12-25', name:'Christmas Day'},
  ],
  2027: [
    {d:'2027-01-01', name:'New Year\'s Day'},
    {d:'2027-01-14', name:'Pongal'},
    {d:'2027-01-15', name:'Thiruvalluvar Day'},
    {d:'2027-01-16', name:'Uzhavar Thirunal'},
    {d:'2027-01-26', name:'Republic Day'},
    {d:'2027-04-14', name:'Tamil New Year / Dr. Ambedkar Jayanthi'},
    {d:'2027-05-01', name:'May Day / Labour Day'},
    {d:'2027-08-15', name:'Independence Day'},
    {d:'2027-10-02', name:'Gandhi Jayanthi'},
    {d:'2027-12-25', name:'Christmas Day'},
  ]
};

var MONTH_NAMES_FULL = ['January','February','March','April','May','June',
                        'July','August','September','October','November','December'];

function isGovtHoliday(dateObj, yr){
  var ds=dateObj.toISOString().split('T')[0];
  var list=(TN_GOVT_HOLIDAYS[yr]||[]);
  return list.some(function(h){return h.d===ds;});
}
function getGovtHolidayName(dateObj, yr){
  var ds=dateObj.toISOString().split('T')[0];
  var list=(TN_GOVT_HOLIDAYS[yr]||[]);
  var found=list.find(function(h){return h.d===ds;});
  return found?found.name:null;
}

function openHolidayCalendar(){
  var overlay=document.getElementById('holiday-cal-overlay');
  if(overlay){overlay.style.display='flex'; renderHolidayCal();}
}
function closeHolidayCalendar(){
  var overlay=document.getElementById('holiday-cal-overlay');
  if(overlay) overlay.style.display='none';
}

// Close on overlay click
document.addEventListener('click',function(e){
  var overlay=document.getElementById('holiday-cal-overlay');
  if(overlay&&e.target===overlay) overlay.style.display='none';
});

function renderHolidayCal(){
  var grid=document.getElementById('hcal-grid');
  var listEl=document.getElementById('hcal-holiday-list');
  var yrSel=document.getElementById('hcal-year');
  if(!grid||!yrSel) return;

  var yr=parseInt(yrSel.value)||2026;
  var govtList=TN_GOVT_HOLIDAYS[yr]||[];

  // Render all 12 months
  var allHtml='';
  for(var mo=0;mo<12;mo++){
    var firstDay=new Date(yr,mo,1).getDay(); // 0=Sun
    var daysInMonth=new Date(yr,mo+1,0).getDate();
    var monthHtml='<div style="background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden">';
    monthHtml+='<div style="background:#0369A1;color:#fff;padding:6px 10px;font-size:12px;font-weight:800;text-align:center">'+MONTH_NAMES_FULL[mo]+' '+yr+'</div>';
    monthHtml+='<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;padding:4px">';
    // Day headers
    ['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(function(d,i){
      var col=i===0?'#9333EA':(i===6?'#0369A1':'#6B7A8F');
      monthHtml+='<div style="text-align:center;font-size:8px;font-weight:700;color:'+col+';padding:2px 0">'+d+'</div>';
    });
    // Empty cells before first day
    for(var e=0;e<firstDay;e++){
      monthHtml+='<div></div>';
    }
    // Days
    for(var d2=1;d2<=daysInMonth;d2++){
      var dateObj=new Date(yr,mo,d2);
      var dow=dateObj.getDay();
      var dt=dateObj.getDate();
      var f=new Date(yr,mo,1).getDay();
      var weekNum=Math.ceil((dt+f)/7);

      var isFri12 = dow===5&&(weekNum===1||weekNum===2);
      var isSun34 = dow===0&&(weekNum===3||weekNum===4);
      var isGovt  = isGovtHoliday(dateObj,yr);
      var isHol   = isFri12||isSun34||isGovt;

      var govtName=getGovtHolidayName(dateObj,yr);

      var bg='transparent', color='#1A2332', fw='400', radius='4px';
      var title='';
      if(isFri12){ bg='#FED7AA'; color='#C2410C'; fw='700'; title=(weekNum===1?'1st':'2nd')+' Friday Holiday'; }
      else if(isSun34){ bg='#E9D5FF'; color='#7C3AED'; fw='700'; title=(weekNum===3?'3rd':'4th')+' Sunday Holiday'; }
      else if(isGovt){ bg='#FEE2E2'; color='#B91C1C'; fw='700'; title=govtName||'Govt Holiday'; }
      else if(dow===0){ color='#9333EA'; } // regular sunday
      else if(dow===6){ color='#0369A1'; } // regular saturday

      // Today highlight
      var todayD=new Date();
      var isToday=todayD.getDate()===d2&&todayD.getMonth()===mo&&todayD.getFullYear()===yr;
      if(isToday&&!isHol){ bg='#DBEAFE'; color='#1D4ED8'; fw='800'; radius='50%'; title='Today'; }
      else if(isToday&&isHol){ fw='900'; radius='50%'; }

      monthHtml+='<div title="'+title+'" style="text-align:center;padding:2px;cursor:default">';
      monthHtml+='<div style="width:18px;height:18px;border-radius:'+radius+';margin:0 auto;'+
        'background:'+bg+';color:'+color+';font-size:9px;font-weight:'+fw+';'+
        'display:flex;align-items:center;justify-content:center;'+
        (isGovt&&!isFri12&&!isSun34?'outline:1px solid #EF4444;':'')+'">'+d2+'</div>';
      monthHtml+='</div>';
    }
    monthHtml+='</div></div>';
    allHtml+=monthHtml;
  }
  grid.innerHTML=allHtml;

  // Holiday list
  var chips=govtList.map(function(h){
    var d=new Date(h.d+'T00:00:00');
    var label=d.toLocaleDateString('en-IN',{day:'numeric',month:'short'})+' \u2014 '+h.name;
    return '<span style="display:inline-flex;align-items:center;background:#FEE2E2;color:#B91C1C;font-size:10px;font-weight:600;padding:3px 8px;border-radius:5px;border:1px solid #FECACA">'+label+'</span>';
  }).join('');
  if(listEl) listEl.innerHTML=chips||'<span style="color:var(--muted);font-size:12px">No holidays defined for this year</span>';
}

// ═══ STATEMENT GENERATION SYSTEM ══════════════════════════════════════════

// Statement section definitions (from the 15 PDF documents)
