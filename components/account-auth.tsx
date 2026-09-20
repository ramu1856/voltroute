"use client";
import { useEffect, useMemo, useState } from 'react';
import { Phone, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabaseBrowser } from '@/lib/supabase-client';

const hostedAuthCallback='https://voltroutes.com/callback';
function oauthRedirectTarget() {
  return hostedAuthCallback;
}
function googleAuthorizeUrl(supabaseUrl:string){
  const base=supabaseUrl.replace(/\/+$/,'');
  const url=new URL('/auth/v1/authorize',base);
  url.searchParams.set('provider','google');
  url.searchParams.set('redirect_to',oauthRedirectTarget());
  url.searchParams.set('scopes','openid email profile');
  url.searchParams.set('prompt','consent select_account');
  url.searchParams.set('access_type','offline');
  return url.toString();
}
function normalizeUsPhone(value:string){
  const digits=value.replace(/\D/g,'');
  if(digits.length===10)return `+1${digits}`;
  if(digits.length===11&&digits.startsWith('1'))return `+${digits}`;
  return null;
}

export function AccountAuth({open,onClose,supabaseUrl,supabaseKey}:{open:boolean;onClose:()=>void;supabaseUrl:string;supabaseKey:string}) {
  const [phone,setPhone]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [googleEnabled,setGoogleEnabled]=useState<boolean|null>(null);
  const [phoneEnabled,setPhoneEnabled]=useState<boolean|null>(null);
  const usPhone=useMemo(()=>normalizeUsPhone(phone),[phone]);
  const phoneInputValid=usPhone!==null;
  const canUseAuthConfig=open&&!!supabaseUrl&&!!supabaseKey;
  const isLocalOrigin=typeof window!=='undefined'&&/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(window.location.origin);
  useEffect(()=>{
    let cancelled=false;
    if(!canUseAuthConfig)return;
    void fetch(`${supabaseUrl}/auth/v1/settings`,{
      headers:{apikey:supabaseKey,Authorization:`Bearer ${supabaseKey}`},
      cache:'no-store',
    }).then(async response=>{
      if(!response.ok)throw new Error('Auth settings unavailable');
      const body=await response.json() as {external?:{google?:boolean;phone?:boolean}};
      if(!cancelled)setGoogleEnabled(!!body.external?.google);
      if(!cancelled)setPhoneEnabled(!!body.external?.phone);
    }).catch(()=>{
      // Keep auth actions visible even when settings lookup fails.
      if(!cancelled)setGoogleEnabled(null);
      if(!cancelled)setPhoneEnabled(null);
    });
    return ()=>{cancelled=true;};
  },[canUseAuthConfig,supabaseKey,supabaseUrl]);
  async function startGoogleSignIn(){
    setBusy(true);setError('');setMessage('');
    try{
      if(isLocalOrigin)setMessage('Localhost testing detected. Production users should sign in from voltroutes.com.');
      window.location.assign(googleAuthorizeUrl(supabaseUrl));
    }catch(reason){
      const text=reason instanceof Error?reason.message:'Could not start Google sign-in.';
      if(text.toLowerCase().includes('provider'))setError('Google sign-in is not enabled yet. Enable Google provider and try again.');
      else setError(text);
    }finally{setBusy(false);}
  }
  async function startPhoneSignIn(){
    setBusy(true);setError('');setMessage('');
    try{
      if(!usPhone)throw new Error('Enter a valid US number with 10 digits.');
      const {error:authError}=await supabaseBrowser({url:supabaseUrl,key:supabaseKey}).auth.signInWithOtp({phone:usPhone,options:{channel:'sms'}});
      if(authError)throw authError;
      setMessage('SMS code sent to your US number. Enter the OTP to finish sign-in.');
    }catch(reason){
      const text=reason instanceof Error?reason.message:'Could not start phone sign-in.';
      setError(text);
    }finally{setBusy(false);}
  }
  if(!open)return null;
  return <div className="auth-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section className="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <button className="auth-close" type="button" aria-label="Close sign in" onClick={onClose}><X/></button>
      <h2 id="auth-title">Sign up or sign in</h2>
      <p>Step 1: Continue with Google (recommended for all users).</p>
      <Button className="full auth-google" disabled={busy||!canUseAuthConfig} onClick={()=>void startGoogleSignIn()}>
        <span className="auth-google-mark" aria-hidden="true">G</span>
        {busy?'Opening Google…':'Continue with Google'}
      </Button>
      {!canUseAuthConfig&&<p className="auth-muted" role="status">Google sign-in is unavailable because auth keys are missing for this environment.</p>}
      {canUseAuthConfig&&googleEnabled===false&&<p className="auth-muted" role="status">Google sign-in setup is incomplete. Enable Google provider to continue.</p>}
      {canUseAuthConfig&&isLocalOrigin&&<p className="auth-muted" role="status">You are on localhost. If your local dev server is stopped, browser return-to-localhost will fail. Use the live URL for production sign-in tests.</p>}
      <div className="auth-alt-block">
        <p>Optional backup: US phone number OTP (+1).</p>
        <label className="form-label">US phone number<input type="tel" autoComplete="tel" value={phone} onChange={event=>setPhone(event.target.value)} placeholder="(555) 123-4567"/></label>
        <Button className="full" disabled={busy||!canUseAuthConfig||!phoneInputValid||phoneEnabled===false} onClick={()=>void startPhoneSignIn()}><Phone/>{busy?'Sending OTP…':'Send US phone OTP'}</Button>
        {!phoneInputValid&&phone.trim().length>0&&<p className="auth-muted" role="status">Enter a valid US number (10 digits). We convert it to +1 format.</p>}
        {canUseAuthConfig&&phoneEnabled===false&&<p className="auth-muted" role="status">US phone OTP is not enabled yet.</p>}
      </div>
      {message&&<p className="auth-success" role="status">{message}</p>}{error&&<p className="error-text" role="alert">{error}</p>}
      <small>By continuing, you agree to use VoltRoute as a planning aid and verify charger access and availability with the operator.</small>
    </section>
  </div>;
}
