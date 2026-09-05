import { useEffect, useRef, useState } from 'react';
import { RichContent } from './RichContent';

type Props={value:string;onChange:(value:string)=>void;placeholder?:string;className?:string};
type Command='bold'|'italic'|'underline'|'strikeThrough'|'formatBlock'|'insertUnorderedList'|'insertOrderedList'|'superscript'|'subscript'|'undo'|'redo'|'justifyLeft'|'justifyCenter'|'justifyRight'|'justifyFull'|'indent'|'outdent'|'removeFormat';
type Bubble={x:number;y:number};

const primary:Array<[string,Command,string,string?]>=[
 ['B','bold','Đậm'],['I','italic','Nghiêng'],['U','underline','Gạch chân'],['S̶','strikeThrough','Gạch ngang'],
 ['H1','formatBlock','Tiêu đề 1','h1'],['H2','formatBlock','Tiêu đề 2','h2'],['H3','formatBlock','Tiêu đề 3','h3'],
 ['•','insertUnorderedList','Danh sách'],['1.','insertOrderedList','Danh sách số'],['x²','superscript','Chỉ số trên'],['x₂','subscript','Chỉ số dưới'],
 ['↶','undo','Hoàn tác'],['↷','redo','Làm lại']
];
const more:Array<[string,Command,string]>=[
 ['⇤','justifyLeft','Căn trái'],['≡','justifyCenter','Căn giữa'],['⇥','justifyRight','Căn phải'],['▤','justifyFull','Căn đều'],
 ['→','indent','Thụt vào'],['←','outdent','Bỏ thụt'],['Tx','removeFormat','Xóa định dạng']
];

// One-click formula snippets. Wrapped in $...$ so MathText/KaTeX renders them;
// \ce{} is chemistry via mhchem. Keep labels WYSIWYG-ish so non-LaTeX users
// can still build Word-like formulas.
const FORMULAS:Array<[string,string,string]>=[
 ['a/b','$\\frac{a}{b}$','Phân số — thay a, b'],
 ['√','$\\sqrt{x}$','Căn bậc hai'],
 ['x²','$x^2$','Luỹ thừa'],
 ['x₂','$x_2$','Chỉ số dưới'],
 ['±','$\\pm$','Cộng hoặc trừ'],
 ['×','$\\times$','Nhân'],
 ['÷','$\\div$','Chia'],
 ['≤','$\\le$','Nhỏ hơn hoặc bằng'],
 ['≥','$\\ge$','Lớn hơn hoặc bằng'],
 ['≠','$\\ne$','Khác'],
 ['→','$\\rightarrow$','Mũi tên'],
 ['⇌','$\\rightleftharpoons$','Cân bằng hoá học'],
 ['α','$\\alpha$','Alpha'],
 ['β','$\\beta$','Beta'],
 ['π','$\\pi$','Pi'],
 ['∞','$\\infty$','Vô cực'],
 ['°','$^{\\circ}$','Độ'],
 ['∑','$\\sum_{i=1}^{n}$','Tổng'],
 ['∫','$\\int_0^1$','Tích phân'],
 ['∈','$\\in$','Thuộc'],
 ['⊂','$\\subset$','Tập con'],
 ['∪','$\\cup$','Hợp'],
 ['∩','$\\cap$','Giao'],
 ['∅','$\\emptyset$','Tập rỗng'],
 ['∇','$\\nabla$','Nabla (vectơ gradient)'],
 ['H₂O','$\\ce{H2O}$','Công thức hoá học — viết thẳng như H2SO4, Na+'],
 ['Δ','$\\Delta$','Delta (biến thiên)'],
 ['θ','$\\theta$','Theta'],
 ['λ','$\\lambda$','Lambda'],
 ['μ','$\\mu$','Muy'],
 ['Ω','$\\Omega$','Omega']
];

