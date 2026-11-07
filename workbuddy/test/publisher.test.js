import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishGithub } from '../publisher.js';

test('GitHub publication creates an immutable public release from local evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'humander-publish-'));
  const original = globalThis.fetch;
  try {
    mkdirSync(join(root, 'code'));
    writeFileSync(join(root, 'code', 'main.py'), 'print(42)\n');
    writeFileSync(join(root, 'manifest.json'), '{}');
    const requests = [];
    globalThis.fetch = async (url, options = {}) => {
      const u = new URL(url), body = options.body && JSON.parse(options.body);
      requests.push({ path: u.pathname, method: options.method, body });
      let value = {};
      if (u.hostname === 'raw.githubusercontent.com') return new Response('{}', { status: 200 });
      if (u.pathname.endsWith('/repos/alice/public')) value = { private: false, default_branch: 'main' };
      else if (u.pathname.endsWith('/git/ref/heads/humander-public')) value = { object: { sha: 'oldcommit' } };
      else if (u.pathname.endsWith('/git/commits/oldcommit')) value = { tree: { sha: 'oldtree' } };
      else if (u.pathname.endsWith('/git/blobs')) value = { sha: `blob${requests.length}` };
      else if (u.pathname.endsWith('/git/trees')) value = { sha: 'newtree' };
      else if (u.pathname.endsWith('/git/commits')) value = { sha: 'newcommit' };
      else if (u.pathname.endsWith('/git/refs/heads/humander-public')) value = { object: { sha: 'newcommit' } };
      return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const url = await publishGithub(root, 'a'.repeat(64), [{ path: 'code/main.py' }],
      { owner: 'alice', repo: 'public', branch: 'humander-public', token: 'test-token' });
    assert.match(url, /newcommit\/releases\/a{64}$/);
    assert.equal(requests.filter(r => r.path.endsWith('/git/blobs')).length, 2);
    assert.equal(requests.find(r => r.path.endsWith('/git/trees')).body.tree[0].path, `releases/${'a'.repeat(64)}/code/main.py`);
    assert.equal(requests.find(r => r.path.endsWith('/git/refs/heads/humander-public')).body.force, false);
  } finally { globalThis.fetch = original; rmSync(root, { recursive: true, force: true }); }
});
