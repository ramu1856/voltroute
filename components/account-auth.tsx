"use client";
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isLocalhostOrigin } from '@/lib/site-config';
import { startGoogleOAuthSignIn } from '@/lib/google-oauth';

export function AccountAuth({open,onClose,supabaseUrl,supabaseKey}:{open:boolean;onClose:()=>void;supabaseUrl:string;supabaseKey:string}) {
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [googleEnabled,setGoogleEnabled]=useState<boolean|null>(null);
  const canUseAuthConfig=open&&!!supabaseUrl&&!!supabaseKey;
  const isLocalOrigin=typeof window!=='undefined'&&isLocalhostOrigin(window.location.origin);
  useEffect(()=>{
    let cancelled=false;
    if(!canUseAuthConfig)return;
    void fetch(`${supabaseUrl}/auth/v1/settings`,{
      headers:{apikey:supabaseKey,Authorization:`Bearer ${supabaseKey}`},
      cache:'no-store',
    }).then(async response=>{
      if(!response.ok)throw new Error('Auth settings unavailable');
      const body=await response.json() as {external?:{google?:boolean}};
      if(!cancelled)setGoogleEnabled(!!body.external?.google);
    }).catch(()=>{
      if(!cancelled)setGoogleEnabled(null);
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
      {!canUseAuthConfig&&<p className="auth-muted" role="status">Google sign-in is unavailable because auth keys are missing for this environment.</p>}
      {canUseAuthConfig&&googleEnabled===false&&<p className="auth-muted" role="status">Google sign-in setup is incomplete. Enable Google provider to continue.</p>}
      {canUseAuthConfig&&isLocalOrigin&&<p className="auth-muted" role="status">You are on localhost. If your local dev server is stopped, browser return-to-localhost will fail. Use the live URL for production sign-in tests.</p>}
      {message&&<p className="auth-success" role="status">{message}</p>}{error&&<p className="error-text" role="alert">{error}</p>}
      <small>By continuing, you agree to use VoltRoute as a planning aid and verify charger access and availability with the operator.</small>
    </section>
  </div>;
}
