'use strict';
// =================== ProjecTyzer frontend ===================

const ZOOMS = {
  day:      { pxDay: 42,  tick: 'day' },
  week:     { pxDay: 16,  tick: 'week' },
  month:    { pxDay: 6,   tick: 'month' },
  quarter:  { pxDay: 2.4, tick: 'quarter' },
  semester: { pxDay: 1.4, tick: 'semester' },
  year:     { pxDay: 0.8, tick: 'year' },
};
const PALETTE = ['#3b82f6','#8b5cf6','#22c55e','#f59e0b','#06b6d4','#ec4899',
  '#14b8a6','#84cc16','#a855f7','#0ea5e9','#eab308','#10b981','#6366f1','#f97316','#d946ef'];
const RED = '#ef4444';
const ROW_H = 56;
const DAY_MS = 86400000;

const state = { domains: [], tasks: [], zoom: 'week', viewStart: null, geom: {}, boardFilter: { doing: true, ended: true } };
let initialScrollDone = false;

const $ = (s) => document.querySelector(s);
const api = {
  async get(u){ return (await fetch(u)).json(); },
  async send(u, m, b){ return (await fetch(u, {method:m, headers:{'Content-Type':'application/json'}, body: b?JSON.stringify(b):undefined})).json(); },
};
const iso = (d) => new Date(d).toISOString().slice(0,10);
const today = () => { const d=new Date(); d.setHours(0,0,0,0); return d; };
const addDays = (d,n) => { const x=new Date(d); x.setDate(x.getDate()+n); return x; };
const dayDiff = (a,b) => Math.round((new Date(a)-new Date(b))/DAY_MS);
const getEndDateStr = (startStr, scopeWeeks) => {
  if (!startStr) return '';
  const d = new Date(startStr);
  const days = Math.ceil(Number(scopeWeeks) * 7);
  return iso(addDays(d, days));
};

// =================== LOAD ===================
async function loadAll(){
  state.domains = await api.get('/api/domains');
  state.tasks = await api.get('/api/tasks');
  computeViewStart();
  renderBacklog();
  renderBoard();
  renderSummary();
}

// =================== RESUMEN (panel inferior) ===================
const summaryFilter={ backlog:true, doing:true, ended:false };
function renderSummary(){
  const body=$('#summaryBody');
  const items=state.tasks.filter(t=>summaryFilter[t.status]);
  $('#summaryCount').textContent=`(${items.length})`;
  if(!items.length){ body.innerHTML='<p class="hint" style="padding:12px 14px">No hay proyectos para los filtros seleccionados.</p>'; return; }
  items.sort((a,b)=>(Number(b.is_priority)-Number(a.is_priority)) || (new Date(a.start_date||0)-new Date(b.start_date||0)));
  body.innerHTML=`<table class="summary-table">
    <thead><tr><th>Estado</th><th>Proyecto</th><th>Dueño</th><th>Dominio</th><th>Inicio</th><th>Alcance</th><th>Desviación</th></tr></thead>
    <tbody>${items.map(t=>{
      const dev=devDaysClient(t);
      return `<tr data-id="${t.id}">
        <td><span class="st st-${t.status}">${t.status}</span>${t.is_priority?'<span class="st st-pri">⚡</span>':''}</td>
        <td>${esc(t.name)}</td>
        <td>${esc(t.owner||'—')}</td>
        <td>${esc(domName(t.domain_id))}</td>
        <td>${t.start_date?iso(t.start_date):'—'}</td>
        <td>${t.scope_weeks}s</td>
        <td>${dev>0?`<span class="dev-pos">+${dev}d</span>`:'<span class="dev-zero">0</span>'}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
  body.querySelectorAll('tr[data-id]').forEach(tr=>tr.onclick=()=>{ const t=state.tasks.find(x=>x.id==tr.dataset.id); if(t) openTask(t); });
}
$('#summaryToggle').onclick=()=>{
  const s=$('#summary'); s.classList.toggle('collapsed');
  $('#summaryToggle').textContent = s.classList.contains('collapsed')?'▸':'▾';
};
document.querySelectorAll('#summaryFilters button').forEach(b=>{
  b.onclick=()=>{ const st=b.dataset.st; summaryFilter[st]=!summaryFilter[st]; b.classList.toggle('active',summaryFilter[st]); renderSummary(); };
});
function computeViewStart(){
  let min = today(), max = addDays(today(), 90);
  for(const t of state.tasks){
    if(t.start_date){
      const s = new Date(t.start_date);
      if(s<min) min=s;
      const e = addDays(s, Math.ceil(t.scope_weeks*7));
      if(e>max) max=e;
    }
  }
  state.viewStart = addDays(min, -14);
  state.viewEnd = addDays(max, 21);
}
const px = (date) => dayDiff(date, state.viewStart) * ZOOMS[state.zoom].pxDay;
const widthFor = (weeks) => Math.max(34, weeks*7*ZOOMS[state.zoom].pxDay);

// ----- helpers visuales -----
function initials(name){ if(!name) return ''; return name.split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join(''); }
function domName(id){ const d=state.domains.find(x=>x.id===id); return d?d.name:'—'; }
function devDaysClient(t){
  const base=(t.start_date&&t.baseline_start)?Math.round((new Date(t.start_date)-new Date(t.baseline_start))/DAY_MS):0;
  return base + Number(t.priority_shift_days||0);
}
function progressPct(t){
  if(t.status==='ended') return 100;
  if(t.status!=='doing'||!t.start_date) return 0;
  const dur=Math.max(1,Math.ceil(Number(t.scope_weeks)*7));
  const elapsed=(today()-new Date(t.start_date))/DAY_MS;
  return Math.max(0,Math.min(100,Math.round(elapsed/dur*100)));
}

// ----- ventanas de tareas prioritarias (cortan/parten el trabajo) -----
let WINDOWS = [];
function priorityFullDays(t){
  let m=Math.ceil(Number(t.scope_weeks)*7);
  for(const s of (t.subtasks||[])) m=Math.max(m, Math.round(Number(s.offset_weeks)*7)+Math.ceil(Number(s.scope_weeks)*7));
  return m;
}
// Cada ventana lleva el conjunto de dominios (horizontales) que la roja afecta:
// su propio dominio + los dominios de sus subtareas. Solo esas filas se cortan.
function priorityWindows(){
  const list = [];
  for (const t of state.tasks) {
    if (!t.is_priority || t.status === 'ended' || !t.start_date) continue;
    if (t.domain_id) {
      const s = new Date(t.start_date);
      const e = addDays(s, Math.ceil(Number(t.scope_weeks)*7));
      list.push({ s, e, domains: new Set([t.domain_id]) });
    }
    for (const sub of (t.subtasks || [])) {
      if (sub.domain_id) {
        const s = addDays(new Date(t.start_date), Math.round(Number(sub.offset_weeks)*7));
        const e = addDays(s, Math.ceil(Number(sub.scope_weeks)*7));
        list.push({ s, e, domains: new Set([sub.domain_id]) });
      }
    }
  }
  return list.sort((a,b) => a.s - b.s);
}
// Divide [start, start+durNum] saltando las ventanas prioritarias -> segmentos
function segmentize(start, durNum, windows){
  let cursor=new Date(start); let remaining=durNum; const segs=[];
  for(const w of windows){
    if(w.e<=cursor) continue;
    const curEnd=addDays(cursor, remaining);
    if(w.s>=curEnd) break;
    if(w.s<=cursor){ cursor=new Date(w.e); continue; }     // arranca dentro -> espera al fin
    const before=Math.round((w.s-cursor)/DAY_MS);
    if(before>0){ segs.push([new Date(cursor), new Date(w.s)]); remaining-=before; }
    cursor=new Date(w.e);                                   // reanuda tras la prioritaria
  }
  segs.push([new Date(cursor), addDays(cursor, remaining)]);
  return segs;
}

