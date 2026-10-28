// Imports the SkateSkins lead files into Outreach.
// Usage: npm run import -- "<folder with the lead files>" [--write] [--local]
//   Without --write it is a dry run: it reports what would be added and changes nothing.
//   --local imports into .local/outreach.json (stop `npm start` first) instead of the Supabase project in .env.
// Re-running is safe: rows imported before are skipped, and edits made in the app are never overwritten.
import { readFileSync, readdirSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { applyUpdates, planImport, sourcesFromFiles, summarize } from '../lib/lead-import.mjs';
import { auth, checkImportSchema, claims, insertNew, loadAll, saveChanges, supabaseConfig } from '../lib/supabase.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
try { process.loadEnvFile(join(root, '.env')); } catch {}
const args = process.argv.slice(2), write = args.includes('--write'), local = args.includes('--local') || !supabaseConfig();
const folder = args.find(a => !a.startsWith('--'));
if (!folder) { console.error('Usage: npm run import -- "<folder with the lead files>" [--write] [--local]'); process.exit(1); }

const files = readdirSync(folder).filter(name => /\.(csv|xlsx)$/i.test(name)).map(name => ({ name, data: readFileSync(join(folder, name)) }));
const { sources, used } = sourcesFromFiles(files);
if (!used.length) { console.error(`No lead files found in ${folder}`); process.exit(1); }
console.log(`Reading from ${folder}:\n  ${used.join('\n  ')}\n`);

function ask(question, hidden = false) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = text => { if (text.includes(question)) process.stdout.write(question); };
    rl.question(question, answer => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer.trim()); });
  });
}

let db, session, cfg, dataPath;
if (local) {
  const dir = process.env.OUTREACH_DATA_DIR || join(root, '.local'); dataPath = join(dir, 'outreach.json'); mkdirSync(dir, { recursive: true, mode: 0o700 });
  db = existsSync(dataPath) ? JSON.parse(readFileSync(dataPath, 'utf8')) : { version: 1, orgs: [], contacts: [], activities: [], tasks: [], suggestions: [] };
  console.log(`Target: local file ${dataPath}\n`);
} else {
  cfg = supabaseConfig();
  console.log(`Target: Supabase ${new URL(cfg.url).host}. Sign in with your outreach admin account.`);
  const email = process.env.OUTREACH_EMAIL || await ask('Email: '), password = process.env.OUTREACH_PASSWORD || await ask('Password: ', true);
  session = await auth.signIn(cfg, email, password).catch(e => { console.error(`Sign-in failed: ${e.message}`); process.exit(1); });
  if (!(await auth.isAdmin(cfg, session.access_token))) { console.error('This account is not an outreach admin.'); process.exit(1); }
  await checkImportSchema(cfg, session.access_token).catch(e => { console.error(e.message); process.exit(1); });
  db = await loadAll(cfg, session.access_token);
  console.log(`Signed in. The project has ${db.orgs.length} organizations and ${db.contacts.length} contacts.\n`);
}

const plan = planImport(db, sources), { orgs, contacts, updates } = plan;
console.log(summarize(plan).join('\n'));
if (!write) { console.log('Dry run: nothing was written. Re-run with --write to import.'); process.exit(0); }
if (!orgs.length && !contacts.length && !updates.length) { console.log('Nothing new to import.'); process.exit(0); }

if (local) {
  db.orgs.push(...orgs); db.contacts.push(...contacts); applyUpdates(db, updates);
  const tmp = `${dataPath}.tmp`; writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 }); renameSync(tmp, dataPath);
} else {
  const userId = claims(session.access_token).sub;
  await insertNew(cfg, session.access_token, 'orgs', orgs, userId, n => process.stdout.write(`\rOrganizations: ${n}/${orgs.length}`)); console.log();
  await insertNew(cfg, session.access_token, 'contacts', contacts, userId, n => process.stdout.write(`\rContacts: ${n}/${contacts.length}`)); console.log();
  if (updates.length) { applyUpdates(db, updates); await saveChanges(cfg, session.access_token, userId, db); console.log(`Filled in: ${updates.length}`); }
}
console.log(`Imported. ${local ? 'Start the app with npm start.' : 'The app picks up the new records within 2 minutes, or restart npm start to see them now.'}`);
