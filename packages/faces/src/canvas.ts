import { ICON_PATHS, PIP_POINTS } from "./icons";
import { parseFacePath, type PathCommand } from "./path";
import type { FaceElement, FaceFill, FaceIconName, FaceSpec } from "./types";

interface GradientLike { addColorStop(offset: number, color: string): void }
export interface Canvas2DLike {
  fillStyle: string | GradientLike; strokeStyle: string; lineWidth: number; globalAlpha: number;
  font: string; textAlign: "left" | "center" | "right"; textBaseline: string;
  save(): void; restore(): void; beginPath(): void; closePath(): void; fill(): void; stroke(): void;
  rect(x:number,y:number,w:number,h:number):void; roundRect(x:number,y:number,w:number,h:number,r:number):void;
  moveTo(x:number,y:number):void; lineTo(x:number,y:number):void; quadraticCurveTo(cpx:number,cpy:number,x:number,y:number):void;
  bezierCurveTo(cp1x:number,cp1y:number,cp2x:number,cp2y:number,x:number,y:number):void;
  arc(x:number,y:number,r:number,start:number,end:number,counterclockwise?:boolean):void;
  ellipse(x:number,y:number,rx:number,ry:number,rotation:number,start:number,end:number,counterclockwise?:boolean):void;
  translate(x:number,y:number):void; rotate(angle:number):void; scale(x:number,y:number):void;
  fillRect(x:number,y:number,w:number,h:number):void; fillText(text:string,x:number,y:number,maxWidth?:number):void;
  createLinearGradient(x1:number,y1:number,x2:number,y2:number):GradientLike;
}

const FONT: Record<string,string>={sans:"Inter,Arial,sans-serif",serif:"Georgia,serif",mono:"ui-monospace,monospace"};

/** Draws a validated FaceSpec into a 0..1000 logical Canvas2D coordinate system. */
export function renderFaceCanvas(context: Canvas2DLike, spec: FaceSpec, width: number, height: number): void {
  context.save(); context.scale(width / 1000, height / 1000);
  context.fillStyle = canvasFill(context, spec.background); context.fillRect(0,0,1000,1000);
  for(const element of spec.elements)drawElement(context,element);
  context.restore();
}

function drawElement(context:Canvas2DLike,element:FaceElement):void{
  context.save();
  if("opacity" in element&&element.opacity!==undefined)context.globalAlpha*=element.opacity;
  if(element.type==="group"){
    if(element.translate!==undefined)context.translate(element.translate.x,element.translate.y);
    if(element.rotate!==undefined)context.rotate(element.rotate*Math.PI/180);
    if(element.scale!==undefined)context.scale(element.scale.x,element.scale.y);
    for(const child of element.elements)drawElement(context,child);
    context.restore();return;
  }
  context.beginPath();
  switch(element.type){
    case"rect": element.r===undefined?context.rect(element.x,element.y,element.w,element.h):context.roundRect(element.x,element.y,element.w,element.h,element.r);break;
    case"circle":context.arc(element.cx,element.cy,element.r,0,Math.PI*2);break;
    case"ellipse":context.ellipse(element.cx,element.cy,element.rx,element.ry,0,0,Math.PI*2);break;
    case"polygon":element.points.forEach((point,index)=>index===0?context.moveTo(point.x,point.y):context.lineTo(point.x,point.y));context.closePath();break;
    case"path":drawPath(context,parseFacePath(element.d)??[]);break;
    case"line":context.moveTo(element.x1,element.y1);context.lineTo(element.x2,element.y2);break;
    case"text":
      context.translate(element.x,element.y);if(element.rotation!==undefined)context.rotate(element.rotation*Math.PI/180);
      context.font=`${element.weight??400} ${element.size}px ${FONT[element.font]}`;context.textAlign=element.align??"left";context.textBaseline="alphabetic";
      if(element.fill!==undefined){context.fillStyle=canvasFill(context,element.fill);context.fillText(element.text,0,0,2000);}context.restore();return;
    case"icon":drawIcon(context,element.name,element.x,element.y,element.size,element.rotation);break;
  }
  if("fill" in element&&element.fill!==undefined){context.fillStyle=canvasFill(context,element.fill);context.fill();}
  if("stroke" in element&&element.stroke!==undefined){context.strokeStyle=element.stroke;context.lineWidth="strokeWidth" in element?element.strokeWidth??1:1;context.stroke();}
  context.restore();
}

