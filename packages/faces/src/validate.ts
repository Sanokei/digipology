import { parseFacePath } from "./path";
import { FACE_FONTS, FACE_ICONS, type FaceElement, type FaceFill, type FaceSpec, type FaceValidationError, type FaceValidationOptions, type FaceValidationResult } from "./types";

const COLOR = /^#[0-9a-fA-F]{6}$/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const MAX_PATH_LENGTH = 8_192;
const MAX_TEXT_LENGTH = 200;
const MAX_NUMBER = 10_000;

type ObjectValue = Record<string, unknown>;

export function validateFaceSpec(raw: unknown, options: FaceValidationOptions = {}): FaceValidationResult {
  const errors: FaceValidationError[] = [];
  const maximum = options.maxElements ?? 300;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 2_500) {
    return { ok: false, errors: [{ path: "$", code: "range", message: "maxElements must be an integer from 1 to 2500" }] };
  }
  if (!record(raw)) return failed(errors, "$", "type", "FaceSpec must be an object");
  exact(raw, ["background", "elements"], "$", errors);
  const background = fill(raw.background, "$.background", errors);
  if (!Array.isArray(raw.elements)) return failed(errors, "$.elements", "type", "elements must be an array");
  let count = 0;
  const elements = validateElements(raw.elements, "$.elements", errors, () => {
    count += 1;
    if (count > maximum && !errors.some((error) => error.code === "limit" && error.path === "$.elements")) {
      error(errors, "$.elements", "limit", `FaceSpec exceeds the ${maximum} element limit`);
    }
  });
  if (background === null || elements === null || errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { background, elements }, errors: [] };
}

function validateElements(values: unknown[], path: string, errors: FaceValidationError[], increment: () => void): FaceElement[] | null {
  const result: FaceElement[] = [];
  for (let index = 0; index < values.length; index += 1) {
    increment();
    const element = validateElement(values[index], `${path}[${index}]`, errors, increment);
    if (element !== null) result.push(element);
  }
  return result.length === values.length ? result : null;
}

