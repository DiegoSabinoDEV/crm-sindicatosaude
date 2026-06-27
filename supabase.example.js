import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// Copie este arquivo para supabase.js e preencha com as credenciais do projeto Supabase do SINDESEP.
// NUNCA commite supabase.js — ele está no .gitignore.
export const supabaseUrl = "[SUBSTITUIR PELA URL DO SUPABASE NOVO DO SINDESEP]";
export const supabaseAnonKey = "[SUBSTITUIR PELA ANON KEY DO SUPABASE NOVO]";
// Nota: a service_role_key NUNCA vai aqui, e NUNCA é commitada.

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
