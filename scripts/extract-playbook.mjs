// Regenerates lib/playbook.json from the reference tabs of the Outreach Plan workbook.
// Usage: node scripts/extract-playbook.mjs "<path to SkateSkins Outreach Plan & Rink List.xlsx>"
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { readXlsx } from '../lib/xlsx.mjs';
import { stageFrom } from '../lib/outreach.mjs';

const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/extract-playbook.mjs "<Outreach Plan .xlsx>"'); process.exit(1); }
const sheets = readXlsx(readFileSync(file));
const lines = name => { const rows = sheets.get(name); if (!rows) throw new Error(`Sheet "${name}" not found`); return rows.map(r => r.filter(Boolean)).filter(r => r.length); };
// Rows after the heading row `from`, up to the heading row `to`. A heading matches whole words: 'Script' is not 'Scripts'.
function between(rows, from, to) {
  const heading = text => r => r[0] === text || r[0].startsWith(`${text} `);
  const start = rows.findIndex(heading(from)); if (start < 0) throw new Error(`Heading "${from}" not found`);
  const end = to ? rows.findIndex((r, i) => i > start && heading(to)(r)) : -1;
  return rows.slice(start + 1, end < 0 ? undefined : end);
}

const start = lines('Start Here');
const playbook = {
  source: basename(file),
  built: start[1][0],
  plan: between(start, 'The plan of attack', 'Tiers')[0][0],
  tiers: between(start, 'Tiers', 'How to use').map(([t]) => ({ tier: t.slice(0, 1), text: t.slice(3) })),
  dataNotes: between(start, 'Data notes').map(([t]) => t),
  zones: lines('Target Areas').filter(r => /^\d · /.test(r[0])).map(([zone, approach, when]) => ({ zone, approach, when })),
  places: between(lines('Contact Playbook'), 'Place', 'Finding a contact').map(([place, whoDecides, howToFind, bestWayIn, offer, followUp]) => ({ place, whoDecides, howToFind, bestWayIn, offer, followUp })),
  findingContact: between(lines('Contact Playbook'), 'Finding a contact').map(([t]) => t),
  scriptsNote: lines('Scripts')[1][0],
  scripts: between(lines('Scripts'), 'Script').map(([name, when, text]) => ({ name, when, text })),
  dealSteps: between(lines('Deal Steps'), 'Status', 'What goes into a deal').map(([label, meaning, doneWhen]) => ({ stage: stageFrom(label), label, meaning, doneWhen })),
  dealIncludes: between(lines('Deal Steps'), 'What goes into a deal', 'Weekly targets').map(([t]) => t),
  weeklyTargets: between(lines('Deal Steps'), 'Weekly targets')[0][0].split('•').map(t => t.trim()).filter(Boolean)
};
writeFileSync(new URL('../lib/playbook.json', import.meta.url), `${JSON.stringify(playbook, null, 2)}\n`);
console.log(`Wrote lib/playbook.json: ${playbook.zones.length} zones, ${playbook.places.length} places, ${playbook.scripts.length} scripts, ${playbook.dealSteps.length} deal steps`);
