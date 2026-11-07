import { execFileSync } from 'node:child_process';
import { readdir, readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Explicit external destination; never cleans, overwrites, or follows directory links.
const destination = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw Error('Usage: node tools/backup-sound-workspace.mjs EXTERNAL_NEW_DIRECTORY');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const roots = git('worktree', 'list', '--porcelain').split('\n').filter(x => x.startsWith('worktree ')).map(x => x.slice(9).trim());
for (const root of roots) {
  const rel = path.relative(path.resolve(root), destination);
  if (!rel || (!rel.startsWith('..') && !path.isAbsolute(rel))) throw Error('Backup must be outside every worktree');
}
await mkdir(destination); // Refuse an existing destination.
await mkdir(path.join(destination, 'objects'));
const manifest = { schema: 'momo.workspace-backup/v1', head: git('rev-parse', 'HEAD').trim(), refs: git('show-ref'),
  createdAt: new Date().toISOString(), excludedRegenerable: ['node_modules'], worktrees: [] };
const objects = new Set();
for (const root of roots) {
  const entry = { root, head: git('-C', root, 'rev-parse', 'HEAD').trim(), status: git('-C', root, 'status', '--porcelain'), files: [], links: [] };
  async function visit(relative = '') {
    for (const item of await readdir(path.join(root, relative), { withFileTypes: true })) {
      if (!relative && ['.git', 'node_modules'].includes(item.name)) continue;
      const name = path.posix.join(relative, item.name), file = path.join(root, name);
      if (item.isSymbolicLink()) { entry.links.push(name); continue; }
      if (item.isDirectory()) { await visit(name); continue; }
      if (!item.isFile()) continue;
      const bytes = await readFile(file), sha256 = createHash('sha256').update(bytes).digest('hex');
      if (!objects.has(sha256)) {
        const target = path.join(destination, 'objects', sha256);
        await copyFile(file, target);
        const actual = createHash('sha256').update(await readFile(target)).digest('hex');
        if (actual !== sha256) throw Error(`File changed during backup: ${file}`);
        objects.add(sha256);
      }
      entry.files.push({ path: name, bytes: bytes.length, sha256 });
    }
  }
  await visit(); manifest.worktrees.push(entry);
  await writeFile(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`Backed up ${root}: ${entry.files.length} files (including untracked/ignored content)`);
}
execFileSync('git', ['bundle', 'create', path.join(destination, 'history.bundle'), '--all'], { stdio: 'inherit' });
execFileSync('git', ['bundle', 'verify', path.join(destination, 'history.bundle')], { stdio: 'inherit' });
await writeFile(path.join(destination, 'RESTORE.txt'), 'Clone history.bundle into a NEW directory for Git history. To restore a worktree snapshot, select its manifest.worktrees entry; copy each objects/<sha256> to its recorded relative path in a NEW directory, verifying SHA-256 and size. Do not overwrite existing work. Reinstall node_modules from package-lock.json. Links were inventoried but not followed. manifest.json includes ignored and untracked files.\n');
console.log(`Verified backup complete: ${destination}; ${objects.size} unique objects`);
