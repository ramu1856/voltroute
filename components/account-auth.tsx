"use client";
import { useEffect, useMemo, useState } from 'react';
import { Phone, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { startGoogleOAuthSignIn } from '@/lib/google-oauth';
import { isLocalhostOrigin } from '@/lib/site-config';
import { supabaseBrowser } from '@/lib/supabase-client';

function normalizeUsPhone(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export function AccountAuth({open,onClose,supabaseUrl,supabaseKey}:{open:boolean;onClose:()=>void;supabaseUrl:string;supabaseKey:string}) {
  const [phone,setPhone]=useState('');
  const [otpCode,setOtpCode]=useState('');
  const [otpPhone,setOtpPhone]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [googleEnabled,setGoogleEnabled]=useState<boolean|null>(null);
  const [phoneEnabled,setPhoneEnabled]=useState<boolean|null>(null);
  const canUseAuthConfig=open&&!!supabaseUrl&&!!supabaseKey;
  const isLocalOrigin=typeof window!=='undefined'&&isLocalhostOrigin(window.location.origin);
  const usPhone=useMemo(()=>normalizeUsPhone(phone),[phone]);
  const phoneInputValid=usPhone!==null;
  const otpCodeValid=/^\d{6}$/.test(otpCode.trim());

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
      if(!cancelled)setGoogleEnabled(null);
      if(!cancelled)setPhoneEnabled(null);
    });
    return ()=>{cancelled=true;};
  },[canUseAuthConfig,supabaseKey,supabaseUrl]);

  async function startGoogleSignIn(){
    setBusy(true);setError('');setMessage('');
    try{
      const {localNotice}=await startGoogleOAuthSignIn({supabaseUrl,supabaseKey});
      if(localNotice)setMessage(localNotice);
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
      const client=supabaseBrowser({url:supabaseUrl,key:supabaseKey});
      const {error:otpError}=await client.auth.signInWithOtp({phone:usPhone,options:{channel:'sms'}});
      if(otpError)throw otpError;
      setOtpPhone(usPhone);
      setOtpCode('');
      setMessage('SMS code sent. Enter the 6-digit OTP to finish sign-in.');
    }catch(reason){
      const text=reason instanceof Error?reason.message:'Could not send phone OTP.';
      setError(text);
    }finally{setBusy(false);}
  }

  async function verifyPhoneOtp(){
    setBusy(true);setError('');setMessage('');
    try{
      if(!otpPhone)throw new Error('Request an OTP first.');
      const token=otpCode.trim();
      if(!/^\d{6}$/.test(token))throw new Error('Enter the 6-digit SMS code.');
      const client=supabaseBrowser({url:supabaseUrl,key:supabaseKey});
      const {error:verifyError}=await client.auth.verifyOtp({phone:otpPhone,token,type:'sms'});
      if(verifyError)throw verifyError;
      setOtpPhone(null);
      setOtpCode('');
      setPhone('');
      setMessage('Phone sign-in completed.');
      onClose();
    }catch(reason){
      const text=reason instanceof Error?reason.message:'Could not verify phone OTP.';
      setError(text);
    }finally{setBusy(false);}
  }

  if(!open)return null;
  return <div className="auth-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section className="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <button className="auth-close" type="button" aria-label="Close sign in" onClick={onClose}><X/></button>
      <h2 id="auth-title">Sign up or sign in</h2>
      <p>Continue with your Google account to sign in instantly.</p>
      <Button className="full auth-google" disabled={busy||!canUseAuthConfig||googleEnabled===false} onClick={()=>void startGoogleSignIn()}>
        <span className="auth-google-mark" aria-hidden="true">G</span>
        {busy?'Opening Google…':'Continue with Google'}
      </Button>
      <div className="auth-phone">
        <Phone aria-hidden="true"/>
        <div>
          <strong>Use a US phone number (optional)</strong>
          <p>Enter a 10-digit US number. We convert it to +1 format and send a one-time SMS code.</p>
        </div>
      </div>
      <label className="form-label">US phone number
        <input type="tel" autoComplete="tel" value={phone} onChange={event=>setPhone(event.target.value)} placeholder="(555) 123-4567"/>
      </label>
      <Button className="full" variant="outline" disabled={busy||!canUseAuthConfig||!phoneInputValid||phoneEnabled===false} onClick={()=>void startPhoneSignIn()}>
        {busy?'Sending OTP…':'Send US phone OTP'}
      </Button>
      {otpPhone&&<label className="form-label">Enter 6-digit OTP
        <input type="text" inputMode="numeric" autoComplete="one-time-code" value={otpCode} onChange={event=>setOtpCode(event.target.value.replace(/\D/g,'').slice(0,6))} placeholder="123456"/>
      </label>}
      {otpPhone&&<Button className="full" variant="outline" disabled={busy||!otpCodeValid} onClick={()=>void verifyPhoneOtp()}>
        {busy?'Verifying…':'Verify OTP'}
      </Button>}
      {!canUseAuthConfig&&<p className="auth-muted" role="status">Google sign-in is unavailable because auth keys are missing for this environment.</p>}
      {canUseAuthConfig&&googleEnabled===false&&<p className="auth-muted" role="status">Google sign-in setup is incomplete. Enable Google provider to continue.</p>}
      {phone.trim().length>0&&!phoneInputValid&&<p className="auth-muted" role="status">Enter a valid US number (10 digits). We convert it to +1 format.</p>}
      {canUseAuthConfig&&phoneEnabled===false&&<p className="auth-muted" role="status">US phone OTP is not enabled in Supabase yet. Enable Phone provider to use this option.</p>}
      {canUseAuthConfig&&isLocalOrigin&&<p className="auth-muted" role="status">You are on localhost. If your local dev server is stopped, browser return-to-localhost will fail. Use the live URL for production sign-in tests.</p>}
      {message&&<p className="auth-success" role="status">{message}</p>}{error&&<p className="error-text" role="alert">{error}</p>}
      <small>By continuing, you agree to use VoltRoute as a planning aid and verify charger access and availability with the operator.</small>
    </section>
  </div>;
}