export function RichTextEditor({value,onChange,placeholder,className=''}:Props){
 const ref=useRef<HTMLDivElement>(null); const [bubble,setBubble]=useState<Bubble|null>(null); const [expanded,setExpanded]=useState(false); const [showMath,setShowMath]=useState(false);
 function serializedContents(node:HTMLElement){return Array.from(node.childNodes).map(child=>new XMLSerializer().serializeToString(child)).join('');}
 function safeFragment(html:string){if(typeof DOMParser==='undefined')return document.createTextNode(html);const doc=new DOMParser().parseFromString(html,'text/html');const allowed=new Set(['B','STRONG','I','EM','U','S','STRIKE','H1','H2','H3','P','DIV','UL','OL','LI','SUP','SUB','BR','BLOCKQUOTE','TABLE','THEAD','TBODY','TR','TH','TD','A','IMG','SPAN']);for(const el of Array.from(doc.body.querySelectorAll('*'))){if(!allowed.has(el.tagName)){el.replaceWith(...Array.from(el.childNodes));continue;}for(const attr of Array.from(el.attributes)){const name=attr.name.toLowerCase();if(name.startsWith('on'))el.removeAttribute(attr.name);if(name==='href'&&!/^(https?:|mailto:)/i.test(attr.value))el.removeAttribute(attr.name);if(name==='src'&&!/^(https?:|data:image\/)/i.test(attr.value))el.removeAttribute(attr.name);if(name==='style'&&/url\s*\(|expression\s*\(|javascript:/i.test(attr.value))el.removeAttribute(attr.name);}}const fragment=document.createDocumentFragment();for(const child of Array.from(doc.body.childNodes))fragment.appendChild(child);return fragment;}
 useEffect(()=>{if(ref.current){const current=serializedContents(ref.current);if(current!==value){ref.current.replaceChildren(safeFragment(value));}}},[value]);
 const update=()=>onChange(ref.current?serializedContents(ref.current):'');
 const hide=()=>{setBubble(null);setExpanded(false)};
 const showForSelection=()=>{const sel=window.getSelection();if(!sel||sel.rangeCount===0||sel.isCollapsed){hide();return;}const range=sel.getRangeAt(0);if(!ref.current?.contains(range.commonAncestorContainer)){hide();return;}const rect=range.getBoundingClientRect();if(!rect.width&&!rect.height){hide();return;}setBubble({x:Math.min(window.innerWidth-12,Math.max(12,rect.left+rect.width/2)),y:Math.max(12,rect.top-8)});};
 const run=(cmd:Command,arg?:string)=>{document.execCommand(cmd,false,arg);ref.current?.focus();update();};
 const insert=(text:string)=>{ref.current?.focus();document.execCommand('insertText',false,text);update();};
 const insertLink=()=>{const url=window.prompt('Dán liên kết');if(url){document.execCommand('createLink',false,url);update();}};
 const insertImage=()=>{const url=window.prompt('Dán URL ảnh');if(url){document.execCommand('insertImage',false,url);update();}};
 const insertTable=()=>{const rows=Math.max(1,Math.min(10,Number(window.prompt('Số hàng','2'))||2));const cols=Math.max(1,Math.min(8,Number(window.prompt('Số cột','2'))||2));const html=`<table><tbody>${Array.from({length:rows},()=>`<tr>${Array.from({length:cols},()=>'<td><br></td>').join('')}</tr>`).join('')}</tbody></table><p><br></p>`;document.execCommand('insertHTML',false,html);update();};
 const color=(back=false)=>{const value=window.prompt(back?'Màu nền (vd #fff59d)':'Màu chữ (vd #dc2626)');if(value){document.execCommand(back?'backColor':'foreColor',false,value);update();}};
 const fontSize=()=>{const n=window.prompt('Cỡ chữ 1–7','3');if(n&&/^[1-7]$/.test(n)){document.execCommand('fontSize',false,n);update();}};
 useEffect(()=>{const onSelection=()=>showForSelection();const onScroll=()=>hide();document.addEventListener('selectionchange',onSelection);window.addEventListener('scroll',onScroll,true);window.addEventListener('resize',onScroll);return()=>{document.removeEventListener('selectionchange',onSelection);window.removeEventListener('scroll',onScroll,true);window.removeEventListener('resize',onScroll);};},[]);
 const button=(label:string,title:string,onMouseDown:()=>void,key=title)=><button key={key} type="button" title={title} className="rounded-lg min-w-8 px-2 py-1.5 text-sm font-medium hover:bg-[var(--surface-2)] active:bg-[var(--line-strong)]" onMouseDown={e=>{e.preventDefault();onMouseDown();}}>{label}</button>;
 const hasMath=/[$\\]|\\ce\{/.test(value);
 return <div className={`relative rounded-xl border bg-[var(--surface)] overflow-visible ${className}`}>
   <div className="formula-bar flex flex-wrap items-center gap-0.5 px-2 py-1 border-b border-[var(--line)]">
     <span className="text-[11px] font-semibold muted px-1 select-none">Công thức</span>
     {FORMULAS.slice(0,12).map(([label,snippet,title])=><button key={title} type="button" title={title} className="formula-chip" onMouseDown={e=>{e.preventDefault();insert(snippet);}}>{label}</button>)}
     <button type="button" className="formula-chip" title="Xem thêm ký hiệu toán, lý, hoá" onMouseDown={e=>{e.preventDefault();setShowMath(x=>!x);}}>{showMath?'Thu gọn ký hiệu ▴':'Thêm ký hiệu ▾'}</button>
   </div>
   {showMath&&<div className="formula-bar flex flex-wrap items-center gap-0.5 px-2 py-1 border-b border-[var(--line)] bg-[var(--surface-2)]">
     {FORMULAS.slice(12).map(([label,snippet,title])=><button key={title} type="button" title={title} className="formula-chip" onMouseDown={e=>{e.preventDefault();insert(snippet);}}>{label}</button>)}
   </div>}
   <div ref={ref} contentEditable suppressContentEditableWarning data-placeholder={placeholder} className="rich-editor min-h-32 p-4 outline-none empty:before:content-[attr(data-placeholder)] empty:before:muted prose prose-sm max-w-none" onInput={update} onBlur={()=>window.setTimeout(hide,180)} onPaste={e=>{e.preventDefault();document.execCommand('insertText',false,e.clipboardData.getData('text/plain'));update();}}/>
   {hasMath&&<div className="preview-strip">
     <span className="text-[11px] font-semibold muted">Xem trước hiển thị:</span>
     <RichContent html={value}/>
   </div>}
   {bubble&&<div className="fixed z-50 -translate-x-1/2 -translate-y-full rounded-xl border bg-[var(--surface)] shadow-2xl p-1.5 flex max-w-[calc(100vw-16px)] flex-wrap items-center gap-0.5" style={{left:bubble.x,top:bubble.y}} onMouseDown={e=>e.preventDefault()}>{primary.map(([label,cmd,title,arg])=>button(label,title,()=>run(cmd,arg),`${cmd}:${arg??''}`))}{button('🔗','Chèn liên kết',insertLink)}{button('🖼','Chèn ảnh từ URL',insertImage)}{button('▦','Chèn bảng',insertTable)}{button('A','Màu chữ',()=>color(false))}{button('▰','Highlight',()=>color(true))}{button('T','Cỡ chữ',fontSize)}<span className="h-5 w-px bg-[var(--line-strong)] mx-1"/>{button(expanded?'−':'⋯','Thêm công cụ',()=>setExpanded(x=>!x),'more')}{expanded&&more.map(([label,cmd,title])=>button(label,title,()=>run(cmd),cmd))}</div>}
 </div>;
}
