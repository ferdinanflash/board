/* spreadsheet-engine.js — lightweight browser/Node spreadsheet formula engine.
 * Supports arithmetic, concatenation, comparisons, cell/range references, percentages,
 * common aggregate/logical/text functions, cell models, formatting and SheetJS XLSX I/O.
 */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SheetEngine=factory();})(typeof self!=='undefined'?self:this,function(){
'use strict';
const MAX_ROWS=1000,MAX_COLS=78;
const ERR={'#DIV/0!':'#DIV/0!','#VALUE!':'#VALUE!','#REF!':'#REF!','#NAME?':'#NAME?','#NUM!':'#NUM!','#N/A':'#N/A','#CIRC!':'#CIRC!'};
class FormulaError extends Error{constructor(code){super(code);this.code=code;}}
const colToIdx=s=>{let n=0;for(const ch of s.toUpperCase())n=n*26+ch.charCodeAt(0)-64;return n-1;};
const idxToCol=i=>{let s='';for(i++;i>0;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s;};
const key=(c,r)=>idxToCol(c)+(r+1);
function parseKey(s){const m=/^([A-Z]+)(\d+)$/i.exec(s);return m?{c:colToIdx(m[1]),r:+m[2]-1}:null;}
const numRe=/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
function toNum(v){if(v instanceof FormulaError)throw v;if(v==null||v==='')return 0;if(typeof v==='number')return Number.isFinite(v)?v:ERRVAL('#NUM!');if(typeof v==='boolean')return +v;const s=String(v).trim().replace(/,/g,'');if(numRe.test(s))return +s;if(/^[-+]?(?:\d+\.?\d*|\.\d+)%$/.test(s))return parseFloat(s)/100;throw new FormulaError('#VALUE!');}
function ERRVAL(code){throw new FormulaError(code);}
function text(v){if(v==null)return '';if(v instanceof FormulaError)throw v;if(typeof v==='boolean')return v?'TRUE':'FALSE';return String(v);}
function tokenize(src){const out=[];let i=0;while(i<src.length){const s=src.slice(i);let m;if(/^\s+/.test(s)){i+=s.match(/^\s+/)[0].length;continue;}if(s[0]==='"'){let j=1,v='';while(j<s.length){if(s[j]==='"'){if(s[j+1]==='"'){v+='"';j+=2;continue;}break;}v+=s[j++];}if(j>=s.length)throw Error('Unterminated string');out.push({t:'str',v});i+=j+1;continue;}if((m=/^#(?:DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|CIRC!)/i.exec(s))){out.push({t:'err',v:m[0].toUpperCase()});i+=m[0].length;continue;}if((m=/^(\$?[A-Z]{1,3}\$?\d+:\$?[A-Z]{1,3}\$?\d+)/i.exec(s))){out.push({t:'range',v:m[0]});i+=m[0].length;continue;}if((m=/^(\$?[A-Z]{1,3}:\$?[A-Z]{1,3})/i.exec(s))){out.push({t:'colrange',v:m[0]});i+=m[0].length;continue;}if((m=/^(\$?[A-Z]{1,3}\$?\d+)/i.exec(s))){out.push({t:'ref',v:m[0]});i+=m[0].length;continue;}if((m=/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(s))){out.push({t:'num',v:+m[0]});i+=m[0].length;continue;}if((m=/^[A-Z_][A-Z0-9_.]*/i.exec(s))){const name=m[0].toUpperCase();out.push({t:/^\s*\(/.test(s.slice(m[0].length))? 'fn':(['TRUE','FALSE'].includes(name)?'bool':'name'),v:name});i+=m[0].length;continue;}if((m=/^(<=|>=|<>|[()+\-*/^&=<>%,;])/.exec(s))){out.push({t:'op',v:m[0]});i+=m[0].length;continue;}throw Error('Unexpected character "'+s[0]+'"');}return out;}
function parseFormula(src){const ts=tokenize(src.replace(/^=/,''));let p=0;const peek=()=>ts[p],eat=v=>{if(!peek()||peek().v!==v)throw Error('Expected '+v);p++;};
function primary(){const t=ts[p++];if(!t)throw Error('Unexpected end');if(t.t==='num'||t.t==='str'||t.t==='bool'||t.t==='err')return{t:t.t,v:t.v};if(t.t==='ref'||t.t==='range'||t.t==='colrange')return{t:t.t,v:t.v};if(t.t==='name')return{t:'name',v:t.v};if(t.t==='fn'){eat('(');const a=[];if(peek()?.v!==')'){while(true){if([',',';',')'].includes(peek()?.v))a.push({t:'blank'});else a.push(compare());if(peek()?.v===','||peek()?.v===';'){p++;continue;}break;}}eat(')');return{t:'call',v:t.v,a};}if(t.v==='('){const n=compare();eat(')');return n;}throw Error('Unexpected token '+t.v);}
function postfix(){let n=primary();while(peek()?.v==='%'){p++;n={t:'pct',a:n};}return n;}function unary(){if(['+','-'].includes(peek()?.v)){const op=ts[p++].v;return{t:'un',v:op,a:unary()};}return postfix();}function power(){let n=unary();while(peek()?.v==='^'){p++;n={t:'bin',v:'^',a:n,b:unary()};}return n;}function mul(){let n=power();while(['*','/'].includes(peek()?.v)){const op=ts[p++].v;n={t:'bin',v:op,a:n,b:power()};}return n;}function add(){let n=mul();while(['+','-'].includes(peek()?.v)){const op=ts[p++].v;n={t:'bin',v:op,a:n,b:mul()};}return n;}function concat(){let n=add();while(peek()?.v==='&'){p++;n={t:'bin',v:'&',a:n,b:add()};}return n;}function compare(){let n=concat();while(['=','<>','<','>','<=','>='].includes(peek()?.v)){const op=ts[p++].v;n={t:'bin',v:op,a:n,b:concat()};}return n;}
const ast=compare();if(p<ts.length)throw Error('Unexpected token '+ts[p].v);return ast;}
function parseRef(s){const m=/^(\$?)([A-Z]+)(\$?)(\d+)$/i.exec(s);if(!m)return null;return{c:colToIdx(m[2]),r:+m[4]-1};}
function parseRange(s){const parts=s.split(':');if(parts.length!==2)return null;const a=parseRef(parts[0].replace(/\$/g,'')),b=parseRef(parts[1].replace(/\$/g,''));if(a&&b)return{c1:Math.min(a.c,b.c),r1:Math.min(a.r,b.r),c2:Math.max(a.c,b.c),r2:Math.max(a.r,b.r)};const ca=parts[0].replace(/\$/g,''),cb=parts[1].replace(/\$/g,'');if(/^[A-Z]+$/i.test(ca)&&/^[A-Z]+$/i.test(cb))return{c1:Math.min(colToIdx(ca),colToIdx(cb)),r1:0,c2:Math.max(colToIdx(ca),colToIdx(cb)),r2:MAX_ROWS-1};return null;}
class Model{constructor(json){this.cells={};this.cols={};this.cache=new Map();this.visiting=new Set();if(json)this.load(json);}load(json){this.cells={...(json.cells||{})};this.cols={...(json.cols||{})};this.invalidate();}toJSON(){return{v:1,cells:{...this.cells},cols:{...this.cols}};}invalidate(){this.cache.clear();this.visiting.clear();}setCell(addr,value){const k=typeof addr==='string'?addr:key(addr.c,addr.r);const patch=typeof value==='object'&&value!==null?{...value}:typeof value==='string'&&value.startsWith('=')?{f:value.slice(1)}:{v:value};if(patch.f!==undefined){delete patch.v;patch.f=patch.f.trim();}if(patch.v===''||patch.v==null&&patch.f===undefined)delete this.cells[k];else this.cells[k]=patch;this.invalidate();}getCell(addr){return this.cells[typeof addr==='string'?addr:key(addr.c,addr.r)]||null;}getValue(c,r){const k=typeof c==='string'?c:key(c,r);const cell=this.cells[k];if(!cell)return null;if(cell.f===undefined)return cell.v??null;if(this.cache.has(k))return this.cache.get(k);if(this.visiting.has(k))return new FormulaError('#CIRC!');this.visiting.add(k);let val;try{val=this.evaluate(cell.f);if(val instanceof FormulaError){}else if(typeof val==='number'&&!Number.isFinite(val))val=new FormulaError('#NUM!');}catch(e){val=e instanceof FormulaError?e:new FormulaError(e.message==='#REF!'?'#REF!':e.message==='#DIV/0!'?'#DIV/0!':'#VALUE!');}this.visiting.delete(k);this.cache.set(k,val);return val;}
rangeCells(rg){const out=[];for(const [k] of Object.entries(this.cells)){const q=parseRef(k);if(q&&q.c>=rg.c1&&q.c<=rg.c2&&q.r>=rg.r1&&q.r<=rg.r2)out.push({c:q.c,r:q.r,v:this.getValue(q.c,q.r)});}return out.sort((a,b)=>a.r-b.r||a.c-b.c);}
evaluate(formula) {
 const ast = typeof formula === 'string' ? parseFormula(formula) : formula;
 const scalar = n => { const v = ev(n); if (Array.isArray(v)) throw new FormulaError('#VALUE!'); return v; };
 const rangeVals = rg => { const out=[]; for(let r=rg.r1;r<=Math.min(rg.r2,MAX_ROWS-1);r++) for(let c=rg.c1;c<=Math.min(rg.c2,MAX_COLS-1);c++) out.push(this.getValue(c,r)); return out; };

 // Excel-style criteria: 5, "ZXC", ">100", "<>CAT", "=x", wildcards * and ?; text matches case-insensitively.
 const critTest = crit => {
  let op='=', val=crit;
  if(typeof crit==='string'){ const m=/^(<=|>=|<>|=|<|>)(.*)$/.exec(crit); if(m){ op=m[1]; val=m[2]; } }
  const numVal=typeof val==='number'?val:(typeof val==='string'&&numRe.test(val.trim())?+val:null);
  const rx=(numVal===null&&typeof val==='string'&&/[*?]/.test(val))?new RegExp('^'+val.replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\?/g,'.')+'$','i'):null;
  return cell=>{
   if(cell instanceof FormulaError) return false;
   let eq;
   if(numVal!==null){ const cn=typeof cell==='number'?cell:(typeof cell==='string'&&numRe.test(cell.trim())?+cell:null); if(cn===null) return op==='<>'; switch(op){case'=':return cn===numVal;case'<>':return cn!==numVal;case'<':return cn<numVal;case'>':return cn>numVal;case'<=':return cn<=numVal;case'>=':return cn>=numVal;} }
   const cs=cell==null?'':String(cell); eq=rx?rx.test(cs):cs.toLowerCase()===String(val??'').toLowerCase();
   if(op==='=') return eq; if(op==='<>') return !eq;
   const a=cs.toLowerCase(), b=String(val).toLowerCase(); return op==='<'?a<b:op==='>'?a>b:op==='<='?a<=b:a>=b;
  };
 };
 const ev = n => {
  if(!n) return null;
  switch(n.t) {
   case 'num': case 'str': return n.v;
   case 'bool': return n.v === 'TRUE';
   case 'err': throw new FormulaError(n.v);
   case 'blank': return null;
   case 'name': throw new FormulaError('#NAME?');
   case 'ref': { const q=parseRef(n.v.replace(/\$/g,'')); if(!q) throw new FormulaError('#REF!'); return this.getValue(q.c,q.r); }
   case 'range': case 'colrange': { const rg=parseRange(n.v); if(!rg) throw new FormulaError('#REF!'); return rangeVals(rg); }
   case 'pct': return toNum(scalar(n.a))/100;
   case 'un': return n.v==='-' ? -toNum(scalar(n.a)) : toNum(scalar(n.a));
   case 'bin': {
    const a=scalar(n.a), b=scalar(n.b);
    switch(n.v) {
     case '+': return toNum(a)+toNum(b); case '-': return toNum(a)-toNum(b);
     case '*': return toNum(a)*toNum(b); case '/': if(toNum(b)===0) throw new FormulaError('#DIV/0!'); return toNum(a)/toNum(b);
     case '^': return Math.pow(toNum(a),toNum(b)); case '&': return text(a)+text(b);
     case '=': return a===b; case '<>': return a!==b; case '<': return a<b; case '>': return a>b; case '<=': return a<=b; case '>=': return a>=b;
    }
    throw new FormulaError('#VALUE!');
   }
   case 'call': {
    // Preserve ranges as arrays; scalar references are evaluated as scalar values.
    const args=n.a.map(x => x.t==='range'||x.t==='colrange' ? ev(x) : x.t==='ref' ? ev(x) : scalar(x));
    const flat=args.flat(Infinity).filter(x=>x!==null&&x!==undefined&&x!=='');
    const nums=flat.map(x=>typeof x==='number'?x:(typeof x==='string'&&numRe.test(x.trim())?+x:null)).filter(x=>x!==null);
    switch(n.v) {
     case 'SUM': return nums.reduce((a,b)=>a+b,0);
     case 'AVERAGE': if(!nums.length) throw new FormulaError('#DIV/0!'); return nums.reduce((a,b)=>a+b,0)/nums.length;
     case 'MIN': return nums.length?Math.min(...nums):0; case 'MAX': return nums.length?Math.max(...nums):0;
     case 'COUNT': return nums.length; case 'COUNTA': return flat.length; case 'COUNTBLANK': return args.flat(Infinity).filter(x=>x==null||x==='').length;
     case 'PRODUCT': return nums.length?nums.reduce((a,b)=>a*b,1):0;
     case 'ABS': return Math.abs(toNum(args[0])); case 'INT': return Math.floor(toNum(args[0]));
     case 'SQRT': if(toNum(args[0])<0) throw new FormulaError('#NUM!'); return Math.sqrt(toNum(args[0]));
     case 'POWER': return Math.pow(toNum(args[0]),toNum(args[1]));
     case 'MOD': if(!toNum(args[1])) throw new FormulaError('#DIV/0!'); return ((toNum(args[0])%toNum(args[1]))+toNum(args[1]))%toNum(args[1]);
     case 'ROUND': return Number(toNum(args[0]).toFixed(Math.max(-100,Math.min(100,Math.trunc(toNum(args[1]??0))))));
     case 'IF': return (args[0]===true||toNum(args[0])!==0) ? args[1] : (args.length>2?args[2]:false);
     case 'IFERROR': return args[0] instanceof FormulaError ? (args[1]??'') : args[0];
     case 'AND': return flat.every(Boolean); case 'OR': return flat.some(Boolean); case 'NOT': return !args[0];
     case 'CONCAT': case 'CONCATENATE': return args.flat(Infinity).map(text).join('');
     case 'LEN': return text(args[0]).length; case 'UPPER': return text(args[0]).toUpperCase(); case 'LOWER': return text(args[0]).toLowerCase();
     case 'TRIM': return text(args[0]).trim().replace(/\s+/g,' '); case 'LEFT': return text(args[0]).slice(0,Math.max(0,toNum(args[1]??1)));
     case 'RIGHT': { const count=Math.max(0,toNum(args[1]??1)); return count===0?'':text(args[0]).slice(-count); }
     case 'ROW': { const q=n.a[0]&&n.a[0].v?parseRef(n.a[0].v.replace(/\$/g,'')):null; return q?q.r+1:1; }
     case 'COLUMN': { const q=n.a[0]&&n.a[0].v?parseRef(n.a[0].v.replace(/\$/g,'')):null; return q?q.c+1:1; }
     // ---- conditional / lookup functions (SUMIF family, as in Excel) ----
     case 'SUMIF': case 'AVERAGEIF': case 'COUNTIF': {
      const rng=args[0]; if(!Array.isArray(rng)||args.length<2) throw new FormulaError('#VALUE!');
      const test=critTest(args[1]), tgt=args[2]===undefined?rng:(Array.isArray(args[2])?args[2]:[args[2]]);
      let sum=0,cnt=0; rng.forEach((v,i)=>{ if(test(v)){ cnt++; const t=tgt[i]; if(typeof t==='number') sum+=t; else if(typeof t==='string'&&numRe.test(t.trim())) sum+=+t; } });
      if(n.v==='COUNTIF') return cnt;
      if(n.v==='AVERAGEIF'){ if(!cnt) throw new FormulaError('#DIV/0!'); return sum/cnt; }
      return sum;
     }
     case 'SUMIFS': case 'COUNTIFS': case 'AVERAGEIFS': {
      const isSum=n.v!=='COUNTIFS', sumRng=isSum?args[0]:null, pairs=[]; const start=isSum?1:0;
      if(isSum&&!Array.isArray(sumRng)) throw new FormulaError('#VALUE!');
      if((args.length-start)<2||(args.length-start)%2) throw new FormulaError('#VALUE!');
      for(let i=start;i<args.length;i+=2){ if(!Array.isArray(args[i])) throw new FormulaError('#VALUE!'); pairs.push([args[i],critTest(args[i+1])]); }
      const len=pairs[0][0].length; if(pairs.some(([r])=>r.length!==len)||(isSum&&sumRng.length!==len)) throw new FormulaError('#VALUE!');
      let sum=0,cnt=0; for(let i=0;i<len;i++){ if(pairs.every(([r,t])=>t(r[i]))){ cnt++; if(isSum){ const v=sumRng[i]; if(typeof v==='number') sum+=v; else if(typeof v==='string'&&numRe.test(v.trim())) sum+=+v; } } }
      if(n.v==='COUNTIFS') return cnt; if(n.v==='AVERAGEIFS'){ if(!cnt) throw new FormulaError('#DIV/0!'); return sum/cnt; } return sum;
     }
     case 'SUMPRODUCT': { const arrs=args.map(a=>Array.isArray(a)?a:[a]); const len=arrs[0].length; if(arrs.some(a=>a.length!==len)) throw new FormulaError('#VALUE!'); let t=0; for(let i=0;i<len;i++){ let m=1; for(const a of arrs){ const v=a[i]; m*=typeof v==='number'?v:(typeof v==='string'&&numRe.test(v.trim())?+v:0); } t+=m; } return t; }
     case 'LARGE': case 'SMALL': { const k=Math.trunc(toNum(args[1])); const arr=(Array.isArray(args[0])?args[0]:[args[0]]).filter(x=>typeof x==='number').sort((a,b)=>n.v==='LARGE'?b-a:a-b); if(k<1||k>arr.length) throw new FormulaError('#NUM!'); return arr[k-1]; }
     case 'MEDIAN': { if(!nums.length) throw new FormulaError('#NUM!'); const a=nums.slice().sort((x,y)=>x-y), m=a.length>>1; return a.length%2?a[m]:(a[m-1]+a[m])/2; }
     case 'RANK': { const v=toNum(args[0]), arr=(Array.isArray(args[1])?args[1]:[]).filter(x=>typeof x==='number'); if(!arr.includes(v)) throw new FormulaError('#N/A'); const asc=args[2]!==undefined&&toNum(args[2])!==0; return 1+arr.filter(x=>asc?x<v:x>v).length; }
     case 'ROUNDUP': case 'ROUNDDOWN': { const d=Math.trunc(toNum(args[1]??0)), f=Math.pow(10,d), x=toNum(args[0]); const r=Math.abs(x)*f; const out=(n.v==='ROUNDUP'?Math.ceil(r-1e-9):Math.floor(r+1e-9))/f; return x<0?-out:out; }
     case 'MATCH': { const arr=Array.isArray(args[1])?args[1]:[args[1]], t=args[0], mt=args[2]===undefined?1:toNum(args[2]); if(mt===0){ const i=arr.findIndex(x=>typeof x==='string'&&typeof t==='string'?x.toLowerCase()===t.toLowerCase():x===t); if(i<0) throw new FormulaError('#N/A'); return i+1; } let best=-1; arr.forEach((x,i)=>{ if(typeof x===typeof t&&(mt>0?x<=t:x>=t)) best=i; }); if(best<0) throw new FormulaError('#N/A'); return best+1; }
     default: throw new FormulaError('#NAME?');
    }
   }
   default: throw new FormulaError('#VALUE!');
  }
 };
 return ev(ast);
}
display(c,r) { const cell=this.getCell(key(c,r)); if(!cell)return ''; return formatValue(this.getValue(c,r),cell.z); }
}

function formatValue(v,z){if(v==null)return'';if(v instanceof FormulaError)return v.code;if(typeof v==='boolean')return v?'TRUE':'FALSE';if(typeof v!=='number')return String(v);switch(z){case'0':return Math.round(v).toString();case'0.00':return v.toFixed(2);case'#,##0':return Math.round(v).toLocaleString('en-US');case'#,##0.00':return v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});case'0%':return Math.round(v*100)+'%';case'0.00%':return(v*100).toFixed(2)+'%';default:return Number.isInteger(v)?String(v):String(+v.toPrecision(10));}}
function normalizeFormat(z){if(!z||z==='General')return undefined;if(/%/.test(z))return /0\.0/.test(z)?'0.00%':'0%';if(/#,##0\.0/.test(z))return'#,##0.00';if(/#,##0/.test(z))return'#,##0';if(/^0\.0+$/.test(z))return'0.00';if(z==='0')return'0';return undefined;}
function parseDelimited(text,delim){const rows=[];let row=[],s='',q=false;for(let i=0;i<text.length;i++){const ch=text[i];if(q){if(ch==='"'&&text[i+1]==='"'){s+='"';i++;}else if(ch==='"')q=false;else s+=ch;}else if(ch==='"'&&!s)q=true;else if(ch===delim){row.push(s);s='';}else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(s);rows.push(row);row=[];s='';}else s+=ch;}if(s!==''||row.length){row.push(s);rows.push(row);}return rows;}
function modelFromMatrix(rows){const m=new Model();rows.slice(0,MAX_ROWS).forEach((row,r)=>row.slice(0,MAX_COLS).forEach((v,c)=>{if(v!==''&&v!=null)m.setCell(key(c,r),typeof v==='string'&&v.startsWith('=')?{f:v.slice(1)}:{v:typeof v==='string'&&numRe.test(v.trim())?+v:v});}));return m;}
function modelFromXlsxSheet(ws,XLSX){const m=new Model();if(!ws||!ws['!ref'])return m;const rg=XLSX.utils.decode_range(ws['!ref']);for(let r=rg.s.r;r<=Math.min(rg.e.r,MAX_ROWS-1);r++)for(let c=rg.s.c;c<=Math.min(rg.e.c,MAX_COLS-1);c++){const x=ws[XLSX.utils.encode_cell({r,c})];if(!x)continue;const cell={};if(x.f)cell.f=String(x.f).replace(/^=/,'');else if(x.v!==undefined&&x.v!==null)cell.v=x.v;if(x.z){const z=normalizeFormat(x.z);if(z)cell.z=z;}if(Object.keys(cell).length)m.setCell(key(c,r),cell);}return m;}
function xlsxSheetFromModel(m,XLSX){const ws={};let maxC=0,maxR=0;for(const [addr,cell] of Object.entries(m.cells)){const p=parseRef(addr);if(!p)continue;const v=m.getValue(p.c,p.r),o={};if(v instanceof FormulaError){o.t='e';o.v=15;}else if(typeof v==='number'){o.t='n';o.v=v;}else if(typeof v==='boolean'){o.t='b';o.v=v;}else{o.t='s';o.v=text(v);}if(cell.f!==undefined)o.f=cell.f;if(cell.z)o.z=cell.z;ws[XLSX.utils.encode_cell({r:p.r,c:p.c})]=o;maxC=Math.max(maxC,p.c);maxR=Math.max(maxR,p.r);}ws['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:maxR,c:maxC}});return ws;}
function importXlsx(fileOrBuffer,XLSX){if(!XLSX)throw Error('SheetJS (XLSX) is required');const wb=XLSX.read(fileOrBuffer,{type:fileOrBuffer instanceof ArrayBuffer?'array':'array'});return wb.SheetNames.map(name=>({name,model:modelFromXlsxSheet(wb.Sheets[name],XLSX)}));}
function exportXlsx(model,XLSX,sheetName){if(!XLSX)throw Error('SheetJS (XLSX) is required');const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,xlsxSheetFromModel(model,XLSX),sheetName||'Sheet1');return wb;}
// ---- CSV export (UTF-8 with BOM so Excel on Windows reads accents/emoji/CJK correctly) ----
function csvCell(v){if(v==null)return'';if(v instanceof FormulaError)return v.code;if(typeof v==='boolean')return v?'TRUE':'FALSE';let t=typeof v==='number'?String(v):String(v);if(typeof v==='string'&&/^[=+@]/.test(t))t="'"+t;return/[",\r\n;]/.test(t)||/^\s|\s$/.test(t)?'"'+t.replace(/"/g,'""')+'"':t;}
function toCsv(rows){return rows.map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n';}
function modelToMatrix(m){let maxC=-1,maxR=-1;for(const addr of Object.keys(m.cells)){const p=parseRef(addr);if(!p)continue;maxC=Math.max(maxC,p.c);maxR=Math.max(maxR,p.r);}const rows=[];for(let r=0;r<=maxR;r++){const row=[];for(let c=0;c<=maxC;c++)row.push(m.getValue(c,r));rows.push(row);}return rows;}
function downloadCsv(filename,rows){const blob=new Blob(['﻿',toCsv(rows)],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
return{MAX_ROWS,MAX_COLS,ERR,FormulaError,colToIdx,idxToCol,key,parseKey,tokenize,parse:parseFormula,validate(f){try{parseFormula(f);return null;}catch(e){return e.message;}},Model,formatValue,normalizeFormat,parseDelimited,modelFromMatrix,modelFromXlsxSheet,xlsxSheetFromModel,importXlsx,exportXlsx,toCsv,modelToMatrix,downloadCsv};
});
