/**
 * src/ → public/, with configuration injected from the environment.
 *
 * No dependencies. Runs on Vercel at deploy time and locally via `npm run build`.
 * The source files work unbuilt (every token defaults to ''), so `src/index.html`
 * can still be opened straight from disk for layout work.
 *
 * Tokens in the HTML look like:   ENDPOINT: '' /*@ENDPOINT@*​/
 * and are replaced with the env var of the same name. Unset vars stay ''.
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'src', OUT = 'public';

// Vercel sets VERCEL_ENV to 'production' | 'preview' | 'development'.
// Only production is indexable; previews and local builds are not.
const env = process.env.VERCEL_ENV || 'development';
const indexable = env === 'production' && process.env.NOINDEX !== '1';

const TOKENS = ['ENDPOINT', 'META_PIXEL_ID', 'TIKTOK_PIXEL_ID', 'GTAG_ID',
                'GADS_CONVERSION_LABEL', 'LINKEDIN_PARTNER_ID'];

// JS string literal — never let a value break out of its quotes
const js = v => String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/<\//g, '<\\/');

function render(html, name) {
  let out = html, used = [];
  for (const t of TOKENS) {
    const re = new RegExp(`''\\s*/\\*@${t}@\\*/`, 'g');
    if (re.test(out)) {
      const v = process.env[t] || '';
      out = out.replace(re, `'${js(v)}'`);
      used.push(t + (v ? '' : ' (empty)'));
    }
  }
  out = out.replace('<!--@ROBOTS@-->',
    indexable ? '<meta name="robots" content="index,follow" />'
              : '<meta name="robots" content="noindex,nofollow" />');
  console.log(`  ${name}: ${used.join(', ') || 'no tokens'} · robots=${indexable ? 'index' : 'noindex'}`);
  return out;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'assets'), { recursive: true });

for (const f of ['index.html', 'signup.html']) {
  writeFileSync(join(OUT, f), render(readFileSync(join(SRC, f), 'utf8'), f));
}
cpSync(join(SRC, 'assets'), join(OUT, 'assets'), { recursive: true });

writeFileSync(join(OUT, 'robots.txt'),
  indexable ? 'User-agent: *\nAllow: /\n' : 'User-agent: *\nDisallow: /\n');

console.log(`built → ${OUT}/  (${env}${indexable ? ', indexable' : ', noindex'})`);
