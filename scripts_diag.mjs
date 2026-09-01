import { createClient } from '@supabase/supabase-js';
import { getDocumentProxy } from 'unpdf';

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const file_path = 'dcab3308-fb1e-4b6e-b55b-7e5534480fb9/cb157722-94e0-490c-b612-181151d664ce.pdf';
const { data: file, error } = await supa.storage.from('planning-pdfs').download(file_path);
if (error) { console.error(error); process.exit(1); }
const buffer = new Uint8Array(await file.arrayBuffer());
const pdf = await getDocumentProxy(buffer);

const DAY_NAMES = ["lundi","mardi","mercredi","jeudi","vendredi","samedi","dimanche"];
const ACTIVITY_KEYWORDS = /\b(fab|r[ée]gie|mixage|jt|midi|soir|matin|rtt|employeur|r[ée]union|maintenance|habillage|ops|cong[ée]s|service|prise|antenne|d[ée]cor|plateau|montage|trafic|news|info|sport|m[ée]t[ée]o|reportage|tournage|direct|studio|loge|salle)\b/i;
const TIME_RANGE_RE = /\d{1,2}\s*[h:]\s*\d{2}\s*[-–]\s*\d{1,2}\s*[h:]\s*\d{2}/i;
const SECTION_HEADER_RE = /^\d+\.\s*[A-ZÀ-ÝŒ]/;
const SURNAME_ONLY_RE = /^[A-ZÀ-ÝŒ][A-ZÀ-ÝŒ'\- ]*$/;
const FIRSTNAME_FJ_RE = /^([A-ZÀ-ÝŒ][a-zà-ÿœ'\-]+(?:\s+[a-zà-ÿœ'\-]+){0,2})\s+FJ\b/;

function normalize(s){return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9\s\/.\-]/g," ").replace(/\s+/g," ").trim();}

