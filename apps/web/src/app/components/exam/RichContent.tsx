import React from 'react';
import { MathText } from './MathText';

const ALLOWED=new Set(['B','STRONG','I','EM','U','S','STRIKE','H1','H2','H3','P','DIV','UL','OL','LI','SUP','SUB','BR','BLOCKQUOTE','TABLE','THEAD','TBODY','TR','TH','TD','A','IMG']);
function nodeToReact(node:Node,key:string):React.ReactNode{
  if(node.nodeType===Node.TEXT_NODE)return <MathText key={key} text={node.textContent||''}/>;
  if(node.nodeType!==Node.ELEMENT_NODE)return null;
  const el=node as HTMLElement;
  const children=Array.from(el.childNodes).map((n,i)=>nodeToReact(n,`${key}-${i}`));
  if(!ALLOWED.has(el.tagName))return <React.Fragment key={key}>{children}</React.Fragment>;
  const props={key};
  switch(el.tagName){
    case'B':case'STRONG':return <strong {...props}>{children}</strong>;
    case'I':case'EM':return <em {...props}>{children}</em>;
    case'U':return <u {...props}>{children}</u>;
    case'S':case'STRIKE':return <s {...props}>{children}</s>;
    case'H1':return <h1 {...props} className="text-3xl font-bold my-2">{children}</h1>;
    case'H2':return <h2 {...props} className="text-2xl font-bold my-2">{children}</h2>;
    case'H3':return <h3 {...props} className="text-xl font-bold my-2">{children}</h3>;
    case'P':case'DIV':return <p {...props} className="my-1 whitespace-pre-wrap">{children}</p>;
    case'UL':return <ul {...props} className="list-disc pl-6 my-2">{children}</ul>;
    case'OL':return <ol {...props} className="list-decimal pl-6 my-2">{children}</ol>;
    case'LI':return <li {...props}>{children}</li>;
    case'SUP':return <sup {...props}>{children}</sup>;
    case'SUB':return <sub {...props}>{children}</sub>;
    case'BR':return <br {...props}/>;
    case'BLOCKQUOTE':return <blockquote {...props} className="border-l-4 pl-3 italic my-2">{children}</blockquote>;
    case'TABLE':return <div key={key} className="overflow-x-auto my-2"><table className="border-collapse border w-full">{children}</table></div>;
    case'THEAD':return <thead {...props}>{children}</thead>; case'TBODY':return <tbody {...props}>{children}</tbody>; case'TR':return <tr {...props}>{children}</tr>;
    case'TH':return <th {...props} className="border p-2 text-left">{children}</th>; case'TD':return <td {...props} className="border p-2">{children}</td>;
    case'A':{const href=el.getAttribute('href')||''; return /^https?:\/\//i.test(href)?<a {...props} href={href} target="_blank" rel="noreferrer" className="underline">{children}</a>:<React.Fragment key={key}>{children}</React.Fragment>;}
    case'IMG':{const src=el.getAttribute('src')||''; return /^(https?:|data:image\/)/i.test(src)?<img key={key} src={src} alt={el.getAttribute('alt')||''} className="max-w-full h-auto rounded my-2"/>:null;}
    default:return <React.Fragment key={key}>{children}</React.Fragment>;
  }
}
export function RichContent({html}:{html:string}){
 if(!html)return null;
 if(typeof DOMParser==='undefined')return <MathText text={html.replace(/<[^>]+>/g,'')}/>;
 const doc=new DOMParser().parseFromString(html,'text/html');
 return <>{Array.from(doc.body.childNodes).map((n,i)=>nodeToReact(n,String(i)))}</>;
}
