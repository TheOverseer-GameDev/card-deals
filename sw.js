const C='cd3-1793985785',F=['./','index.html','data.js','chart.min.js','manifest.json','icon-192.png','scan/boot.js','scan/engine.js','scan/lookup.js','scan/image.js','scan/scan.css','scan/verified-prices.json'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(F.map(u=>new Request(u,{cache:'reload'})))))});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!=C).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!='GET')return;const u=new URL(r.url);if(u.origin!=location.origin)return;
 const fresh=r.mode=='navigate'||/\.(html|json|js)$|\/$/.test(u.pathname)&&!/chart\.min\.js$/.test(u.pathname);
 e.respondWith(fetch(r,fresh?{cache:'no-store'}:{}).then(x=>{if(x.ok){const cl=x.clone();caches.open(C).then(c=>c.put(r,cl))}return x}).catch(()=>caches.match(r,{ignoreSearch:true})))});