// =================== BACKLOG ===================
function renderBacklog(){
  const list = $('#backlogList'); list.innerHTML='';
  const items = state.tasks.filter(t=>t.status==='backlog');
  if(!items.length){ list.innerHTML='<p class="hint">Sin tareas en backlog.</p>'; }
  for(const t of items){
    const dom = state.domains.find(d=>d.id===t.domain_id);
    const el = document.createElement('div');
    el.className='bcard'; el.draggable=true; el.style.borderLeftColor=t.color;
    el.innerHTML=`<div class="bt">${t.is_priority?'⚡ ':''}${esc(t.name)}</div>
      <div class="bm">${esc(t.owner||'—')} · ${t.scope_weeks} sem${dom?(' · '+esc(dom.name)):''}</div>`;
    el.addEventListener('dragstart', e=>{ e.dataTransfer.setData('text/plain', String(t.id)); });
    el.addEventListener('click', ()=>openTask(t));
    list.appendChild(el);
  }
}

// =================== BOARD GEOMETRY ===================
function computeGeom(){
  WINDOWS = priorityWindows();

  // --- Greedy lane packing for TASKS within each domain ---
  // Group non-backlog tasks by domain, sort by start_date, then pack greedily
  const tasksByDomain = {};
  const computedLanes = {}; // taskId -> computed lane
  for(const t of state.tasks){
    if(t.status==='backlog'||!t.domain_id||!t.start_date) continue;
    if(t.is_priority) continue; // priority tasks are rendered differently
    if(!state.boardFilter[t.status]) continue;
    (tasksByDomain[t.domain_id] = tasksByDomain[t.domain_id] || []).push(t);
  }
  const projRows = {};
  for(const d of state.domains) projRows[d.id]=1;
  for(const domId of Object.keys(tasksByDomain)){
    const tasks = tasksByDomain[domId];
    tasks.sort((a,b) => new Date(a.start_date) - new Date(b.start_date));
    const laneEndsForDom = []; // each entry is the end-date of the last task placed in that lane
    for(const t of tasks){
      const tStart = new Date(t.start_date);
      const tEnd = addDays(tStart, Math.ceil(Number(t.scope_weeks)*7));
      let placed = false;
      for(let i=0; i<laneEndsForDom.length; i++){
        if(tStart >= laneEndsForDom[i]){
          laneEndsForDom[i] = tEnd;
          computedLanes[t.id] = i;
          placed = true;
          break;
        }
      }
      if(!placed){
        computedLanes[t.id] = laneEndsForDom.length;
        laneEndsForDom.push(tEnd);
      }
    }
    projRows[domId] = Math.max(1, laneEndsForDom.length);
  }

  // Empaquetar SUBRUTINAS en filas dedicadas DEBAJO de los proyectos, sin montarse.
  const subItems=[];
  for(const t of state.tasks){
    if(t.is_priority||t.status==='backlog'||!t.domain_id||!t.start_date) continue;
    if(!state.boardFilter[t.status]) continue;
    for(const s of (t.subtasks||[])){
      if(!s.domain_id) continue;
      const start=addDays(new Date(t.start_date), Math.round(Number(s.offset_weeks)*7));
      const dur=Math.ceil(Number(s.scope_weeks)*7);
      const wins=WINDOWS.filter(w=>w.domains.has(s.domain_id));
      const segs=segmentize(start, dur, wins);
      subItems.push({domain:s.domain_id, start, end:segs[segs.length-1][1], key:t.id+'-'+s.id});
    }
  }
  subItems.sort((a,b)=>a.start-b.start);
  const subLanes={}, laneEnds={};
  for(const it of subItems){
    const lanes=laneEnds[it.domain]=laneEnds[it.domain]||[];
    let placed=false;
    for(let i=0;i<lanes.length;i++){ if(it.start>=lanes[i]){ lanes[i]=it.end; subLanes[it.key]=i; placed=true; break; } }
    if(!placed){ lanes.push(it.end); subLanes[it.key]=lanes.length-1; }
  }
  const subRows={};
  for(const d of state.domains) subRows[d.id]=(laneEnds[d.id]||[]).length;

  let y=0; const bandTop={}, bandH={};
  const GAP = 16;
  for(let i=0; i<state.domains.length; i++){
    const d=state.domains[i];
    const r=(projRows[d.id]||1)+(subRows[d.id]||0);
    const h=r*ROW_H + 16;
    bandTop[d.id]=y; bandH[d.id]=h;
    y += h;
    if(i < state.domains.length - 1) y += GAP;
  }
  state.geom = { rows:projRows, projRows, subRows, subLanes, computedLanes, bandTop, bandH, totalH:y };
}

function renderBoard(){
  computeGeom();
  const z = ZOOMS[state.zoom];
  const totalDays = dayDiff(state.viewEnd, state.viewStart);
  const canvasW = Math.max(1200, totalDays*z.pxDay);
  const inner = $('#boardInner');
  inner.style.setProperty('--canvasW', canvasW+'px');
  inner.style.setProperty('--canvasH', Math.max(300,state.geom.totalH)+'px');

  renderAxis(canvasW);
  renderRail();
  renderCanvas(canvasW);

  if (!initialScrollDone) {
    const todayPx = px(today());
    const oneWeekPx = 7 * z.pxDay;
    $('#board').scrollLeft = Math.max(0, todayPx - oneWeekPx);
    initialScrollDone = true;
  }
  adjustBlockTexts();
}

