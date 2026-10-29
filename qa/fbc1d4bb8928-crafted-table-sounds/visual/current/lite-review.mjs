import fs from 'node:fs/promises';
import {chromium,expect} from '/workspace/digipology/node_modules/@playwright/test/index.mjs';
const origin='http://127.0.0.1:8787';
const folder='/workspace/release-receipts/2026-10-29-crafted-table/final';
const session=JSON.parse(await fs.readFile('/workspace/.digipology-cloud/render-qa-session-final.json','utf8'));
const sourceRef=process.argv[2]??null;
const redact=value=>value.replace(/([?&](?:token|roomToken|auth)=)[^&\s'\"]+/gi,'$1[redacted]');
const results=[];
const candidates=[
  {name:'vulkan-swiftshader',args:['--enable-unsafe-webgpu','--use-angle=swiftshader','--enable-features=Vulkan','--use-vulkan=swiftshader']},
];
for(const candidate of candidates){
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader',...candidate.args]});
  const errors=[];const warnings=[];
  try{
    const probe=await browser.newPage(); await probe.goto(origin);
    const info=await probe.evaluate(async()=>{
      if(!navigator.gpu)return{available:false,reason:'navigator.gpu unavailable'};
      const adapter=await navigator.gpu.requestAdapter({powerPreference:'low-power'});
      return adapter?{available:true,info:{vendor:adapter.info.vendor,architecture:adapter.info.architecture,description:adapter.info.description,isFallbackAdapter:adapter.info.isFallbackAdapter}}:{available:false,reason:'requestAdapter returned null'};
    });
    results.push({candidate:candidate.name,args:candidate.args,...info});
    async function restored(saved){
      const context=await browser.newContext({storageState:saved.storage,viewport:{width:1440,height:960}});
      await context.addInitScript(({saved,origin})=>{if(location.origin===origin)for(const[key,value]of Object.entries(saved))sessionStorage.setItem(key,value);},{saved:saved.session,origin});
      const page=await context.newPage();page.on('pageerror',error=>errors.push(redact(error.message)));page.on('console',message=>{if(message.type()==='error'||message.type()==='warning')warnings.push(redact(message.text()).slice(0,400));});
      const url=new URL(saved.url);url.searchParams.set('renderer','lite');await page.goto(url.href);
      await expect(page.getByRole('img',{name:'Live synchronized 3D tabletop',exact:true})).toHaveAttribute('data-render-state','ready',{timeout:30000});
      await page.waitForTimeout(1100);return{context,page};
    }
    const cards=await restored(session.cards);
    const mounted=await cards.page.locator('.renderer-override-chip').innerText();results.at(-1).mounted=mounted;
    if(!mounted.includes('Renderer: lite')){
      await cards.page.mouse.move(28,25);await cards.page.screenshot({path:`${folder}/fallback-${candidate.name}-cards.png`,fullPage:true});await cards.context.close();
      const guest=await restored(session.guest);await expect(guest.page.getByRole('button',{name:/^Inspect /})).toHaveCount(0);await expect(guest.page.getByText('Queen of Clubs',{exact:true})).toHaveCount(0);
      await guest.page.mouse.move(28,25);await guest.page.screenshot({path:`${folder}/fallback-${candidate.name}-guest-private.png`,fullPage:true});await guest.context.close();
      results.at(-1).checks=['actual mounted WebGL fallback after requesting Lite','guest cannot see owner Queen of Clubs'];results.at(-1).errors=errors;results.at(-1).warnings=warnings;continue;
    }
    for(const [name,viewport]of [['lite-cards-desktop',{width:1440,height:960}],['lite-cards-narrow',{width:390,height:844}]]){
      await cards.page.setViewportSize(viewport);await cards.page.mouse.move(28,25);await cards.page.waitForTimeout(800);
      await cards.page.screenshot({path:`${folder}/${name}.png`,fullPage:true});
    }
    await cards.page.setViewportSize({width:1440,height:960});await cards.page.waitForTimeout(600);
    const canvas=cards.page.getByRole('img',{name:'Live synchronized 3D tabletop',exact:true});const box=await canvas.boundingBox();
    await canvas.click({button:'right',position:{x:box.width/2,y:box.height/2}});
    const menu=cards.page.getByRole('menu',{name:'Object actions',exact:true});await expect(menu.locator('header strong')).toHaveText('7 of Diamonds');
    await menu.getByRole('menuitem',{name:'Flip',exact:true}).click();
    await canvas.click({button:'right',position:{x:box.width/2,y:box.height/2}});
    await expect(menu.locator('header strong')).toHaveText('Face-down card');await menu.getByRole('menuitem',{name:'Inspect',exact:true}).click();
    await expect(cards.page.locator('.inspect-overlay__preview .playing-card[data-card-face="card-back"] canvas')).toBeVisible();
    await cards.page.screenshot({path:`${folder}/lite-concealed-card-inspection.png`,fullPage:true});await cards.page.keyboard.press('Escape');
    await cards.page.setViewportSize({width:390,height:844}); await cards.page.mouse.move(28,25);await cards.page.waitForTimeout(800);
    await cards.page.screenshot({path:`${folder}/lite-cards-back-narrow.png`,fullPage:true});
    await cards.page.setViewportSize({width:1440,height:960});await cards.page.waitForTimeout(800);
    await canvas.click({button:'right',position:{x:box.width/2,y:box.height/2}});await menu.getByRole('menuitem',{name:'Flip',exact:true}).click();
    await expect(cards.page.getByRole('button',{name:'Inspect Queen of Clubs',exact:true})).toBeVisible();
    await cards.context.close();
    const guest=await restored(session.guest);
    await expect(guest.page.getByRole('button',{name:/^Inspect /})).toHaveCount(0);await expect(guest.page.getByText('Queen of Clubs',{exact:true})).toHaveCount(0);
    await guest.page.mouse.move(28,25);await guest.page.screenshot({path:`${folder}/lite-guest-private.png`,fullPage:true});await guest.context.close();
    const dice=await restored(session.dice);await dice.page.mouse.move(28,25);await dice.page.screenshot({path:`${folder}/lite-dice-desktop.png`,fullPage:true});
    await dice.page.setViewportSize({width:390,height:844});await dice.page.waitForTimeout(800);await dice.page.screenshot({path:`${folder}/lite-dice-narrow.png`,fullPage:true});
    const progress=dice.page.getByRole('complementary',{name:'Game progress'});let rolls=0;
    for(;rolls<40;rolls++){
      if((await progress.getByRole('status').innerText()).includes('wins Dice Dash!'))break;
      const before=await progress.innerText();await dice.page.getByRole('button',{name:'Roll Die',exact:true}).click();
      await expect.poll(()=>progress.innerText()).not.toBe(before);
    }
    await expect(progress.getByRole('status')).toContainText('wins Dice Dash!');await expect(dice.page.getByRole('button',{name:'Roll Die',exact:true})).toBeDisabled();
    await dice.page.mouse.move(28,25);await dice.page.waitForTimeout(800);await dice.page.screenshot({path:`${folder}/lite-winner-narrow.png`,fullPage:true});
    await dice.page.setViewportSize({width:1440,height:960});await dice.page.waitForTimeout(800);await dice.page.screenshot({path:`${folder}/lite-winner-desktop.png`,fullPage:true});await dice.context.close();
    results.at(-1).rollsToWinner=rolls;results.at(-1).checks=['actual mounted Lite','desktop and narrow card/deck/die frames','root picking and face flip','concealed generic back and phone back','guest cannot see owner Queen of Clubs','ordinary one-player rolls reach winner and disable roll'];
    results.at(-1).errors=errors;results.at(-1).warnings=warnings;break;
  }catch(error){results.at(-1).error=redact(String(error));results.at(-1).errors=errors;results.at(-1).warnings=warnings;}
  finally{await browser.close();}
}
await fs.writeFile(`${folder}/lite-observations.json`,JSON.stringify({sourceRef,origin,candidates:results},null,2));console.log(JSON.stringify({sourceRef,candidates:results}));
