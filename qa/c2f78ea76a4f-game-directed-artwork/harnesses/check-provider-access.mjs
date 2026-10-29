import { chromium } from '/workspace/digipology/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs/promises';
const folder='/workspace/release-receipts/2026-10-29-game-art';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 const page=await browser.newPage({baseURL:'http://127.0.0.1:8787'});
 await page.goto('/login');await page.getByLabel('Email address',{exact:true}).fill(`art-access-${Date.now()}@example.test`);await page.getByRole('button',{name:'Email me a link',exact:true}).click();await page.getByRole('heading',{name:'Check your email',exact:true}).waitFor();
 const {link}=await(await page.request.get('/api/dev/last-magic-link')).json();await page.goto(link);
 const input={draftId:'merlin-art-access-check',title:'Merlin Economics',purpose:'card-back',direction:{version:1,style:'Ink-blue and aged copper alchemical engraving inspired by the author-provided Merlin Economics economy: gold, royal seals, golems and an alembic; strong silhouettes.',coverPrompt:'One merchant mage balances a glowing coin above an economic ledger.',cardBackPrompt:'A deliberate 180-degree symmetric copper seal joining an alembic and stone hands, with safe edges and no ranks, suits, copy or ownership hints.'},revision:0};
 const result=await page.evaluate(async(input)=>{const r=await fetch('/api/ai/artwork',{method:'POST',headers:{'Content-Type':'application/json','X-Digipology-CSRF':'1'},body:JSON.stringify(input)});return{status:r.status,body:await r.json()};},input);
 const receipt={source:'c2f78ea76a4ff2570af01c40c911736bef72db80',origin:'http://127.0.0.1:8787',time:new Date().toISOString(),scope:'Actual normal development app, existing account/config, no model/image fixture. Host-authored typed art access request, not a generated Merlin game or game-authored plan.',status:result.status,error:result.body.error??null,model:result.body.model??null,originalSha256:result.body.originalSha256??null,generatedGame:false};
 if(result.status===200)await fs.writeFile('/workspace/.digipology-cloud/art-provider-access-output.json',JSON.stringify(result.body));
 await fs.writeFile(`${folder}/actual-image-provider-access.json`,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{await browser.close();}