function renderAxis(canvasW){
  const axis = $('#axis'); axis.innerHTML='';
  const z = ZOOMS[state.zoom];
  let cur = new Date(state.viewStart);
  const end = state.viewEnd;
  const step = z.tick;
  const fmt = (d)=>d.toLocaleDateString('es',{day:'2-digit',month:'short'});

  function tick(date, major, label, sub){
    const x = px(date);
    const t = document.createElement('div');
    t.className='tick'+(major?' major':''); t.style.left=x+'px';
    axis.appendChild(t);
    if(label){ const l=document.createElement('div'); l.className='tick-label'; l.style.left=x+'px'; l.textContent=label; axis.appendChild(l);}
    if(sub){ const s=document.createElement('div'); s.className='tick-sub'; s.style.left=x+'px'; s.textContent=sub; axis.appendChild(s);}
  }

  // alinear inicio
  if(step==='week'){ while(cur.getDay()!==1) cur=addDays(cur,1); }
  if(['month','quarter','semester','year'].includes(step)){ cur=new Date(cur.getFullYear(),cur.getMonth(),1); }

  while(cur<=end){
    if(step==='day'){
      const major = cur.getDay()===1;
      tick(cur, major, fmt(cur), cur.toLocaleDateString('es',{weekday:'short'}));
      cur=addDays(cur,1);
    } else if(step==='week'){
      tick(cur, cur.getDate()<=7, 'Sem '+isoWeek(cur), fmt(cur));
      cur=addDays(cur,7);
    } else if(step==='month'){
      tick(cur, cur.getMonth()===0, cur.toLocaleDateString('es',{month:'short',year:'2-digit'}));
      cur=new Date(cur.getFullYear(),cur.getMonth()+1,1);
    } else if(step==='quarter'){
      const q=Math.floor(cur.getMonth()/3)+1;
      if(cur.getMonth()%3===0) tick(cur, q===1, 'Q'+q+' '+(''+cur.getFullYear()).slice(2));
      cur=new Date(cur.getFullYear(),cur.getMonth()+1,1);
    } else if(step==='semester'){
      if(cur.getMonth()===0||cur.getMonth()===6) tick(cur, cur.getMonth()===0, 'H'+(cur.getMonth()<6?1:2)+' '+cur.getFullYear());
      cur=new Date(cur.getFullYear(),cur.getMonth()+1,1);
    } else if(step==='year'){
      if(cur.getMonth()===0) tick(cur, true, ''+cur.getFullYear());
      cur=new Date(cur.getFullYear(),cur.getMonth()+1,1);
    }
  }
}
function isoWeek(d){ const x=new Date(d); x.setHours(0,0,0,0); x.setDate(x.getDate()+3-((x.getDay()+6)%7)); const w1=new Date(x.getFullYear(),0,4); return 1+Math.round(((x-w1)/DAY_MS-3+((w1.getDay()+6)%7))/7); }

function renderRail(){
  const rail = $('#rail'); rail.innerHTML='';
  state.domains.forEach((d, i)=>{
    const it=document.createElement('div');
    it.className='rail-item';
    it.style.top=state.geom.bandTop[d.id]+'px';
    it.style.height=state.geom.bandH[d.id]+'px';
    const col=d.color||'#64748b';
    it.style.setProperty('--rail-color', col);
    it.style.background=`linear-gradient(90deg, ${col}1a 0%, transparent 100%)`;
    it.innerHTML=`<span class="rail-dot" style="background:${d.color}"></span>${esc(d.name)}`;
    it.title='Arrastra para reordenar, haz clic para gestionar';
    attachDomainDrag(it, d, i);
    rail.appendChild(it);
  });
}

function attachDomainDrag(el, d, index) {
  let sy, moved = false, startTop, dragging = false;
  el.style.cursor = 'grab';
  
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    moved = false;
    sy = e.clientY;
    startTop = parseFloat(el.style.top) || 0;
    el.setPointerCapture(e.pointerId);
    el.style.zIndex = '100';
    el.style.cursor = 'grabbing';
    el.style.boxShadow = '0 8px 24px rgba(0,0,0,0.5)';
    el.style.opacity = '0.9';
  });
  
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dy = e.clientY - sy;
    if (Math.abs(dy) > 4) moved = true;
    if (moved) {
      el.style.top = (startTop + dy) + 'px';
    }
  });
  
  el.addEventListener('pointerup', async (e) => {
    if (!dragging) return;
    dragging = false;
    el.style.zIndex = '';
    el.style.cursor = 'grab';
    el.style.boxShadow = '';
    el.style.opacity = '';
    
    if (!moved) {
      openDomains();
      return;
    }
    
    const finalTop = parseFloat(el.style.top) || 0;
    const items = state.domains.map((dom) => {
      let tempTop = state.geom.bandTop[dom.id];
      if (dom.id === d.id) {
        tempTop = finalTop;
      }
      return { id: dom.id, top: tempTop };
    });
    
    items.sort((a, b) => a.top - b.top);
    
    for (let k = 0; k < items.length; k++) {
      await api.send('/api/domains/' + items[k].id, 'PUT', { position: k });
    }
    await loadAll();
  });
}

function renderCanvas(canvasW){
  const c = $('#canvas'); c.innerHTML='';
  WINDOWS = priorityWindows();
  // bandas — each domain gets a tinted background based on its color
  for(let di=0; di<state.domains.length; di++){
    const d=state.domains[di];
    const b=document.createElement('div');
    b.className='lane-band';
    b.style.top=state.geom.bandTop[d.id]+'px';
    b.style.height=state.geom.bandH[d.id]+'px';
    b.dataset.domain=d.id;
    const col=d.color||'#64748b';
    b.style.setProperty('--band-color', col);
    const alpha = di % 2 === 0 ? 0.07 : 0.12;
    const hexA = Math.round(alpha*255).toString(16).padStart(2,'0');
    const hexA2 = Math.round(alpha*0.3*255).toString(16).padStart(2,'0');
    b.style.background=`linear-gradient(90deg, ${col}${hexA} 0%, ${col}${hexA2} 100%)`;
    c.appendChild(b);
  }
  // bandas de fin de semana (sábado y domingo) — solo en escalas finas
  const pxDay=ZOOMS[state.zoom].pxDay;
  if(pxDay>=8){
    let cur=new Date(state.viewStart);
    while(cur.getDay()!==6) cur=addDays(cur,1);   // primer sábado
    for(; cur<=state.viewEnd; cur=addDays(cur,7)){
      const wb=document.createElement('div'); wb.className='weekend-band';
      wb.style.left=px(cur)+'px'; wb.style.width=(2*pxDay)+'px';
      wb.style.height=state.geom.totalH+'px';
      c.appendChild(wb);
    }
  }

  // Bandas periodicas (mes, Q, H, año) con colores difuminados y semitransparentes
  if (['month', 'quarter', 'semester', 'year'].includes(state.zoom)) {
    let cur = new Date(state.viewStart);
    cur = new Date(cur.getFullYear(), cur.getMonth(), 1); // alinear al 1 de mes

    const colors = [
      'rgba(59, 130, 246, 0.04)',   // Azul sutil
      'rgba(139, 92, 246, 0.04)',   // Violeta sutil
      'rgba(16, 185, 129, 0.04)',   // Verde sutil
      'rgba(245, 158, 11, 0.04)',   // Ámbar sutil
    ];
    let colorIdx = 0;

    while (cur <= state.viewEnd) {
      let isBoundary = false;
      
      if (state.zoom === 'month') {
        isBoundary = true;
      } else if (state.zoom === 'quarter') {
        isBoundary = (cur.getMonth() % 3 === 0);
      } else if (state.zoom === 'semester') {
        isBoundary = (cur.getMonth() === 0 || cur.getMonth() === 6);
      } else if (state.zoom === 'year') {
        isBoundary = (cur.getMonth() === 0);
      }

      if (isBoundary) {
        let next = new Date(cur);
        if (state.zoom === 'month') {
          next.setMonth(next.getMonth() + 1);
        } else if (state.zoom === 'quarter') {
          next.setMonth(next.getMonth() + 3);
        } else if (state.zoom === 'semester') {
          next.setMonth(next.getMonth() + 6);
        } else if (state.zoom === 'year') {
          next.setFullYear(next.getFullYear() + 1);
        }

        const left = px(cur);
        const right = px(next);
        const width = right - left;

        if (width > 0) {
          const bgCol = colors[colorIdx % colors.length];
          colorIdx++;

          const band = document.createElement('div');
          band.className = 'period-band';
          band.style.left = left + 'px';
          band.style.width = width + 'px';
          band.style.height = state.geom.totalH + 'px';
          band.style.background = `linear-gradient(90deg, ${bgCol} 0%, rgba(15, 23, 42, 0) 100%)`;
          band.style.borderLeft = `1px dashed ${bgCol.replace('0.04', '0.25')}`;
          c.appendChild(band);
        }
      }

      cur.setMonth(cur.getMonth() + 1);
    }
  }

  // linea de hoy
  const tl=document.createElement('div'); tl.className='today-line'; tl.style.left=px(today())+'px'; c.appendChild(tl);
  const tag=document.createElement('div'); tag.className='today-tag'; tag.textContent='HOY'; tag.style.left=px(today())+'px'; c.appendChild(tag);

  // bloques
  for(const t of state.tasks){
    if(t.status==='backlog') continue;
    if(t.is_priority) {
      if(!state.boardFilter[t.status]) continue;
      renderPriorityBlock(c, t);
    } else {
      if(!t.domain_id) continue;
      if(!state.boardFilter[t.status]) continue;
      renderTaskBlock(c, t);
    }
  }
}

