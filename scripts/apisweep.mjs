import { readdirSync, statSync } from 'fs';
import { join } from 'path';
const appDir = 'src/app';
const routes = [];
function isRouteGroup(seg){return seg.startsWith('(')&&seg.endsWith(')');}
function walk(dir, segs){
  for (const e of readdirSync(dir)){
    const full = join(dir,e); const st = statSync(full);
    if (st.isDirectory()) walk(full,[...segs,e]);
    else if (e==='route.ts'||e==='route.tsx'){
      const routeSegs = segs.filter(s=>!isRouteGroup(s));
      const route = '/'+routeSegs.join('/');
      const dynamic = segs.some(s=>s.startsWith('['));
      routes.push({route: route==='/'?'/':route, dynamic});
    }
  }
}
walk(appDir,[]);
const staticRoutes = routes.filter(r=>!r.dynamic).sort((a,b)=>a.route.localeCompare(b.route));
const CONCURRENCY=25, TIMEOUT_MS=5000;
async function probe(url){
  const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort(),TIMEOUT_MS);
  try { const res=await fetch(url,{redirect:'manual',signal:ctrl.signal}); return res.status; }
  catch { return 'ERR'; } finally { clearTimeout(t); }
}
async function run(){
  const results=[];
  for (let i=0;i<staticRoutes.length;i+=CONCURRENCY){
    const batch=staticRoutes.slice(i,i+CONCURRENCY);
    const codes=await Promise.all(batch.map((r) => probe('http://127.0.0.1:4400' + r.route)));
    batch.forEach((r,idx)=>results.push({route:r.route,code:codes[idx]}));
  }
  const dist={}; for (const r of results) dist[r.code]=(dist[r.code]||0)+1;
  console.log('API route handlers (static):',results.length);
  console.log('DISTRIBUTION:',JSON.stringify(dist));
  console.log('--- ANOMALIES (not 200, not 401) ---');
  const anomalies=results.filter(r=>r.code!==200&&r.code!==401);
  if(!anomalies.length) console.log('NONE'); else for(const r of anomalies) console.log(r.code,r.route);
}
run();
