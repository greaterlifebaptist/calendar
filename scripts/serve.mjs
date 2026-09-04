/**
 * Local preview server.
 *
 * Mirrors how the site is assembled for GitHub Pages: the pages in `site/`
 * and the job's output in `public/` are served from one root, so `index.html`
 * can fetch `./events.json` and `./feeds/*.ics` exactly as it will in
 * production. Serving them from separate origins would hide broken paths.
 *
 *   node scripts/serve.mjs [port]
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
// site/ first, then a fixture run's output if there is one, then the real
// published data. Mirrors how GitHub Pages assembles the deploy.
const ROOTS = [join(ROOT, 'site'), join(ROOT, '.dev-site'), join(ROOT, 'public')];
const PORT = Number(process.argv[2] ?? 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ics': 'text/calendar; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function resolve(urlPath) {
  let rel = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^[\\/]+/, '');
  if (rel.startsWith('..')) return null;
  if (rel === '') rel = 'index.html';

  for (const base of ROOTS) {
    const candidate = join(base, rel);
    try {
      const info = await stat(candidate);
      if (info.isDirectory()) {
        const index = join(candidate, 'index.html');
        await stat(index);
        return index;
      }
      return candidate;
    } catch {
      // try the next root
    }
  }
  return null;
}

const server = createServer(async (req, res) => {
  const file = await resolve(req.url ?? '/');
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found: ' + req.url);
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(String(err));
  }
});

server.listen(PORT, () => {
  process.stdout.write('Preview at http://localhost:' + PORT + '/\n');
  process.stdout.write('Serving site/ over public/\n');
});