function blockBase(t){
  const el=document.createElement('div');
  el.className='block '+t.status;
  el.style.left=px(t.start_date)+'px';
  el.style.width=widthFor(Number(t.scope_weeks))+'px';
  el.style.background=t.color;
  el.dataset.id=t.id;
  return el;
}

// Dibuja una tarea (o subtarea) como segmentos partidos por las prioritarias
function drawSegments(c, t, baseStart, durNum, top, opts){
  // solo cortan las prioritarias que afectan a ESTA horizontal (dominio)
  const wins=WINDOWS.filter(w=>w.domains.has(opts.domain)).sort((a,b)=>a.s-b.s);
  const segs=segmentize(baseStart, durNum, wins);
  segs.forEach((seg,i)=>{
    const left=px(seg[0]); const w=Math.max(8, px(seg[1])-left);
    const el=document.createElement('div');
    el.className='block '+t.status
      +(opts.sub?' sub':'')
      +(i>0?' cont':'')          // tramo que reanuda (corte a la izquierda)
      +(i<segs.length-1?' cut':''); // tramo interrumpido (corte a la derecha)
    el.style.left=left+'px'; el.style.width=w+'px';
    el.style.top=top+'px'; el.style.height=(ROW_H-16)+'px';
    el.style.background=t.color; el.dataset.id=t.id;
    if(opts.sub){
      el.innerHTML = i===0
        ? `<div class="block-text"><div class="bn">↳ ${esc(opts.label)}</div><div class="bo">dep. de ${esc(t.name)}</div></div>`
        : `<div class="block-text"><div class="bn">↪ continúa</div></div>`;
      if(i===0 && opts.subObj) attachSubBlock(el, t, opts.subObj); // arrastrable en el tiempo
      else el.addEventListener('click', ()=>openTask(t));
    } else {
      if(i===0){
        const dev=devDaysClient(t), ini=initials(t.owner), prog=progressPct(t);
        el.title=`${t.name}\nDueño: ${t.owner||'—'}\nDominio: ${domName(t.domain_id)}\nInicio: ${iso(t.start_date)} · ${t.scope_weeks} sem\nEstado: ${t.status}${dev>0?`\nDesviación: +${dev} d`:''}`;
        el.innerHTML=`<div class="block-text">`
          +`<div class="bn">${ini?`<span class="bchip">${esc(ini)}</span>`:''}${esc(t.name)}</div>`
          +`<div class="bo">${esc(t.owner||'—')}</div>`
          +`</div>`
          +`<span class="scope-tag">${t.scope_weeks}s</span>`
          +(dev>0?`<span class="dev-badge">+${dev}d</span>`:'')
          +(t.status==='doing'?`<span class="progress" style="width:${prog}%"></span>`:'');
        attachBlock(el, t, true);
      } else {
        el.innerHTML=`<div class="block-text"><div class="bn">↪ ${esc(t.name)} (continúa)</div></div>`;
        el.addEventListener('click', ()=>openTask(t));
      }
    }
    c.appendChild(el);
  });
}

function renderTaskBlock(c, t){
  const packedLane = state.geom.computedLanes[t.id] !== undefined ? state.geom.computedLanes[t.id] : (t.lane||0);
  const top=state.geom.bandTop[t.domain_id]+ packedLane*ROW_H + 8;
  const durNum=Math.ceil(Number(t.scope_weeks)*7);
  drawSegments(c, t, new Date(t.start_date), durNum, top, {sub:false, domain:t.domain_id});

  // subrutinas cross-dominio (también se parten si las cruza una prioritaria)
  for(const s of (t.subtasks||[])){
    if(!s.domain_id) continue;
    const subStart=addDays(new Date(t.start_date), Math.round(Number(s.offset_weeks)*7));
    const projRows=state.geom.projRows[s.domain_id]||1;
    const subLane=state.geom.subLanes[t.id+'-'+s.id]||0;
    const subTop=state.geom.bandTop[s.domain_id]+(projRows+subLane)*ROW_H+8; // SIEMPRE debajo de los proyectos
    const subDur=Math.ceil(Number(s.scope_weeks)*7);
    drawSegments(c, t, subStart, subDur, subTop, {sub:true, label:s.name||t.name, domain:s.domain_id, subObj:s});
    // conector vertical situado en el INICIO de la subrutina (no cruza la prioritaria)
    const line=document.createElement('div'); line.className='dep-line';
    const y1=state.geom.bandTop[t.domain_id]+(t.lane||0)*ROW_H+ROW_H/2;
    const y2=subTop+(ROW_H-16)/2;
    line.style.left=px(subStart)+'px';
    line.style.top=Math.min(y1,y2)+'px';
    line.style.height=Math.abs(y2-y1)+'px';
    c.appendChild(line);
  }
}

