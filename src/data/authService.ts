import { supabase } from './supabaseClient.ts'
export type AccountUser = {id:string;email?:string}
export const authService = {
  async current():Promise<AccountUser|null>{if(!supabase)return null;const {data,error}=await supabase.auth.getSession();if(error)throw error;return data.session?.user??null},
  subscribe(callback:(user:AccountUser|null)=>void){if(!supabase)return()=>{};const {data}=supabase.auth.onAuthStateChange((_event,session)=>{callback(session?.user??null)});return()=>data.subscription.unsubscribe()},
  async signIn(email:string,password:string){if(!supabase)throw Error('Supabase is not configured. Local mode is still available.');const {error}=await supabase.auth.signInWithPassword({email,password});if(error)throw error},
  async signUp(email:string,password:string){if(!supabase)throw Error('Supabase is not configured.');const {data,error}=await supabase.auth.signUp({email,password,options:{emailRedirectTo:window.location.origin+window.location.pathname}});if(error)throw error;return data.session?'Signed in.':'Check your email to confirm your account, then sign in.'},
  async signOut(){if(supabase){const {error}=await supabase.auth.signOut({scope:'local'});if(error)throw error}},
}
