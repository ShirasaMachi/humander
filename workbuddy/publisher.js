import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { safePath } from '../src/workspace.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function publishGithub(root, hash, files, settings, signal) {
  const { owner, repo, branch = 'humander-public', token } = settings ?? {};
  if (![owner, repo, branch].every(x => /^[A-Za-z0-9_.-]{1,100}$/.test(x ?? '')) || !token) {
    throw new Error('Configure a public GitHub repository, branch and Contents-write token before submission');
  }
  const apiRoot = `https://api.github.com/repos/${owner}/${repo}`;
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(`${apiRoot}${path}`, { method, signal,
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`GitHub publication failed (${response.status}): ${String(value.message ?? 'Unknown error').slice(0, 250)}`);
    return value;
  };
  const repoInfo = await request('');
  if (repoInfo.private) throw new Error('Publication repository must be public');
  let head;
  try { head = (await request(`/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha; }
  catch (error) {
    if (!/\(404\)/.test(error.message)) throw error;
    const source = (await request(`/git/ref/heads/${encodeURIComponent(repoInfo.default_branch)}`)).object.sha;
    head = (await request('/git/refs', 'POST', { ref: `refs/heads/${branch}`, sha: source })).object.sha;
  }
  const baseTree = (await request(`/git/commits/${head}`)).tree.sha;
  const all = [...files.map(f => f.path), 'manifest.json'];
  const entries = [];
  for (let i = 0; i < all.length; i += 4) {
    const batch = await Promise.all(all.slice(i, i + 4).map(async path => {
      const content = readFileSync(safePath(root, path)).toString('base64');
      const blob = await request('/git/blobs', 'POST', { content, encoding: 'base64' });
      return { path: `releases/${hash}/${path}`, mode: '100644', type: 'blob', sha: blob.sha };
    }));
    entries.push(...batch);
  }
  const tree = await request('/git/trees', 'POST', { base_tree: baseTree, tree: entries });
  const commit = await request('/git/commits', 'POST', { message: `Publish Humander evidence ${hash}`, tree: tree.sha, parents: [head] });
  await request(`/git/refs/heads/${encodeURIComponent(branch)}`, 'PATCH', { sha: commit.sha, force: false });
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${commit.sha}/releases/${hash}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(`${url}/manifest.json`, { signal }).catch(() => null);
    if (response?.ok) return url;
    await pause(1000 * (attempt + 1));
  }
  throw new Error('GitHub commit succeeded, but public release is not yet readable; retry submission after propagation');
}

export function loadPublicationSettings(stateDir) {
  const file = join(stateDir, 'publication.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}
