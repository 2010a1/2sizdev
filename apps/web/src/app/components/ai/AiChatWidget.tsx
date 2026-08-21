import { useState } from "react";
import { aiApi } from "../../../infrastructure/api/ai";
import { AppIcon } from "../AppIcon";

type Msg={role:"user"|"assistant";content:string};
export function AiChatWidget(){
 const [open,setOpen]=useState(false); const [text,setText]=useState(""); const [messages,setMessages]=useState<Msg[]>([]);
 const [busy,setBusy]=useState(false); const [error,setError]=useState("");
 async function send(){const v=text.trim();if(!v||busy)return;setText("");setError("");const next=[...messages,{role:"user" as const,content:v}];setMessages(next);setBusy(true);try{const r=await aiApi.chat(v,messages);setMessages([...next,{role:"assistant",content:r.answer}]);}catch(e){setError(e instanceof Error?e.message:"AI hiện không khả dụng");}finally{setBusy(false);}}
 return <div className="fixed right-4 bottom-4 z-[80]">
  {open&&<div className="mb-3 w-[min(360px,calc(100vw-2rem))] h-[480px] bg-white border border-slate-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
   <div className="px-4 py-3 border-b flex items-center justify-between"><div><strong>✨ AI học tập</strong><p className="text-xs text-slate-500">Chỉ gọi AI khi bạn gửi câu hỏi</p></div><button className="btn-secondary !px-2 !py-1" onClick={()=>setOpen(false)}>×</button></div>
   <div className="flex-1 overflow-auto p-3 space-y-2">{messages.length===0&&<div className="text-sm text-slate-500 p-3">Hỏi mình về bài học, câu hỏi hoặc cách sử dụng web.</div>}{messages.map((m,i)=><div key={i} className={`rounded-xl p-2.5 text-sm whitespace-pre-wrap ${m.role==="user"?"bg-indigo-50 ml-8":"bg-slate-50 mr-8"}`}>{m.content}</div>)}{busy&&<div className="text-xs text-slate-400">AI đang trả lời…</div>}{error&&<div className="text-xs text-red-600">{error}</div>}</div>
   <div className="p-3 border-t flex gap-2"><textarea value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void send();}}} className="input flex-1 resize-none" rows={2} placeholder="Nhập câu hỏi..." /><button className="btn-primary self-end" disabled={busy||!text.trim()} onClick={()=>void send()}><AppIcon name="spark" size={16}/></button></div>
  </div>}
  <button onClick={()=>setOpen(v=>!v)} aria-label="Mở AI" className="w-14 h-14 rounded-full bg-indigo-600 text-white shadow-xl flex items-center justify-center hover:scale-105 transition"><AppIcon name="spark" size={23}/></button>
 </div>
}
