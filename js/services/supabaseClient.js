// ============================================
// Supabase Client — Single source of truth
// ============================================

// Supabase Configuration
// Replace these with your actual Supabase project credentials
const SUPABASE_URL = 'https://xfgqcikavkptvbieqmsp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmZ3FjaWthdmtwdHZiaWVxbXNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyODI2MzgsImV4cCI6MjA5MDg1ODYzOH0.Nj_hlTArjKiJGFPwvtLnz76z4RfzK2A7q6-JOWwf3qM';

// Initialize Supabase Client (singleton)
let _client = null;
console.log('Supabase: Initializing client singleton...');

function getSupabaseClient() {
  console.log('Supabase: getSupabaseClient() requested');
  if (!_client) {
    if (!window.supabase) {
      console.error('Supabase: Global window.supabase SDK missing!');
      throw new Error('Supabase SDK not loaded. Ensure the CDN script is included before modules.');
    }
    try {
      _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      console.log('Supabase: Client created successfully');
    } catch (err) {
      console.error('Supabase: Error creating client:', err);
      throw err;
    }
  }
  return _client;
}

// Edge Function base URL
const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1`;

// Export singleton client getter and config
const supabase = getSupabaseClient();

export { supabase, SUPABASE_URL, SUPABASE_ANON_KEY, EDGE_FUNCTION_URL };