// Tarea prioritaria: se dibuja SOLO sobre las horizontales que afecta
// con la duración y offset correspondientes a ese dominio específico.
function renderPriorityBlock(c, t){
  for (const d of state.domains) {
    const intervals = [];
    if (t.domain_id === d.id) {
      const s = new Date(t.start_date);
      intervals.push({ s, e: addDays(s, Math.ceil(Number(t.scope_weeks)*7)) });
    }
    for (const sub of (t.subtasks || [])) {
      if (sub.domain_id === d.id) {
        const s = addDays(new Date(t.start_date), Math.round(Number(sub.offset_weeks)*7));
        intervals.push({ s, e: addDays(s, Math.ceil(Number(sub.scope_weeks)*7)) });
      }
    }
    if (intervals.length === 0) continue;

    intervals.sort((a,b) => a.s - b.s);
    const merged = [];
    for (const item of intervals) {
      if (merged.length === 0) {
        merged.push(item);
      } else {
        const last = merged[merged.length - 1];
        if (item.s <= last.e) {
          last.e = new Date(Math.max(last.e, item.e));
        } else {
          merged.push(item);
        }
      }
    }

    merged.forEach((interval) => {
      const left = px(interval.s);
      const width = Math.max(34, dayDiff(interval.e, interval.s) * ZOOMS[state.zoom].pxDay);
      const top = state.geom.bandTop[d.id];
      const bottom = top + state.geom.bandH[d.id];
      const el = document.createElement('div');
      el.className = 'block priority ' + t.status;
      el.style.left = left + 'px'; el.style.width = width + 'px';
      el.style.top = (top + 6) + 'px'; el.style.height = (bottom - top - 12) + 'px';
      el.style.background = 'linear-gradient(135deg,#ef4444,#b91c1c)';
      el.dataset.id = t.id;

      const scopeWeeks = +(dayDiff(interval.e, interval.s) / 7).toFixed(1);
      el.title = `⚡ PRIORITARIA: ${t.name}\nDueño: ${t.owner||'—'}\nInicio: ${iso(interval.s)} · ${scopeWeeks} sem\nDominio: ${d.name}`;
      el.innerHTML = `<div class="block-text">`
        + `<div class="bn">⚡ ${esc(t.name)} <span class="badge">PRIORITARIA</span></div>`
        + `<div class="bo">${esc(t.owner||'—')} · ${scopeWeeks}s · ${esc(d.name)}</div>`
        + `</div>`;
      attachBlock(el, t, true);
      c.appendChild(el);
    });
  }
}

// =================== DRAG & EDIT en bloques ===================
function attachBlock(el, t, allowDrag){
  let sx, sy, moved, startLeft, startTop, dragging=false;
  el.addEventListener('pointerdown', (e)=>{
    if(e.button!==0) return;
    dragging=true; moved=false; sx=e.clientX; sy=e.clientY;
    startLeft=parseFloat(el.style.left); startTop=parseFloat(el.style.top);
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e)=>{
    if(!dragging) return;
    const dx=e.clientX-sx, dy=e.clientY-sy;
    if(Math.abs(dx)>4||Math.abs(dy)>4) moved=true;
    if(moved){ el.style.left=(startLeft+dx)+'px'; if(!t.is_priority) el.style.top=(startTop+dy)+'px'; }
  });
  el.addEventListener('pointerup', async (e)=>{
    if(!dragging) return; dragging=false;
    if(!moved){ openTask(t); return; }
    
    let patch;
    if (t.is_priority) {
      const shiftDays = Math.round((parseFloat(el.style.left) - startLeft) / ZOOMS[state.zoom].pxDay);
      const newStart = iso(addDays(new Date(t.start_date), shiftDays));
      patch = { start_date: newStart };
    } else {
      const newLeft=parseFloat(el.style.left);
      const newDays=Math.round(newLeft/ZOOMS[state.zoom].pxDay);
      const newStart=iso(addDays(state.viewStart, newDays));
      patch={ start_date:newStart };
      const newTop=parseFloat(el.style.top);
      const {domain}=domLaneFromY(newTop);
      if(domain){ patch.domain_id=domain; patch.lane=0; }
    }
    await api.send('/api/tasks/'+t.id,'PUT',patch);
    await loadAll();
  });
}
function domLaneFromY(y){
  const GAP = 16;
  for(const d of state.domains){
    const top=state.geom.bandTop[d.id], h=state.geom.bandH[d.id];
    if(y>=top && y<top+h + GAP){
      const lane=Math.min(
        Math.max(0, Math.round((y-top-8)/ROW_H)),
        (state.geom.projRows[d.id]||1) + (state.geom.subRows[d.id]||0) - 1
      );
      return {domain:d.id, lane};
    }
  }
  return {domain:null, lane:0};
}

