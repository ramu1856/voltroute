import { getChatGPTUser, chatGPTSignInPath } from './chatgpt-auth';
import VoltApp from '@/components/volt-app';
export const dynamic = 'force-dynamic';
export default async function Home(){ const user=await getChatGPTUser();return <VoltApp signedIn={!!user} signInUrl={chatGPTSignInPath('/')} />; }