function validateElement(raw: unknown, path: string, errors: FaceValidationError[], increment: () => void): FaceElement | null {
  if (!record(raw) || typeof raw.type !== "string") {
    error(errors, path, "type", "element must be an object with a type"); return null;
  }
  const paint = (): { fill?: FaceFill; stroke?: `#${string}`; strokeWidth?: number; opacity?: number } => {
    const result: { fill?: FaceFill; stroke?: `#${string}`; strokeWidth?: number; opacity?: number } = {};
    if (raw.fill !== undefined) { const value = fill(raw.fill, `${path}.fill`, errors); if (value !== null) result.fill = value; }
    if (raw.stroke !== undefined) { const value = color(raw.stroke, `${path}.stroke`, errors); if (value !== null) result.stroke = value; }
    if (raw.strokeWidth !== undefined) { const value = number(raw.strokeWidth, `${path}.strokeWidth`, errors, 0, 100); if (value !== null) result.strokeWidth = value; }
    if (raw.opacity !== undefined) { const value = number(raw.opacity, `${path}.opacity`, errors, 0, 1); if (value !== null) result.opacity = value; }
    return result;
  };
  const n = (name: string, min = -MAX_NUMBER, max = MAX_NUMBER) => number(raw[name], `${path}.${name}`, errors, min, max);
  switch (raw.type) {
    case "rect": {
      exact(raw, ["type", "x", "y", "w", "h", "r", "fill", "stroke", "strokeWidth", "opacity"], path, errors);
      const x=n("x"), y=n("y"), w=n("w",0), h=n("h",0), r=raw.r===undefined?undefined:n("r",0);
      return x===null||y===null||w===null||h===null||r===null ? null : { type:"rect",x,y,w,h,...(r===undefined?{}:{r}),...paint() };
    }
    case "circle": {
      exact(raw,["type","cx","cy","r","fill","stroke","strokeWidth","opacity"],path,errors);
      const cx=n("cx"),cy=n("cy"),r=n("r",0); return cx===null||cy===null||r===null?null:{type:"circle",cx,cy,r,...paint()};
    }
    case "ellipse": {
      exact(raw,["type","cx","cy","rx","ry","fill","stroke","strokeWidth","opacity"],path,errors);
      const cx=n("cx"),cy=n("cy"),rx=n("rx",0),ry=n("ry",0); return cx===null||cy===null||rx===null||ry===null?null:{type:"ellipse",cx,cy,rx,ry,...paint()};
    }
    case "polygon": {
      exact(raw,["type","points","fill","stroke","strokeWidth","opacity"],path,errors);
      if (!Array.isArray(raw.points) || raw.points.length < 3 || raw.points.length > 500) { error(errors,`${path}.points`,"limit","polygon points must contain 3 to 500 points"); return null; }
      const points: Array<{x:number;y:number}>=[];
      raw.points.forEach((point,index)=>{ if(!record(point)){error(errors,`${path}.points[${index}]`,"type","point must be an object");return;} exact(point,["x","y"],`${path}.points[${index}]`,errors); const x=number(point.x,`${path}.points[${index}].x`,errors),y=number(point.y,`${path}.points[${index}].y`,errors); if(x!==null&&y!==null)points.push({x,y}); });
      return points.length===raw.points.length?{type:"polygon",points,...paint()}:null;
    }
    case "path": {
      exact(raw,["type","d","fill","stroke","strokeWidth","opacity"],path,errors);
      const commands=typeof raw.d==="string"?parseFacePath(raw.d):null;
      const badNumber=commands?.some((item)=>item.values.some((value)=>Math.abs(value)>MAX_NUMBER))??false;
      const badArc=commands?.some((item)=>item.command==="A"&&(item.values[0]!<0||item.values[1]!<0||![0,1].includes(item.values[3]!)||![0,1].includes(item.values[4]!)))??false;
      if(typeof raw.d!=="string"||raw.d.length<1||raw.d.length>MAX_PATH_LENGTH||commands===null||badNumber||badArc){error(errors,`${path}.d`,"format",`path must use bounded M/L/Q/C/A/Z numeric commands and be at most ${MAX_PATH_LENGTH} characters`);return null;}
      return {type:"path",d:raw.d,...paint()};
    }
    case "line": {
      exact(raw,["type","x1","y1","x2","y2","stroke","strokeWidth","opacity"],path,errors);
      const x1=n("x1"),y1=n("y1"),x2=n("x2"),y2=n("y2"); return x1===null||y1===null||x2===null||y2===null?null:{type:"line",x1,y1,x2,y2,...paint()};
    }
    case "text": {
      exact(raw,["type","x","y","text","font","size","weight","align","rotation","fill","stroke","opacity"],path,errors);
      const x=n("x"),y=n("y"),size=n("size",1,1000),rotation=raw.rotation===undefined?undefined:n("rotation",-3600,3600);
      if(typeof raw.text!=="string"||Array.from(raw.text).length>MAX_TEXT_LENGTH||CONTROL.test(raw.text))error(errors,`${path}.text`,"limit",`text must be plain text of at most ${MAX_TEXT_LENGTH} characters`);
      if(!member(FACE_FONTS,raw.font))error(errors,`${path}.font`,"format",`font must be one of ${FACE_FONTS.join(", ")}`);
      if(raw.weight!==undefined&&![400,600,700,800].includes(raw.weight as number))error(errors,`${path}.weight`,"format","weight must be 400, 600, 700, or 800");
      if(raw.align!==undefined&&!member(["left","center","right"] as const,raw.align))error(errors,`${path}.align`,"format","align must be left, center, or right");
      if(x===null||y===null||size===null||rotation===null||typeof raw.text!=="string"||!member(FACE_FONTS,raw.font))return null;
      return {type:"text",x,y,text:raw.text,font:raw.font,size,...(raw.weight===undefined?{}:{weight:raw.weight as 400|600|700|800}),...(raw.align===undefined?{}:{align:raw.align as "left"|"center"|"right"}),...(rotation===undefined?{}:{rotation}),...paint()};
    }
    case "icon": {
      exact(raw,["type","name","x","y","size","rotation","fill","stroke","strokeWidth","opacity"],path,errors);
      const x=n("x"),y=n("y"),size=n("size",1,MAX_NUMBER),rotation=raw.rotation===undefined?undefined:n("rotation",-3600,3600);
      if(!member(FACE_ICONS,raw.name))error(errors,`${path}.name`,"format","unknown built-in icon");
      return x===null||y===null||size===null||rotation===null||!member(FACE_ICONS,raw.name)?null:{type:"icon",name:raw.name,x,y,size,...(rotation===undefined?{}:{rotation}),...paint()};
    }
    case "group": {
      exact(raw,["type","translate","rotate","scale","opacity","elements"],path,errors);
      if(!Array.isArray(raw.elements)){error(errors,`${path}.elements`,"type","group elements must be an array");return null;}
      const result: Extract<FaceElement,{type:"group"}>={type:"group",elements:validateElements(raw.elements,`${path}.elements`,errors,increment)??[]};
      if(raw.translate!==undefined){const pair=vector(raw.translate,`${path}.translate`,errors);if(pair!==null)result.translate=pair;}
      if(raw.scale!==undefined){const pair=vector(raw.scale,`${path}.scale`,errors,-100,100);if(pair!==null&&pair.x!==0&&pair.y!==0)result.scale=pair;else if(pair!==null)error(errors,`${path}.scale`,"range","scale cannot be zero");}
      if(raw.rotate!==undefined){const value=number(raw.rotate,`${path}.rotate`,errors,-3600,3600);if(value!==null)result.rotate=value;}
      if(raw.opacity!==undefined){const value=number(raw.opacity,`${path}.opacity`,errors,0,1);if(value!==null)result.opacity=value;}
      return result;
    }
    default: error(errors,`${path}.type`,"format","unknown element type"); return null;
  }
}