// Arrastre horizontal de una subrutina: define cuándo INICIA (independiente del padre)
function attachSubBlock(el, t, s){
  let sx, moved=false, startLeft, dragging=false;
  el.addEventListener('pointerdown',(e)=>{ if(e.button!==0)return; dragging=true; moved=false; sx=e.clientX; startLeft=parseFloat(el.style.left); el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove',(e)=>{ if(!dragging)return; const dx=e.clientX-sx; if(Math.abs(dx)>4)moved=true; if(moved) el.style.left=(startLeft+dx)+'px'; });
  el.addEventListener('pointerup', async ()=>{
    if(!dragging)return; dragging=false;
    if(!moved){ openTask(t); return; }
    const newDays=Math.round(parseFloat(el.style.left)/ZOOMS[state.zoom].pxDay);
    const newStart=addDays(state.viewStart, newDays);
    const offsetW=(newStart - new Date(t.start_date))/(7*DAY_MS); // desfase en semanas (puede ser negativo)
    await api.send('/api/subtasks/'+s.id,'PUT',{offset_weeks:offsetW});
    await loadAll();
  });
}

// drop desde backlog sobre el canvas
$('#canvas').addEventListener('dragover', e=>e.preventDefault());
$('#canvas').addEventListener('drop', async (e)=>{
  e.preventDefault();
  const id=e.dataTransfer.getData('text/plain'); if(!id) return;
  const rect=$('#canvas').getBoundingClientRect();
  const x=e.clientX-rect.left, y=e.clientY-rect.top;
  const days=Math.round(x/ZOOMS[state.zoom].pxDay);
  const start=iso(addDays(state.viewStart, days));
  const {domain}=domLaneFromY(y);
  const patch={ status:'doing', start_date:start, baseline_start:start, lane:0 };
  const task = state.tasks.find(x => String(x.id) === id);
  if(domain && !(task && task.is_priority)) patch.domain_id=domain;
  else if(task && task.is_priority) patch.domain_id=null;
  await api.send('/api/tasks/'+id,'PUT',patch);
  await loadAll();
});

// =================== MODAL ===================
let editing=null;
function fillDomains(sel, val){
  sel.innerHTML=state.domains.map(d=>`<option value="${d.id}" ${d.id===val?'selected':''}>${esc(d.name)}</option>`).join('');
}
function colorRow(sel){
  const row=$('#colorRow'); row.innerHTML='';
  PALETTE.forEach(c=>{
    const s=document.createElement('div'); s.className='swatch'+(c===sel?' sel':''); s.style.background=c;
    s.onclick=()=>{ $('#colorRow').dataset.color=c; [...row.children].forEach(x=>x.classList.remove('sel')); s.classList.add('sel'); };
    row.appendChild(s);
  });
  row.dataset.color=sel||'';
}
function openNew(priority){
  editing=null;
  $('#modalTitle').textContent= priority?'⚡ Nueva tarea prioritaria':'Nuevo proyecto';
  $('#f_id').value=''; $('#f_priority').value=priority?'true':'false';
  $('#f_name').value=''; $('#f_owner').value=''; $('#f_desc').value='';
  const defaultScope = priority?1:2;
  $('#f_scope').value=defaultScope;
  const start = iso(today());
  $('#f_start').value=start;
  $('#f_end').value=getEndDateStr(start, defaultScope);
  $('#f_status').value=priority?'doing':'backlog';
  fillDomains($('#f_domain'), state.domains[0]?.id);
  $('#f_domain_wrap').style.display= priority?'none':'';
  $('#colorRow').style.display= priority?'none':'flex';
  if(!priority) colorRow(PALETTE[0]); else $('#colorRow').dataset.color=RED;
  $('#subsList').innerHTML=''; $('#btnDelete').hidden=true;
  $('#modal').hidden=false;
}
function openTask(t){
  editing=t;
  $('#modalTitle').textContent= t.is_priority?'⚡ Editar prioritaria':'Editar proyecto';
  $('#f_id').value=t.id; $('#f_priority').value=t.is_priority?'true':'false';
  $('#f_name').value=t.name; $('#f_owner').value=t.owner||''; $('#f_desc').value=t.description||'';
  $('#f_scope').value=t.scope_weeks;
  const start = t.start_date ? iso(t.start_date) : iso(today());
  $('#f_start').value=start;
  $('#f_end').value=getEndDateStr(start, t.scope_weeks);
  $('#f_status').value=t.status;
  fillDomains($('#f_domain'), t.domain_id);
  $('#f_domain_wrap').style.display= t.is_priority?'none':'';
  $('#colorRow').style.display= t.is_priority?'none':'flex';
  if(!t.is_priority) colorRow(t.color); else $('#colorRow').dataset.color=RED;
  $('#subsList').innerHTML=''; (t.subtasks||[]).forEach(s=>addSubRow(s));
  $('#btnDelete').hidden=false;
  $('#modal').hidden=false;
}
function addSubRow(s){
  const parentStart=$('#f_start').value || iso(today());
  const subStart = s ? iso(addDays(new Date(parentStart), Math.round(Number(s.offset_weeks)*7))) : parentStart;
  const row=document.createElement('div'); row.className='sub-row';
  row.innerHTML=`<select class="s_dom">${state.domains.map(d=>`<option value="${d.id}" ${s&&d.id===s.domain_id?'selected':''}>${esc(d.name)}</option>`).join('')}</select>
    <input class="s_name" placeholder="Nombre" value="${s?esc(s.name||''):''}" style="flex:2">
    <input class="s_start" type="date" value="${subStart}" title="inicio de la subrutina" style="width:140px">
    <input class="s_scope" type="number" min="0.5" step="0.5" value="${s?s.scope_weeks:1}" title="semanas" style="width:64px">
    <span class="x">✕</span>`;
  row.querySelector('.x').onclick=()=>row.remove();
  if(s) row.dataset.id=s.id;
  $('#subsList').appendChild(row);
}

$('#taskForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const priority=$('#f_priority').value==='true';
  const body={
    name:$('#f_name').value.trim(), owner:$('#f_owner').value.trim(),
    description:$('#f_desc').value.trim(), domain_id: priority ? null : +$('#f_domain').value,
    status:$('#f_status').value, scope_weeks:+$('#f_scope').value,
    start_date:$('#f_start').value, is_priority:priority,
    color: priority?RED:($('#colorRow').dataset.color||null),
  };
  let taskId;
  if(editing){
    await api.send('/api/tasks/'+editing.id,'PUT',body);
    taskId=editing.id;
    // resync subtareas: borrar y recrear (simple y robusto)
    for(const s of (editing.subtasks||[])) await api.send('/api/subtasks/'+s.id,'DELETE');
  } else {
    if(!body.start_date) body.start_date=iso(today());
    body.baseline_start=body.start_date;
    const r=await api.send('/api/tasks','POST',body);
    taskId=r.task.id;
  }
  // crear subtareas desde el formulario (el desfase se calcula desde la fecha de inicio)
  const parentStart = body.start_date || iso(today());
  for(const row of $('#subsList').querySelectorAll('.sub-row')){
    const subStart = row.querySelector('.s_start').value || parentStart;
    const offsetW = (new Date(subStart) - new Date(parentStart)) / (7*86400000);
    await api.send('/api/tasks/'+taskId+'/subtasks','POST',{
      domain_id:+row.querySelector('.s_dom').value,
      name:row.querySelector('.s_name').value.trim(),
      scope_weeks:+row.querySelector('.s_scope').value,
      offset_weeks:offsetW,
    });
  }
  $('#modal').hidden=true;
  await loadAll();
});
$('#btnDelete').onclick=async()=>{ if(editing && confirm('¿Eliminar esta tarea?')){ await api.send('/api/tasks/'+editing.id,'DELETE'); $('#modal').hidden=true; await loadAll(); } };
$('#btnCancel').onclick=()=>$('#modal').hidden=true;
$('#addSub').onclick=()=>addSubRow(null);
$('#btnNew').onclick=()=>openNew(false);
$('#btnPriority').onclick=()=>openNew(true);

// =================== ZOOM ===================
document.querySelectorAll('.zoom button').forEach(b=>{
  b.onclick=()=>{ document.querySelectorAll('.zoom button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); state.zoom=b.dataset.zoom; renderBoard(); };
});

// =================== FILTROS TABLERO ===================
document.querySelectorAll('#boardFilters button').forEach(b=>{
  b.onclick=()=>{
    const status=b.dataset.status;
    state.boardFilter[status]=!state.boardFilter[status];
    b.classList.toggle('active', state.boardFilter[status]);
    renderBoard();
  };
});

// =================== REPORTERIA ===================
$('#btnReport').onclick=async()=>{
  const r=await api.get('/api/report');
  const body=$('#reportBody');
  const st=r.byStatus;
  const tot=r.total||1;
  body.innerHTML=`
    <div class="rep-cards">
      <div class="rep-card"><div class="v">${r.total}</div><div class="l">Proyectos totales</div></div>
      <div class="rep-card danger"><div class="v">${r.priority}</div><div class="l">Priorizados (⚡)</div></div>
      <div class="rep-card"><div class="v">${r.delayed}</div><div class="l">Con desviación &gt;0</div></div>
      <div class="rep-card"><div class="v">${r.onTime}</div><div class="l">En tiempo</div></div>
      <div class="rep-card"><div class="v">${r.totalDevWeeks}s</div><div class="l">Desviación total (${r.totalDevDays} d)</div></div>
      <div class="rep-card"><div class="v">${r.avgDevDays} d</div><div class="l">Desviación promedio</div></div>
      <div class="rep-card danger"><div class="v">${r.priorityDevWeeks}s</div><div class="l">Desv. por prioridades (${r.priorityDevDays} d)</div></div>
      <div class="rep-card"><div class="v">${tot? Math.round(st.ended/tot*100):0}%</div><div class="l">Completado</div></div>
    </div>
    <h4>Distribución por estado</h4>
    <div class="statusbars">
      <span style="background:#64748b;width:${st.backlog/tot*100}%">${st.backlog} backlog</span>
      <span style="background:#3b82f6;width:${st.doing/tot*100}%">${st.doing} doing</span>
      <span style="background:#22c55e;width:${st.ended/tot*100}%">${st.ended} ended</span>
    </div>
    <h4>Por dominio</h4>
    <table class="rep"><thead><tr><th>Dominio</th><th>Proyectos</th><th>Priorizados</th><th>Desviación</th><th></th></tr></thead>
    <tbody>${r.perDomain.map(d=>`<tr>
      <td>${esc(d.domain)}</td><td>${d.count}</td><td>${d.priority}</td>
      <td>${d.devWeeks}s (${d.devDays} d)</td>
      <td style="width:35%"><div class="bar" style="width:${Math.min(100,Math.abs(d.devDays)*3)}%;background:${d.devDays>0?'#ef4444':'#22c55e'}"></div></td>
    </tr>`).join('')}</tbody></table>`;
  $('#reportModal').hidden=false;
};
$('#closeReport').onclick=()=>$('#reportModal').hidden=true;

// =================== DOMINIOS ===================
async function openDomains(){ await renderDomainList(); $('#domainModal').hidden=false; }
async function renderDomainList(){
  state.domains = await api.get('/api/domains');
  const wrap=$('#domainList'); wrap.innerHTML='';
  state.domains.forEach((d,i)=>{
    const row=document.createElement('div'); row.className='dom-row';
    row.innerHTML=`
      <input type="color" class="d_color" value="${d.color}">
      <input class="d_name" value="${esc(d.name)}">
      <button class="btn btn-sm btn-ghost d_up" ${i===0?'disabled':''}>↑</button>
      <button class="btn btn-sm btn-ghost d_down" ${i===state.domains.length-1?'disabled':''}>↓</button>
      <button class="btn btn-sm d_del" style="color:#ef4444">✕</button>`;
    row.querySelector('.d_name').onchange=e=>saveDomain(d.id,{name:e.target.value.trim()||'Sin nombre'});
    row.querySelector('.d_color').onchange=e=>saveDomain(d.id,{color:e.target.value});
    row.querySelector('.d_up').onclick=()=>moveDomain(i,-1);
    row.querySelector('.d_down').onclick=()=>moveDomain(i,1);
    row.querySelector('.d_del').onclick=()=>delDomain(d);
    wrap.appendChild(row);
  });
}
async function reloadDomains(){ await loadAll(); await renderDomainList(); }
async function saveDomain(id,patch){ await api.send('/api/domains/'+id,'PUT',patch); await reloadDomains(); }
async function moveDomain(i,dir){
  const arr=[...state.domains]; const j=i+dir; if(j<0||j>=arr.length) return;
  [arr[i],arr[j]]=[arr[j],arr[i]];
  for(let k=0;k<arr.length;k++) await api.send('/api/domains/'+arr[k].id,'PUT',{position:k});
  await reloadDomains();
}
async function delDomain(d){
  if(!confirm(`¿Eliminar el dominio "${d.name}"? Sus tareas volverán al backlog.`)) return;
  await api.send('/api/domains/'+d.id,'DELETE'); await reloadDomains();
}
$('#btnLegend').onclick=()=>{ const l=$('#legend'); l.hidden=!l.hidden; };
$('#btnDomains').onclick=openDomains;
$('#addDomain').onclick=async()=>{
  const maxPos=state.domains.reduce((m,d)=>Math.max(m,d.position),-1);
  const color=PALETTE[state.domains.length % PALETTE.length];
  await api.send('/api/domains','POST',{name:'Nuevo dominio', color, position:maxPos+1});
  await reloadDomains();
};
$('#closeDomains').onclick=()=>$('#domainModal').hidden=true;

// =================== EXPORT ===================
// =================== EXPORT ===================
$('#btnExport').onclick=async()=>{
  const data={ exported:new Date().toISOString(), domains:state.domains, tasks:state.tasks };
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='projectyzer-'+iso(today())+'.json'; a.click();
};

// =================== DEVOPS CSV SYNC ===================
let parsedDevOpsTasks = [];

$('#btnImportDevOps').onclick = () => $('#csvFileInput').click();

$('#csvFileInput').onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const text = evt.target.result;
      const rows = parseCSV(text);
      if (rows.length < 2) {
        alert('El archivo CSV está vacío o no contiene suficientes filas.');
        return;
      }

      const headers = rows[0].map(h => h.trim().toLowerCase());
      
      // Encontrar índices de columnas
      const idIdx = headers.findIndex(h => h === 'id');
      const typeIdx = headers.findIndex(h => h === 'work item type' || h === 'tipo de elemento de trabajo');
      const assignedIdx = headers.findIndex(h => h === 'assigned to' || h === 'asignado a');
      const areaIdx = headers.findIndex(h => h === 'area path' || h === 'ruta de acceso de área' || h === 'area');
      const descIdx = headers.findIndex(h => h === 'description' || h === 'descripción');
      const stateIdx = headers.findIndex(h => h === 'state' || h === 'estado' || h === 'status');
      const effortIdx = headers.findIndex(h => h === 'effort' || h === 'esfuerzo');

      // Buscar todos los índices de columnas de título (Title, Título, Title 1, etc.)
      const titleIndices = [];
      headers.forEach((h, idx) => {
        if (h.startsWith('title') || h.startsWith('título')) {
          titleIndices.push(idx);
        }
      });

      if (idIdx === -1 || titleIndices.length === 0) {
        alert('El archivo CSV debe contener al menos las columnas "ID" y "Título" / "Title".');
        return;
      }

      parsedDevOpsTasks = [];
      const previewBody = $('#importPreviewBody');
      previewBody.innerHTML = '';

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length < 2 || !row[idIdx]) continue;

        const devopsId = parseInt(row[idIdx].trim(), 10);
        if (isNaN(devopsId)) continue;

        const type = typeIdx !== -1 ? row[typeIdx].trim() : 'Feature';
        
        // Filtrar por Epic, Feature o Risk
        const typeLower = type.toLowerCase();
        if (!['epic', 'feature', 'risk'].includes(typeLower)) {
          continue;
        }

        // Buscar el primer título no vacío en las columnas de título
        let title = '';
        for (const idx of titleIndices) {
          if (row[idx] && row[idx].trim()) {
            title = row[idx].trim();
            break;
          }
        }
        if (!title) continue;

        const rawAssigned = assignedIdx !== -1 ? row[assignedIdx].trim() : '';
        const areaPath = areaIdx !== -1 ? row[areaIdx].trim().toLowerCase() : '';
        const desc = descIdx !== -1 ? row[descIdx].trim().slice(0, 140) : '';

        // Reglas de asignación automática
        let mappedOwner = '';
        let mappedDomName = 'Sin dominio';

        const titleLower = title.toLowerCase();
        const searchText = titleLower + ' ' + areaPath;

        // Intentar emparejar dinámicamente con los dominios del sistema
        const matchedDomain = state.domains.find(d => 
          searchText.includes(d.name.toLowerCase())
        );

        if (matchedDomain) {
          mappedDomName = matchedDomain.name;
        } else if (searchText.includes('firewall')) {
          mappedDomName = 'Comunicaciones';
        }

        // Asignación de dueño
        if (mappedDomName.toLowerCase() === 'nube') {
          mappedOwner = 'Antonio Garrido';
        } else if (mappedDomName.toLowerCase() === 'seguridad') {
          mappedOwner = 'Carlos Lopez';
        } else if (mappedDomName.toLowerCase() === 'comunicaciones') {
          mappedOwner = 'David Pardo';
        } else if (mappedDomName.toLowerCase() === 'tierra') {
          mappedOwner = 'Oliver Araújo';
        } else {
          // Asignación por defecto basada en CSV quitando correo si existe
          mappedOwner = rawAssigned ? rawAssigned.split('<')[0].trim() : '';
        }

        const domain = state.domains.find(d => d.name.toLowerCase() === mappedDomName.toLowerCase());
        const domainId = domain ? domain.id : null;

        const exists = state.tasks.some(t => t.devops_id === devopsId);
        const actionLabel = exists ? 'Actualizar' : 'Crear';

        // Mapeo del estado/status
        const rawState = stateIdx !== -1 ? row[stateIdx].trim().toLowerCase() : '';
        let mappedStatus = 'backlog';
        if (['completed', 'resolved', 'closed', 'ended'].includes(rawState)) {
          mappedStatus = 'ended';
        } else if (['in progress', 'doing', 'validate'].includes(rawState)) {
          mappedStatus = 'doing';
        }

        // Mapeo del esfuerzo / alcance en semanas
        const rawEffort = effortIdx !== -1 && row[effortIdx] ? parseFloat(row[effortIdx].trim()) : NaN;
        const scopeWeeks = !isNaN(rawEffort) && rawEffort > 0 ? rawEffort : 2;

        const currentIndex = parsedDevOpsTasks.length;
        parsedDevOpsTasks.push({
          devops_id: devopsId,
          name: title,
          owner: mappedOwner,
          description: desc,
          domain_id: domainId,
          status: mappedStatus,
          scope_weeks: scopeWeeks,
        });

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td style="padding: 8px;">${devopsId}</td>
          <td style="padding: 8px; font-weight: 600;">${esc(title)}</td>
          <td style="padding: 8px;"><span class="st" style="background:#475569; color:#fff">${esc(type)}</span></td>
          <td style="padding: 8px;"><input type="text" class="import-owner" value="${esc(mappedOwner)}" data-index="${currentIndex}" style="width: 100%; box-sizing: border-box; padding: 4px;"></td>
          <td style="padding: 8px;">
            <select class="import-domain" data-index="${currentIndex}" style="width: 100%; box-sizing: border-box; padding: 4px;">
              ${state.domains.map(d => `<option value="${d.id}" ${d.id === domainId ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
              <option value="" ${domainId === null ? 'selected' : ''}>Sin dominio</option>
            </select>
          </td>
          <td style="padding: 8px;">
            <select class="import-status" data-index="${currentIndex}" style="width: 100%; box-sizing: border-box; padding: 4px;">
              <option value="backlog" ${mappedStatus === 'backlog' ? 'selected' : ''}>Backlog</option>
              <option value="doing" ${mappedStatus === 'doing' ? 'selected' : ''}>Doing</option>
              <option value="ended" ${mappedStatus === 'ended' ? 'selected' : ''}>Ended</option>
            </select>
          </td>
          <td style="padding: 8px;"><input type="number" min="0.5" step="0.5" class="import-scope" value="${scopeWeeks}" data-index="${currentIndex}" style="width: 60px; box-sizing: border-box; padding: 4px;"></td>
          <td style="padding: 8px;"><span class="st" style="background:${exists ? '#f59e0b' : '#22c55e'}; color:#fff">${actionLabel}</span></td>
        `;
        previewBody.appendChild(tr);
      }

      if (parsedDevOpsTasks.length === 0) {
        alert('No se encontraron tareas con tipo Epic, Feature o Risk en el CSV.');
        return;
      }

      $('#importModal').hidden = false;
    } catch (err) {
      alert('Error al procesar el archivo CSV: ' + err.message);
    }
  };
  reader.readAsText(file);
};

