"use client";
import { useState } from 'react';
import { Mail, Phone, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabaseBrowser } from '@/lib/supabase-client';

export function AccountAuth({open,onClose,supabaseUrl,supabaseKey}:{open:boolean;onClose:()=>void;supabaseUrl:string;supabaseKey:string}) {
  const [email,setEmail]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  if(!open)return null;
  async function sendLink(){
    setBusy(true);setError('');setMessage('');
    try{
      const {error:authError}=await supabaseBrowser({url:supabaseUrl,key:supabaseKey}).auth.signInWithOtp({email:email.trim(),options:{emailRedirectTo:window.location.origin}});
      if(authError)throw authError;
      setMessage('Secure sign-in link sent. Open your email on this device to continue.');
    }catch(reason){setError(reason instanceof Error?reason.message:'Could not send the sign-in link.');}
    finally{setBusy(false);}
  }
  return <div className="auth-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section className="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <button className="auth-close" type="button" aria-label="Close sign in" onClick={onClose}><X/></button>
      <span className="auth-icon"><Mail/></span><h2 id="auth-title">Sign up or sign in</h2>
      <p>Enter your email. We will send one secure link—no password required.</p>
      <label className="form-label">Email address<input type="email" autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)} placeholder="you@example.com"/></label>
      <Button className="full" disabled={busy||!/^\S+@\S+\.\S+$/.test(email)} onClick={()=>void sendLink()}><Mail/>{busy?'Sending…':'Email me a sign-in link'}</Button>
      {message&&<p className="auth-success" role="status">{message}</p>}{error&&<p className="error-text" role="alert">{error}</p>}
      <div className="auth-phone"><Phone/><div><strong>Phone number login</strong><p>Coming after an SMS provider is connected. VoltRoute will not pretend an OTP was sent.</p></div></div>
      <small>By continuing, you agree to use VoltRoute as a planning aid and verify charger access and availability with the operator.</small>
    </section>
  </div>;
}