function fill(raw: unknown,path:string,errors:FaceValidationError[]):FaceFill|null{
  if(typeof raw==="string")return color(raw,path,errors);
  if(!record(raw)){error(errors,path,"type","fill must be a hex color or linear gradient");return null;}
  exact(raw,["type","x1","y1","x2","y2","stops"],path,errors);
  if(raw.type!=="linear-gradient"){error(errors,`${path}.type`,"format","gradient type must be linear-gradient");return null;}
  const x1=number(raw.x1,`${path}.x1`,errors),y1=number(raw.y1,`${path}.y1`,errors),x2=number(raw.x2,`${path}.x2`,errors),y2=number(raw.y2,`${path}.y2`,errors);
  if(!Array.isArray(raw.stops)||raw.stops.length<2||raw.stops.length>16){error(errors,`${path}.stops`,"limit","gradient must contain 2 to 16 stops");return null;}
  const stops:Array<{offset:number;color:`#${string}`}>=[];let previous=-1;
  raw.stops.forEach((stop,index)=>{if(!record(stop)){error(errors,`${path}.stops[${index}]`,"type","stop must be an object");return;}exact(stop,["offset","color"],`${path}.stops[${index}]`,errors);const offset=number(stop.offset,`${path}.stops[${index}].offset`,errors,0,1),value=color(stop.color,`${path}.stops[${index}].color`,errors);if(offset!==null&&offset<previous)error(errors,`${path}.stops[${index}].offset`,"range","gradient offsets must be nondecreasing");if(offset!==null)previous=offset;if(offset!==null&&value!==null)stops.push({offset,color:value});});
  return x1===null||y1===null||x2===null||y2===null||stops.length!==raw.stops.length?null:{type:"linear-gradient",x1,y1,x2,y2,stops};
}

function vector(raw:unknown,path:string,errors:FaceValidationError[],min=-MAX_NUMBER,max=MAX_NUMBER):{x:number;y:number}|null{if(!record(raw)){error(errors,path,"type","value must be an {x,y} object");return null;}exact(raw,["x","y"],path,errors);const x=number(raw.x,`${path}.x`,errors,min,max),y=number(raw.y,`${path}.y`,errors,min,max);return x===null||y===null?null:{x,y};}
function number(raw:unknown,path:string,errors:FaceValidationError[],min=-MAX_NUMBER,max=MAX_NUMBER):number|null{if(typeof raw!=="number"||!Number.isFinite(raw)){error(errors,path,"type","value must be a finite number");return null;}if(raw<min||raw>max){error(errors,path,"range",`value must be from ${min} to ${max}`);return null;}return raw;}
function color(raw:unknown,path:string,errors:FaceValidationError[]):`#${string}`|null{if(typeof raw!=="string"||!COLOR.test(raw)){error(errors,path,"format","color must be #RRGGBB");return null;}return raw.toLowerCase() as `#${string}`;}
function exact(raw:ObjectValue,keys:readonly string[],path:string,errors:FaceValidationError[]):void{for(const key of Object.keys(raw))if(!keys.includes(key))error(errors,`${path}.${key}`,"unknown_key",`unknown key ${key}`);for(const key of keys)if(key!=="r"&&key!=="fill"&&key!=="stroke"&&key!=="strokeWidth"&&key!=="opacity"&&key!=="weight"&&key!=="align"&&key!=="rotation"&&key!=="translate"&&key!=="rotate"&&key!=="scale"&&!Object.prototype.hasOwnProperty.call(raw,key))error(errors,`${path}.${key}`,"type",`missing ${key}`);}
function error(errors:FaceValidationError[],path:string,code:FaceValidationError["code"],message:string):void{if(errors.length<100)errors.push({path,code,message});}
function failed(errors:FaceValidationError[],path:string,code:FaceValidationError["code"],message:string):FaceValidationResult{error(errors,path,code,message);return{ok:false,errors};}
function record(value:unknown):value is ObjectValue{return typeof value==="object"&&value!==null&&!Array.isArray(value);}
function member<const T extends readonly string[]>(values:T,value:unknown):value is T[number]{return typeof value==="string"&&(values as readonly string[]).includes(value);}
