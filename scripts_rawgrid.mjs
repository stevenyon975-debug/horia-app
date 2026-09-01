import { createClient } from '@supabase/supabase-js';
import { getDocumentProxy } from 'unpdf';
import { buildRawGridFromPdf } from './src/lib/shifts.functions.ts';

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const file_path = 'dcab3308-fb1e-4b6e-b55b-7e5534480fb9/cb157722-94e0-490c-b612-181151d664ce.pdf';
const { data: file, error } = await supa.storage.from('planning-pdfs').download(file_path);
if (error) { console.error(error); process.exit(1); }
const buffer = new Uint8Array(await file.arrayBuffer());
const pdf = await getDocumentProxy(buffer);

const allPages = [];
let allText = '';
for (let p = 1; p <= pdf.numPages; p++) {
  const page = await pdf.getPage(p);
  const content = await page.getTextContent();
  const items = [];
  for (const it of content.items) {
    if (!it.str || !it.str.trim()) continue;
    items.push({ str: it.str.trim(), x: it.transform[4], y: it.transform[5] });
    allText += ' ' + it.str;
  }
  allPages.push(items);
}

function parseWeekStart(s) {
  const m = s.match(/du\s+(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\s+au/i);
  if (!m) return null;
  let y = parseInt(m[3], 10); if (y < 100) y += 2000;
  return new Date(Date.UTC(y, parseInt(m[2], 10) - 1, parseInt(m[1], 10)));
}
const weekStart = parseWeekStart(allText);
console.log('weekStart:', weekStart?.toISOString().slice(0,10));

// Build raw grid for each page, then merge by employee
const allCells = [];
for (let i = 0; i < allPages.length; i++) {
  const cells = buildRawGridFromPdf(allPages[i], weekStart);
  console.log(`Page ${i+1}: ${cells.length} cells, ${new Set(cells.map(c=>c.employee)).size} employees`);
  for (const c of cells) allCells.push({ ...c, page: i+1 });
}

// Group by employee (preserve order of first appearance)
const byEmp = new Map();
for (const c of allCells) {
  if (!byEmp.has(c.employee)) byEmp.set(c.employee, {});
  byEmp.get(c.employee)[c.day_index] = c.raw_text;
}

const DAYS = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
console.log('\n=== TABLEAU EMPLOYÉ × JOUR ===\n');
console.log(`Total employés: ${byEmp.size}\n`);

let idx = 0;
for (const [emp, days] of byEmp) {
  idx++;
  console.log(`\n[${idx}] ${emp}`);
  for (let d = 0; d < 7; d++) {
    const txt = (days[d] ?? '').replace(/\s+/g, ' ').trim();
    const display = txt.length > 80 ? txt.slice(0,77) + '...' : txt;
    console.log(`    ${DAYS[d]}: ${display || '(vide)'}`);
  }
}
