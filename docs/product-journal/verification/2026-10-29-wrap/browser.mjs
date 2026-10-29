import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const root=process.cwd(), out=process.env.BB_THREAD_STORAGE;
const require=createRequire(path.join(root,'package.json'));
const { chromium }=require('playwright'), ts=require('typescript');
const host=process.env.BB_SERVER_URL;
const hostHtml=await (await fetch(host)).text();
const css=[...hostHtml.matchAll(/<link[^>]+href="([^"]+\.css)"[^>]*>/g)].map(m=>new URL(m[1],host).href);
if(!css.length)throw Error('BB CSS not found');
const quotes=JSON.parse((await fs.readFile(path.join(root,'quotes.ts'),'utf8')).match(/export const QUOTES = (\[.*?\]) as const;/s)[1]);
const ordered=[...quotes].sort((a,b)=>a.text.length-b.text.length);
const samples={short:ordered[0],medium:ordered[Math.floor(ordered.length/2)],long:ordered.at(-1)};
const js={};
for(const name of ['group-tools','quotes'])js['/'+name+'.js']=ts.transpileModule((await fs.readFile(path.join(root,name+'.ts'),'utf8')).replace('./quotes.ts','./quotes.js'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const appCss=await fs.readFile(path.join(root,'dist/app.css'),'utf8');
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(js[u.pathname]){res.setHeader('Content-Type','text/javascript');res.end(js[u.pathname]);return;}
 if(u.pathname==='/app.css'){res.setHeader('Content-Type','text/css');res.end(appCss);return;}
 const sample=samples[u.searchParams.get('sample')??'long'],width=Number(u.searchParams.get('width')),theme=u.searchParams.get('theme')??'light',unknown=u.searchParams.get('unknown')==='1';
 res.setHeader('Content-Type','text/html; charset=utf-8');
 res.end(`<!doctype html><html lang="ru" class="${theme==='dark'?'dark':''}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${css.map(x=>`<link rel="stylesheet" href="${x}">`).join('')}<link rel="stylesheet" href="/app.css"></head><body class="bg-background text-foreground"><main class="p-4"><div id="field" style="width:${width}px;max-width:100%"><p class="mb-4 text-sm text-foreground">Minus — перенос в поле чата</p><div data-timeline-row-list="top-level"><div data-timeline-items><div data-timeline-row-id="thr_fixture:tool-1">Tool 1</div><div data-timeline-row-id="thr_fixture:tool-2">Tool 2</div><div data-timeline-row-id="thr_fixture:user:after"><p class="group/message mt-4 text-sm">Следующее сообщение не должно перекрываться.</p></div></div></div><span id="reference" class="text-muted-foreground"></span></div></main><script type="module">import {mountToolGrouping} from '/group-tools.js';const quote=${JSON.stringify(sample)};mountToolGrouping(async()=>[1,2].map(i=>({id:'thr_fixture:tool-'+i,kind:'work',startedAt:1000,completedAt:${unknown?'undefined':'7600'},status:'completed'})),()=>quote);</script></body></html>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true});
const observations=[];
try{
 const widths={};
 for(const [name,viewport] of [['desktop',{width:1280,height:800}],['mobile',{width:390,height:844}]]){
  const page=await browser.newPage({viewport});
  await page.goto(host+'/projects/proj_i3bpsrhmmp/threads/thr_bza87x5nhg',{waitUntil:'domcontentloaded'});
  await page.locator('[data-bb-minus-group]').last().waitFor();
  widths[name]=await page.locator('[data-bb-minus-group]').last().evaluate(x=>x.getBoundingClientRect().width);
  await page.close();
 }
 const contexts=[{name:'desktop',viewport:{width:1280,height:800},width:widths.desktop},{name:'desktop-narrow-field',viewport:{width:1280,height:800},width:widths.mobile},{name:'mobile',viewport:{width:390,height:844},width:widths.mobile}];
 for(const ctx of contexts)for(const theme of ['light','dark'])for(const sample of ['short','medium','long']){
  const page=await browser.newPage({viewport:ctx.viewport});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+`/?sample=${sample}&width=${ctx.width}&theme=${theme}&unknown=1`,{waitUntil:'domcontentloaded'});
  const marker=page.locator('[data-bb-minus-group]'),button=marker.locator('button');await marker.waitFor({state:'attached'});if(!await marker.isVisible())throw Error('Marker hidden '+await marker.evaluate(x=>JSON.stringify({html:x.outerHTML,style:getComputedStyle(x).cssText,display:getComputedStyle(x).display,rect:x.getBoundingClientRect().toJSON()})));
  const read=()=>page.evaluate(()=>{const m=document.querySelector('[data-bb-minus-group]'),q=m.querySelector('[data-quote]'),metrics=m.querySelector('[data-metrics]'),source=m.querySelector('[data-source]'),row=m.querySelector('[data-row]'),r=document.createRange();r.selectNodeContents(q);const rects=[...r.getClientRects()].filter(x=>x.width>0);const rr=row.getBoundingClientRect(),after=document.querySelector('[data-timeline-row-id="thr_fixture:user:after"]').getBoundingClientRect();return {quote:q.textContent,lines:new Set(rects.map(x=>Math.round(x.top))).size,quoteColor:getComputedStyle(q).color,metricColor:getComputedStyle(metrics).color,sourceColor:getComputedStyle(source).color,referenceColor:getComputedStyle(document.querySelector('#reference')).color,whiteSpace:getComputedStyle(q).whiteSpace,textOverflow:getComputedStyle(q).textOverflow,rowWidth:rr.width,rowHeight:rr.height,contentsFit:[...rects,metrics.getBoundingClientRect(),source.getBoundingClientRect()].every(x=>x.left>=rr.left&&x.right<=rr.right+1),nextMessageBelow:after.top>=rr.bottom,metrics:metrics.textContent,focusShadow:getComputedStyle(m.querySelector('button')).boxShadow};});
  const idle=await read();if(idle.quote!==samples[sample].text)throw Error('Fixture text encoding mismatch');await button.hover();const hover=await read();await page.keyboard.press('Tab');await page.waitForFunction(()=>document.activeElement===document.querySelector('[data-bb-minus-group] button'));const focus=await read();
  await button.press('Enter');await page.waitForFunction(()=>document.querySelector('[data-bb-minus-group] button').getAttribute('aria-expanded')==='true');const expanded=await button.getAttribute('aria-expanded');await button.press('Space');await page.waitForFunction(()=>document.querySelector('[data-bb-minus-group] button').getAttribute('aria-expanded')==='false');const collapsed=await button.getAttribute('aria-expanded');
  for(const state of [idle,hover,focus])if(!state.contentsFit||!state.nextMessageBelow||state.quoteColor!==state.referenceColor||state.metricColor!==state.referenceColor||state.sourceColor!==state.referenceColor)throw Error('Layout/color failure '+JSON.stringify({ctx,theme,sample,state}));
  if(focus.focusShadow==='none')throw Error('Keyboard focus ring missing');
  if(ctx.name!=='desktop'&&sample==='long'&&idle.lines<2)throw Error('Long text did not wrap');
  if(expanded!=='true'||collapsed!=='false'||errors.length)throw Error('Interaction failed '+JSON.stringify({expanded,collapsed,errors}));
  observations.push({context:ctx,theme,sample,idle,hover,focus,expanded,collapsed,errors});await page.close();
 }
 // Change only the field width while keeping a desktop viewport.
 const page=await browser.newPage({viewport:{width:1280,height:800}});
 await page.goto(base+`/?sample=long&width=${widths.desktop}&unknown=1`);await page.locator('[data-quote]').waitFor();
 await page.locator('#field').evaluate((x,w)=>x.style.width=w+'px',widths.mobile);
 const resized=await page.locator('[data-quote]').evaluate(x=>{const r=document.createRange();r.selectNodeContents(x);return {lines:new Set([...r.getClientRects()].map(x=>Math.round(x.top))).size,text:x.textContent};});
 if(resized.lines<2)throw Error('Resizing the field failed');
 await page.close();
 await fs.writeFile(path.join(out,'minus-wrap-layout.json'),JSON.stringify({method:'isolated headless Chromium fixture using actual candidate module and BB CSS',browser:browser.version(),measuredLiveFieldWidths:widths,observations,resized},null,2)+'\n');
 await promisify(execFile)(process.execPath,['/Users/vadikone/.agents/governance/local-ui-capture/capture.mjs','--url',base+`/?sample=long&width=${widths.mobile}&unknown=1`,'--out',path.join(out,'minus-wrap-captures'),'--viewports','1280x800,390x844','--prefix','wrap','--repo',root,'--wait-for','[data-quote]']);
 console.log(JSON.stringify({cases:observations.length,measuredLiveFieldWidths:widths,fieldResize:resized.lines+' lines',status:'passed'}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