// Escuchar cambios en la tabla de previsualización para actualizar dinámicamente el payload
$('#importPreviewBody').addEventListener('change', (evt) => {
  const target = evt.target;
  const idx = parseInt(target.dataset.index, 10);
  if (isNaN(idx)) return;
  const item = parsedDevOpsTasks[idx];
  if (!item) return;

  if (target.classList.contains('import-owner')) {
    item.owner = target.value.trim();
  } else if (target.classList.contains('import-domain')) {
    item.domain_id = target.value ? parseInt(target.value, 10) : null;
  } else if (target.classList.contains('import-status')) {
    item.status = target.value;
  } else if (target.classList.contains('import-scope')) {
    item.scope_weeks = parseFloat(target.value) || 2;
  }
});

$('#cancelImport').onclick = () => {
  $('#importModal').hidden = true;
  $('#csvFileInput').value = '';
};

$('#confirmImport').onclick = async () => {
  const btn = $('#confirmImport');
  btn.textContent = '🔄 Procesando...';
  btn.disabled = true;

  try {
    const res = await api.send('/api/tasks/sync-csv', 'POST', parsedDevOpsTasks);
    alert(res.message || 'Sincronización finalizada.');
    $('#importModal').hidden = true;
    await loadAll();
  } catch (err) {
    alert('Error al guardar la sincronización: ' + err.message);
  } finally {
    btn.textContent = 'Confirmar Sincronización';
    btn.disabled = false;
    $('#csvFileInput').value = '';
  }
};

