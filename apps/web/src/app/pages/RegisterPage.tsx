import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../../infrastructure/api/auth';
import { useAuthStore } from '../../state/authStore';

export function RegisterPage(){
  const nav=useNavigate(); const setUser=useAuthStore(s=>s.setUser);
  const [name,setName]=useState(''); const [username,setUsername]=useState('');
  const [password,setPassword]=useState(''); const [confirm,setConfirm]=useState('');
  const [error,setError]=useState(''); const [busy,setBusy]=useState(false); const [enabled,setEnabled]=useState(true);
  useEffect(()=>{void authApi.features().then(r=>setEnabled(r.flags?.find((f:any)=>f.key==='REGISTRATION')?.enabled!==false)).catch(()=>{})},[]);
  async function submit(e:FormEvent){e.preventDefault();if(!enabled)return;if(password!==confirm){setError('Mật khẩu nhập lại không khớp.');return}setBusy(true);setError('');
    try{await authApi.register(name,username,password,confirm);const r=await authApi.login(username,password);setUser(r.user);nav('/library')}catch(e){setError(e instanceof Error?e.message:'Không thể đăng ký')}finally{setBusy(false)}
  }
  return <div className="min-h-screen grid place-items-center p-4 bg-slate-50"><form onSubmit={submit} className="card w-full max-w-md p-7 space-y-4">
    <div><span className="eyebrow">TÀI KHOẢN</span><h1 className="mt-2 text-2xl font-extrabold">Tạo tài khoản</h1><p className="mt-2 text-sm text-slate-500">Chỉ cần tên, username và mật khẩu. Không cần Gmail/email.</p></div>
    <input className="input" placeholder="Tên hiển thị" value={name} onChange={e=>setName(e.target.value)} maxLength={80} autoComplete="name" autoFocus/>
    <input className="input" placeholder="Username" value={username} onChange={e=>setUsername(e.target.value)} maxLength={100} autoComplete="username"/>
    <input className="input" type="password" placeholder="Mật khẩu (ít nhất 10 ký tự)" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="new-password"/>
    <input className="input" type="password" placeholder="Nhập lại mật khẩu" value={confirm} onChange={e=>setConfirm(e.target.value)} autoComplete="new-password"/>
    {error&&<p className="form-error">{error}</p>}{!enabled&&<p className="form-error">Đăng ký hiện đang được tắt.</p>}
    <button className="btn-primary w-full" disabled={busy||!enabled}>{busy?'Đang tạo tài khoản…':'Đăng ký & vào học'}</button>
    <p className="text-sm text-slate-500">Đã có tài khoản? <Link className="font-semibold text-indigo-600" to="/login">Đăng nhập</Link></p>
  </form></div>
}