for (let p=1; p<=pdf.numPages; p++) {
  const page = await pdf.getPage(p);
  const content = await page.getTextContent();
  const items = [];
  for (const it of content.items) {
    if (!it.str || !it.str.trim()) continue;
    items.push({str: it.str.trim(), x: it.transform[4], y: it.transform[5]});
  }
  const cands = [];
  for (const it of items) {
    const n = normalize(it.str);
    for (let di=0; di<7; di++) {
      if (!n.startsWith(DAY_NAMES[di])) continue;
      cands.push({x: it.x, y: it.y, dayIndex: di});
      break;
    }
  }
  if (cands.length<3) continue;
  const groups=[];
  for (const c of cands){const g=groups.find(g=>Math.abs(g.y-c.y)<=3); if(g)g.items.push(c); else groups.push({y:c.y,items:[c]});}
  groups.sort((a,b)=>b.items.length-a.items.length);
  const best = groups[0].items;
  const seen=new Set();
  const sorted = best.filter(c=>seen.has(c.dayIndex)?false:(seen.add(c.dayIndex),true)).sort((a,b)=>a.x-b.x);
  const headerY = Math.max(...sorted.map(c=>c.y));
  const firstColX = Math.min(...sorted.map(c=>c.x));

  const left = items.filter(it=>it.x < firstColX-2 && it.y < headerY-1);
  const rows=[];
  for (const it of left){const r=rows.find(r=>Math.abs(r.y-it.y)<=2); if(r)r.items.push(it); else rows.push({y:it.y,items:[it]});}
  rows.sort((a,b)=>b.y-a.y);

  const targetIdx = rows.findIndex(r => Math.abs(r.y - 505.27) < 1);
  if (targetIdx < 0) continue;

  // Replay Path C merge
  const cur = rows[targetIdx];
  const next = rows[targetIdx+1];
  const curSorted = cur.items.slice().sort((a,b)=>a.x-b.x);
  const nextSorted = next.items.slice().sort((a,b)=>a.x-b.x);
  const curText = curSorted.map(x=>x.str).join(' ').trim();
  const nextText = nextSorted.map(x=>x.str).join(' ').trim();
  const dy = cur.y - next.y;
  const firstTok = curText.split(' ')[0];
  const ok = curText.length<=30 && SURNAME_ONLY_RE.test(firstTok) && !SECTION_HEADER_RE.test(curText)
    && (!ACTIVITY_KEYWORDS.test(curText) || FIRSTNAME_FJ_RE.test(curText))
    && nextText.match(FIRSTNAME_FJ_RE) && dy>0 && dy<=14;

  const mergedY = ok ? cur.y : cur.y;
  const mergedItems = ok ? [...cur.items, ...next.items] : cur.items;
  const mergedText = mergedItems.slice().sort((a,b)=>a.x-b.x).map(x=>x.str).join(' ').trim();

  console.log(`\n=== PAGE ${p} VAIVAIKAVA diagnostic ===`);
  console.log(`(1) Fusion Path C? ${ok ? 'OUI' : 'NON'}`);
  console.log(`    merged row.y = ${mergedY.toFixed(2)}  (cur.y=${cur.y.toFixed(2)}, next.y=${next.y.toFixed(2)})`);
  console.log(`    merged text  = "${mergedText}"`);

  // (2) Build full merged rows list with same Path C logic to know yTop in bands sort
  // Simpler: yTop of VAIVAIKAVA band = mergedY (since accepted.push uses r.y).
  console.log(`\n(2) EmployeeBand "VAIVAIKAVA" yTop = ${mergedY.toFixed(2)} (= r.y from accepted.push)`);

  // We also need yBottom = the next employee band's y below.
  // Quick proxy: look at rows below mergedY for any "GOLD" or "FJ" employee row.
  // For Wednesday column we need yBottom too for the cellText filter check.
  // Let's find next FJ/employee y below.
  let yBottom = -Infinity;
  for (let k=targetIdx+2; k<rows.length; k++) {
    const t = rows[k].items.slice().sort((a,b)=>a.x-b.x).map(x=>x.str).join(' ').trim();
    if (/\bFJ\b/.test(t) || /\d{1,2}\s*h\s*\d{2}/.test(t)) {
      // Need to also check it's actually an employee row (not just times)
      if (/^[A-ZÀ-ÝŒ]/.test(t) && !SECTION_HEADER_RE.test(t)) {
        yBottom = rows[k].y;
        console.log(`    next employee row below: y=${yBottom.toFixed(2)} text="${t.slice(0,60)}"`);
        break;
      }
    }
  }

  // (3) Items in Wednesday column with y ∈ [yTop-30, yTop+2]
  const yTop = mergedY;
  const colXmin = 279.08, colXmax = 351.00;
  console.log(`\n(3) Items in Mercredi col x ∈ [${colXmin}, ${colXmax}), y ∈ [${(yTop-30).toFixed(2)}, ${(yTop+2).toFixed(2)}]:`);
  const colItems = items
    .filter(it => it.x >= colXmin-3 && it.x < colXmax-3 && it.y >= yTop-30 && it.y <= yTop+2)
    .sort((a,b)=>b.y-a.y);
  for (const it of colItems) {
    let kept = 'gardé';
    let reason = '';
    if (!(it.y < yTop - 0.5)) { kept='rejeté'; reason=`y >= yTop-0.5 (${(yTop-0.5).toFixed(2)})`; }
    else if (!(it.y > yBottom - 0.5)) { kept='rejeté'; reason=`y <= yBottom-0.5 (${(yBottom-0.5).toFixed(2)})`; }
    else if (!(it.x >= colXmin - 3)) { kept='rejeté'; reason='x < col.x-3'; }
    else if (!(it.x < colXmax - 3)) { kept='rejeté'; reason='x >= col.xEnd-3'; }
    console.log(`  str="${it.str}"  x=${it.x.toFixed(2)}  y=${it.y.toFixed(2)}  → ${kept}${reason?' ('+reason+')':''}`);
  }
}
