import { request } from "./base";
export const aiApi={
 chat:(message:string,history:Array<{role:"user"|"assistant";content:string}>=[])=>request<any>("/api/ai/chat",{method:"POST",body:JSON.stringify({message,history})}),
 explain:(payload:{question:string;userAnswer:string;correctAnswer:string;existingExplanation?:string})=>request<any>("/api/ai/explain",{method:"POST",body:JSON.stringify(payload)}),
 repairJson:(json:string,error?:string)=>request<any>("/api/ai/repair-json",{method:"POST",body:JSON.stringify({json,error})})
};
