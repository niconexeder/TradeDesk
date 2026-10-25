import { mkdir, writeFile, access } from 'node:fs/promises';
const repo = 'https://api.github.com/repos/nextlevelbuilder/ui-ux-pro-max-skill';
const refResponse = await fetch(`${repo}/commits/main`);
if (!refResponse.ok) throw new Error('Cannot resolve skill revision');
const { sha } = await refResponse.json();
const response = await fetch(`${repo}/git/trees/${sha}?recursive=1`);
if (!response.ok) throw new Error('Cannot list skill files');
const tree = await response.json();
const prefix = '.claude/skills/ui-ux-pro-max/';
for (const item of tree.tree.filter(x => x.type === 'blob' && (x.path.startsWith(prefix) || x.path === 'LICENSE'))) {
  const target = item.path === 'LICENSE' ? `${prefix}LICENSE` : item.path;
  try { await access(target); continue; } catch {}
  const file = await fetch(`https://raw.githubusercontent.com/nextlevelbuilder/ui-ux-pro-max-skill/${sha}/${item.path}`);
  if (!file.ok) throw new Error(`Download failed: ${item.path}`);
  await mkdir(target.slice(0, target.lastIndexOf('/')), { recursive: true });
  await writeFile(target, Buffer.from(await file.arrayBuffer()));
}
console.log(`Skill installed locally from revision ${sha}; existing files preserved.`);
