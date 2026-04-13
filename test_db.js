
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://xfgqcikavkptvbieqmsp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmZ3FjaWthdmtwdHZiaWVxbXNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyODI2MzgsImV4cCI6MjA5MDg1ODYzOH0.Nj_hlTArjKiJGFPwvtLnz76z4RfzK2A7q6-JOWwf3qM';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function check() {
  console.log('--- Database Check ---');
  
  // 1. Check Profiles
  const { data: profiles, error: pError } = await supabase.from('profiles').select('count').single();
  if (pError) console.error('Profiles Table Error:', pError.code, pError.message);
  else console.log('Profiles Table: OK');

  // 2. Check Sessions
  const { error: sError } = await supabase.from('sessions').select('count').single();
  if (sError) console.error('Sessions Table Error:', sError.code, sError.message);
  else console.log('Sessions Table: OK');

  // 3. Check Questions
  const { error: qError } = await supabase.from('questions').select('count').single();
  if (qError) console.error('Questions Table Error:', qError.code, qError.message);
  else console.log('Questions Table: OK');
}

check();
