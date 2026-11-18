// Merges every messages-staging/<name>.<locale>.json into messages/<locale>.json.
// Parallel work writes its new translations to staging files so nobody edits the same JSON at once.
// Safe to run again: a key that already has the same value is left alone. A key that exists with a
// different value is a conflict: nothing is written, the conflicts are listed and the script exits 1.
// getBuiltinModule (Node 22+) instead of require: the lint rules forbid require() everywhere.
const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const ROOT = path.resolve(__dirname, '..');
const STAGING_DIR = path.join(ROOT, 'messages-staging');
const MESSAGES_DIR = path.join(ROOT, 'messages');
const STAGING_FILE = /^.+\.([a-z]{2})\.json$/;
const JSON_INDENT = 2;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Copies `incoming` into `target`; returns the dotted key paths that clash with an existing value.
function mergeInto(target, incoming, prefix, source) {
  const conflicts = [];
  for (const [key, value] of Object.entries(incoming)) {
    const keyPath = prefix ? `${prefix}.${key}` : key;
    if (!(key in target)) {
      target[key] = structuredClone(value);
      continue;
    }
    const existing = target[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      conflicts.push(...mergeInto(existing, value, keyPath, source));
      continue;
    }
    if (JSON.stringify(existing) !== JSON.stringify(value)) {
      conflicts.push(`${keyPath} (${source}): has ${JSON.stringify(existing)}, staging has ${JSON.stringify(value)}`);
    }
  }
  return conflicts;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function main() {
  if (!fs.existsSync(STAGING_DIR)) {
    process.stdout.write('No messages-staging folder, nothing to merge.\n');
    return 0;
  }
  const stagingFiles = fs.readdirSync(STAGING_DIR).filter((name) => STAGING_FILE.test(name)).sort();
  const merged = new Map();
  const conflicts = [];

  for (const name of stagingFiles) {
    const locale = name.match(STAGING_FILE)[1];
    const targetPath = path.join(MESSAGES_DIR, `${locale}.json`);
    if (!fs.existsSync(targetPath)) {
      conflicts.push(`${name}: messages/${locale}.json does not exist`);
      continue;
    }
    if (!merged.has(targetPath)) merged.set(targetPath, readJson(targetPath));
    const incoming = readJson(path.join(STAGING_DIR, name));
    if (!isPlainObject(incoming)) {
      conflicts.push(`${name}: the top level must be an object of namespaces`);
      continue;
    }
    conflicts.push(...mergeInto(merged.get(targetPath), incoming, '', name));
  }

  if (conflicts.length > 0) {
    console.error(`Not merged: ${conflicts.length} conflict(s). Fix the staging file or the message, then run again.`);
    for (const conflict of conflicts) console.error(`  ${conflict}`);
    return 1;
  }

  for (const [targetPath, messages] of merged) {
    const text = `${JSON.stringify(messages, null, JSON_INDENT)}\n`;
    if (fs.readFileSync(targetPath, 'utf8') === text) continue;
    fs.writeFileSync(targetPath, text);
    process.stdout.write(`Updated ${path.relative(ROOT, targetPath)}\n`);
  }
  process.stdout.write(`Merged ${stagingFiles.length} staging file(s).\n`);
  return 0;
}

process.exitCode = main();
