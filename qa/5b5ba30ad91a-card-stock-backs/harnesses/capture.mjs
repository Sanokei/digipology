import fs from 'node:fs/promises';
import { chromium, expect } from '/workspace/digipology/node_modules/@playwright/test/index.mjs';

const phase = process.argv[2] ?? 'before';
const sourceRef = process.argv[3] ?? null;
const origin = 'http://127.0.0.1:8787';
const folder = '/workspace/release-receipts/2026-10-29-themed-card-backs';
const sessionPath = `/workspace/.digipology-cloud/themed-backs-qa-session-${phase}.json`;
await fs.mkdir(`${folder}/${phase}`, {recursive:true});
const browser = await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const errors=[];
const sessions={};
async function pageFor(storageState) {
  const context=await browser.newContext({baseURL:origin,viewport:{width:1440,height:960},...(storageState?{storageState}:{})});
  const page=await context.newPage(); page.on('pageerror',error=>errors.push(error.message));
  return {page,context};
}
async function ready(page) {
  await page.bringToFront();
  await expect(page.getByRole('img',{name:'Live synchronized 3D tabletop',exact:true})).toHaveAttribute('data-render-state','ready',{timeout:30000});
  await page.waitForTimeout(1100);
}
async function host(page,slug) {
  await page.goto('/'); await page.getByRole('button',{name:/host a room/i}).first().click();
  await page.getByLabel('Game',{exact:true}).selectOption(slug);
  await page.getByLabel('Display name',{exact:true}).fill('Alex');
  await page.getByRole('button',{name:'Create table',exact:true}).click();
  const invite=await page.getByLabel('Invite URL',{exact:true}).inputValue();
  await page.getByRole('button',{name:'Enter table',exact:true}).click(); await ready(page);
  await expect(page.getByRole('button',{name:'Show 1 player',exact:true})).toBeVisible();
  return new URL(invite).pathname;
}
async function centerActions(page) {
  await ready(page);
  const canvas=page.getByRole('img',{name:'Live synchronized 3D tabletop',exact:true});
  const box=await canvas.boundingBox();
  await canvas.click({button:'right',position:{x:box.width/2,y:box.height/2}});
  return page.getByRole('menu',{name:'Object actions',exact:true});
}
async function capture(page,name,viewport) {
  await page.setViewportSize(viewport); await ready(page);
  await page.mouse.move(28,25); await page.waitForTimeout(300);
  await page.screenshot({path:`${folder}/${phase}/${name}.png`,fullPage:true});
  const canvas=page.getByRole('img',{name:'Live synchronized 3D tabletop',exact:true});
  const box=await canvas.boundingBox();
  return {name,viewport,canvas:box,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),renderer:await page.evaluate(()=>{
    const canvas=document.querySelector('.table-scene__canvas'); const gl=canvas?.getContext('webgl2')??canvas?.getContext('webgl');
    if(!gl) return 'non-WebGL context'; const extension=gl.getExtension('WEBGL_debug_renderer_info');
    return extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
  })};
}
async function cornerCloseup(page,name) {
  await page.setViewportSize({width:1800,height:1200});await ready(page);
  const box=await page.getByRole('img',{name:'Live synchronized 3D tabletop',exact:true}).boundingBox();
  await page.mouse.move(box.width/2,box.height/2);await page.mouse.wheel(0,-1000);await page.waitForTimeout(650);
  const view=await capture(page,name,{width:1800,height:1200});
  view.presentation='Native camera minimum zoom at larger viewport; about twice default pixel scale';
  await page.setViewportSize({width:1440,height:960});await page.reload();await ready(page);
  return view;
}
const views=[];
try {
  const cards=await pageFor();
  let guest;
  {
    const invite=await host(cards.page,'first-deal');
    guest=await pageFor(); await guest.page.goto(invite);
    await guest.page.getByLabel('Display name',{exact:true}).fill('Sam');
    await guest.page.getByRole('button',{name:'Join table',exact:true}).click(); await ready(guest.page);
    await cards.page.bringToFront();
    await cards.page.getByRole('button',{name:'Shuffle deck',exact:true}).click();
    await cards.page.getByRole('button',{name:'Draw card',exact:true}).click();
    await expect(cards.page.getByRole('button',{name:'Inspect 7 of Diamonds',exact:true})).toBeVisible();
    views.push(await capture(guest.page,'cards-guest-private-desktop',{width:1440,height:960}));
    await expect(guest.page.getByRole('button',{name:/^Inspect /})).toHaveCount(0);
    await cards.page.bringToFront();
    await cards.page.getByRole('button',{name:'Inspect 7 of Diamonds',exact:true}).click({button:'right'});
    await cards.page.getByRole('menuitem',{name:'Play to table',exact:true}).click();
    views.push(await capture(cards.page,'cards-back-desktop',{width:1440,height:960}));
    if(phase!=='before'){
      views.push(await capture(cards.page,'cards-back-narrow',{width:390,height:844}));
      await cards.page.setViewportSize({width:1440,height:960}); await ready(cards.page);
      views.push(await cornerCloseup(cards.page,'stock-back-corners-closeup'));
    }
    const menu=await centerActions(cards.page); await menu.getByRole('menuitem',{name:'Flip',exact:true}).click();
    sessions.guest={url:guest.page.url(),storage:await guest.context.storageState(),session:await guest.page.evaluate(()=>Object.fromEntries(Object.keys(sessionStorage).map(key=>[key,sessionStorage.getItem(key)])))};
  }
  views.push(await capture(cards.page,'cards-front-desktop',{width:1440,height:960}));
  views.push(await capture(cards.page,'cards-front-tablet',{width:768,height:1024}));
  views.push(await capture(cards.page,'cards-front-narrow',{width:390,height:844}));
  if(phase!=='before')views.push(await cornerCloseup(cards.page,'stock-front-corners-closeup'));
  sessions.cards={url:cards.page.url(),storage:await cards.context.storageState(),session:await cards.page.evaluate(()=>Object.fromEntries(Object.keys(sessionStorage).map(key=>[key,sessionStorage.getItem(key)])))};
  if (phase!=='before') {
    await cards.page.setViewportSize({width:1440,height:960}); await ready(cards.page);
    await cards.page.getByRole('button',{name:'Draw card',exact:true}).click();
    await expect(cards.page.getByRole('button',{name:'Inspect Queen of Clubs',exact:true})).toBeVisible();
    views.push(await capture(cards.page,'cards-private-hand-owner-desktop',{width:1440,height:960}));
    views.push(await capture(cards.page,'cards-private-hand-owner-narrow',{width:390,height:844}));
    await cards.page.setViewportSize({width:1440,height:960}); await ready(cards.page);
    await cards.page.getByRole('button',{name:'Inspect Queen of Clubs',exact:true}).click();
    await expect(cards.page.locator('.inspect-overlay__preview .playing-card canvas')).toBeVisible();
    views.push(await capture(cards.page,'queen-court-inspection-desktop',{width:1440,height:960}));
    views.push(await capture(cards.page,'queen-court-inspection-narrow',{width:390,height:480}));
    await cards.page.keyboard.press('Escape');
    await ready(guest.page);
    await expect(guest.page.getByRole('button',{name:/^Inspect /})).toHaveCount(0);
    await expect(guest.page.getByText('Queen of Clubs',{exact:true})).toHaveCount(0);
    views.push(await capture(guest.page,'cards-guest-private-desktop',{width:1440,height:960}));
  }
  await guest.context.close();
  await cards.context.close();
  const dice=await pageFor();
  {
    await host(dice.page,'dice-dash');
    await dice.page.getByRole('button',{name:'Roll Die',exact:true}).click();
    await expect(dice.page.getByRole('complementary',{name:'Game progress'}).getByRole('status')).not.toContainText('Roll the die to begin');
  }
  views.push(await capture(dice.page,'dice-desktop',{width:1440,height:960}));
  views.push(await capture(dice.page,'dice-narrow',{width:390,height:844}));
  sessions.dice={url:dice.page.url(),storage:await dice.context.storageState(),session:await dice.page.evaluate(()=>Object.fromEntries(Object.keys(sessionStorage).map(key=>[key,sessionStorage.getItem(key)])))};
  await dice.context.close();
  await fs.writeFile(sessionPath,JSON.stringify(sessions));
  await fs.writeFile(`${folder}/${phase}/observations.json`,JSON.stringify({phase,sourceRef,origin,views,errors},null,2));
  console.log(JSON.stringify({phase,sourceRef,views,errors}));
} finally {await browser.close();}
