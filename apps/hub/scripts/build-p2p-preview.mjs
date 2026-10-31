import {build} from 'esbuild';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=path.join(root,'dist/p2p-preview');
await mkdir(output,{recursive:true});
// Refuse unexpected files so a reused output folder cannot leak unrelated artifacts.
const allowed=['index.html','p2p.js','p2p.css','_headers'];
if((await readdir(output)).some(file=>!allowed.includes(file)))throw Error('Unexpected preview output file');
const result=await build({absWorkingDir:root,entryPoints:['scripts/p2p-preview/main.tsx'],bundle:true,minify:true,format:'esm',platform:'browser',target:'es2022',jsx:'automatic',outfile:path.join(output,'p2p.js'),define:{'process.env.NODE_ENV':'"production"'},metafile:true,sourcemap:false,legalComments:'inline'});
const sources=Object.keys(result.metafile.inputs);
if(sources.some(file=>file.includes('server/')||file.includes('.dev.vars')||file.includes('next/')))throw Error('Unexpected server dependency');
await writeFile(path.join(output,'index.html'),'<!doctype html><html lang="ja" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Hub P2P テスト</title><link rel="stylesheet" href="/p2p.css"><script type="module" src="/p2p.js"></script></head><body><div id="root"></div></body></html>\n');
await writeFile(path.join(output,'_headers'),`/*
  Cache-Control: no-store
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  X-Robots-Tag: noindex, nofollow
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
`);
const hashes=Object.fromEntries(await Promise.all(allowed.map(async file=>[file,createHash('sha256').update(await readFile(path.join(output,file))).digest('hex')])));
console.log(JSON.stringify({output,sources:sources.length,hashes},null,2));