function drawIcon(context:Canvas2DLike,name:FaceIconName,x:number,y:number,size:number,rotation:number|undefined):void{
  context.translate(x-size/2,y-size/2);context.scale(size/1000,size/1000);if(rotation!==undefined) {context.translate(500,500);context.rotate(rotation*Math.PI/180);context.translate(-500,-500);}
  if(name.startsWith("pip-")){for(const[cx,cy]of PIP_POINTS[name as `pip-${number}`]!){context.moveTo(cx+90,cy);context.arc(cx,cy,90,0,Math.PI*2);}return;}
  drawPath(context,parseFacePath(ICON_PATHS[name as keyof typeof ICON_PATHS])??[]);
}

function drawPath(context:Canvas2DLike,commands:readonly PathCommand[]):void{
  let x=0,y=0,startX=0,startY=0;
  for(const{command,values:v}of commands){
    if(command==="M"){[x,y]=v as [number,number];startX=x;startY=y;context.moveTo(x,y);}
    else if(command==="L"){[x,y]=v as [number,number];context.lineTo(x,y);}
    else if(command==="Q"){context.quadraticCurveTo(v[0]!,v[1]!,v[2]!,v[3]!);x=v[2]!;y=v[3]!;}
    else if(command==="C"){context.bezierCurveTo(v[0]!,v[1]!,v[2]!,v[3]!,v[4]!,v[5]!);x=v[4]!;y=v[5]!;}
    else if(command==="A"){arcTo(context,x,y,v[0]!,v[1]!,v[2]!,v[3]!,v[4]!,v[5]!,v[6]!);x=v[5]!;y=v[6]!;}
    else {context.closePath();x=startX;y=startY;}
  }
}

function arcTo(c:Canvas2DLike,x1:number,y1:number,rxInput:number,ryInput:number,rotation:number,large:number,sweep:number,x2:number,y2:number):void{
  let rx=Math.abs(rxInput),ry=Math.abs(ryInput);if(rx===0||ry===0||x1===x2&&y1===y2){c.lineTo(x2,y2);return;}
  const phi=rotation*Math.PI/180,cos=Math.cos(phi),sin=Math.sin(phi),dx=(x1-x2)/2,dy=(y1-y2)/2;
  const xp=cos*dx+sin*dy,yp=-sin*dx+cos*dy;const scale=xp*xp/(rx*rx)+yp*yp/(ry*ry);if(scale>1){const root=Math.sqrt(scale);rx*=root;ry*=root;}
  const sign=Boolean(large)===Boolean(sweep)?-1:1;const numerator=Math.max(0,rx*rx*ry*ry-rx*rx*yp*yp-ry*ry*xp*xp);const denominator=rx*rx*yp*yp+ry*ry*xp*xp;
  const factor=sign*Math.sqrt(denominator===0?0:numerator/denominator);const cxp=factor*rx*yp/ry,cyp=factor*-ry*xp/rx;
  const cx=cos*cxp-sin*cyp+(x1+x2)/2,cy=sin*cxp+cos*cyp+(y1+y2)/2;
  const angle=(ux:number,uy:number,vx:number,vy:number)=>Math.atan2(ux*vy-uy*vx,ux*vx+uy*vy);
  const ux=(xp-cxp)/rx,uy=(yp-cyp)/ry,vx=(-xp-cxp)/rx,vy=(-yp-cyp)/ry;let delta=angle(ux,uy,vx,vy);if(!sweep&&delta>0)delta-=Math.PI*2;if(sweep&&delta<0)delta+=Math.PI*2;
  c.ellipse(cx,cy,rx,ry,phi,Math.atan2(uy,ux),Math.atan2(uy,ux)+delta,!sweep);
}

function canvasFill(context:Canvas2DLike,fill:FaceFill):string|GradientLike{if(typeof fill==="string")return fill;const gradient=context.createLinearGradient(fill.x1,fill.y1,fill.x2,fill.y2);for(const stop of fill.stops)gradient.addColorStop(stop.offset,stop.color);return gradient;}