function parseCSV(text) {
  const lines = [];
  let row = [""];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i+1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        row[row.length - 1] += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' || char === ';') {
      if (inQuotes) {
        row[row.length - 1] += char;
      } else {
        row.push("");
      }
    } else if (char === '\r' || char === '\n') {
      if (inQuotes) {
        row[row.length - 1] += char;
      } else {
        if (char === '\r' && next === '\n') {
          i++;
        }
        lines.push(row);
        row = [""];
      }
    } else {
      row[row.length - 1] += char;
    }
  }
  if (row.length > 1 || row[0] !== "") {
    lines.push(row);
  }
  return lines;
}

function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function adjustBlockTexts(){
  const board = $('#board');
  if (!board) return;
  const scrollLeft = board.scrollLeft;
  const visibleStart = scrollLeft + 160; // 160px is the rail width
  
  document.querySelectorAll('.block .block-text').forEach(bt => {
    const el = bt.parentElement;
    if (!el) return;
    const blockLeft = parseFloat(el.style.left) || 0;
    const blockWidth = parseFloat(el.style.width) || 0;
    
    if (blockLeft < visibleStart && blockLeft + blockWidth > visibleStart) {
      const offset = visibleStart - blockLeft;
      // Leave at least 60px of space on the right for padding and tags
      const maxOffset = Math.max(0, blockWidth - 60);
      bt.style.transform = `translateX(${Math.min(offset, maxOffset)}px)`;
    } else {
      bt.style.transform = '';
    }
  });
}

$('#board').addEventListener('scroll', adjustBlockTexts);

function updateEndFromStartAndScope() {
  const start = $('#f_start').value;
  const scope = parseFloat($('#f_scope').value) || 0.5;
  if (start) {
    $('#f_end').value = getEndDateStr(start, scope);
  }
}

function updateScopeFromStartAndEnd() {
  const start = $('#f_start').value;
  const end = $('#f_end').value;
  if (start && end) {
    const diffDays = dayDiff(end, start);
    const scope = Math.max(0.5, +(diffDays / 7).toFixed(1));
    $('#f_scope').value = scope;
  }
}

$('#f_start').addEventListener('change', updateEndFromStartAndScope);
$('#f_scope').addEventListener('input', updateEndFromStartAndScope);
$('#f_scope').addEventListener('change', updateEndFromStartAndScope);
$('#f_end').addEventListener('change', updateScopeFromStartAndEnd);

loadAll();
