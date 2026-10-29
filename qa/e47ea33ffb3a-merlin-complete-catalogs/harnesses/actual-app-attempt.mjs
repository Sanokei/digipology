import { chromium, expect } from '/workspace/digipology/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const out='/workspace/release-receipts/2026-10-29-merlin-catalogs';
const input=JSON.parse(await fs.readFile(`${out}/complete-input/merlin-economics.request.json`,'utf8'));
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 const page=await browser.newPage({baseURL:'http://127.0.0.1:8787',viewport:{width:1440,height:960}});
 await page.goto('/login');await page.getByLabel('Email address',{exact:true}).fill(`merlin-real-input-${Date.now()}@example.test`);await page.getByRole('button',{name:'Email me a link',exact:true}).click();await page.getByRole('heading',{name:'Check your email',exact:true}).waitFor();
 const {link}=await(await page.request.get('/api/dev/last-magic-link')).json();await page.goto(link);await page.goto('/create');await page.getByLabel('Game description',{exact:true}).fill(input.prompt);
 await page.getByLabel('Attach rule or card files',{exact:true}).setInputFiles(input.references.map(source=>({name:source.name,mimeType:source.name.endsWith('.csv')?'text/csv':'text/markdown',buffer:Buffer.from(source.text,'utf8')})));
 const sources=page.getByRole('list',{name:'Attached source documents',exact:true});await expect(sources.locator('li')).toHaveCount(8);
 for(const [index,source]of input.references.entries())await sources.locator('li').nth(index).getByRole('textbox',{name:/Public source URL/}).fill(source.sourceUrl);
 await page.screenshot({path:`${out}/actual-app-eight-sources-desktop.png`,fullPage:true});
 const pending=page.waitForResponse(r=>r.url().endsWith('/api/ai/games')&&r.request().method()==='POST',{timeout:600000});await page.getByRole('button',{name:'Create & play',exact:true}).click();const response=await pending;const sent=response.request().postDataJSON();expect(sent).toEqual(input);const result=await response.json();
 if(response.status()===503){expect(result).toMatchObject({error:{code:'ai_unconfigured'}});await expect(page.getByRole('button',{name:'Retry AI draft',exact:true})).toBeEnabled();}
 if(response.status()===200)await fs.writeFile('/workspace/.digipology-cloud/actual-merlin-provider-output.json',JSON.stringify(result));
 await page.setViewportSize({width:390,height:844});
 if(response.status()!==200)await page.getByRole('button',{name:'Download generation request',exact:true}).scrollIntoViewIfNeeded();
 await page.screenshot({path:`${out}/actual-app-eight-source-result-390.png`,fullPage:false});
 const receipt={applicationSource:'e47ea33',origin:'http://127.0.0.1:8787',time:new Date().toISOString(),normalFormAndApi:true,modelFixtureUsed:false,sources:sent.references.map(s=>({name:s.name,sourceUrl:s.sourceUrl,bytes:Buffer.byteLength(s.text,'utf8'),sha256:crypto.createHash('sha256').update(s.text).digest('hex')})),combinedSourceBytes:99651,exactRequestRetained:true,response:{status:response.status(),code:result.error?.code??null},generatedOutputReceived:response.status()===200,fullGameAccepted:false,scope:'Actual existing development app/config with all eight real sources. Source intake/provider availability only; no fixture output, faithful generated Merlin, art or fun acceptance.'};
 await fs.writeFile(`${out}/actual-app-attempt.json`,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{await browser.close();}
