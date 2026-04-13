/// <reference path="../deno.d.ts" />
// @ts-ignore
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LANGUAGE_VERSIONS: Record<string, string> = {
  javascript: '18.15.0',
  python: '3.10.0',
  java: '15.0.2',
  cpp: '10.2.0'
};

interface TestCaseResult {
  passed: boolean;
  input: any;
  expected: any;
  output: string | null;
  error: string;
}

const PISTON_API_URL = 'https://emkc.org/api/v2/piston/execute';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { language, code, testCases, timeoutMs = 3000 } = await req.json();

    if (!code || !language) {
      return new Response(JSON.stringify({ error: 'Code and language are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const langVersion = LANGUAGE_VERSIONS[language];
    if (!langVersion) {
      return new Response(JSON.stringify({ error: 'Unsupported language' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Execute against each test case sequentially
    const results: TestCaseResult[] = [];
    let totalTime = 0;

    for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i];
      const start = Date.now();
      
      const res = await fetch(PISTON_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: language === 'cpp' ? 'c++' : language,
          version: langVersion,
          files: [{ content: code }],
          stdin: String(tc.input),
          compile_timeout: timeoutMs,
          run_timeout: timeoutMs
        })
      });

      const data = await res.json();
      const runTime = Date.now() - start;
      totalTime += runTime;

      if (!res.ok) {
        results.push({
          passed: false,
          input: tc.input,
          expected: tc.expected,
          output: null,
          error: data.message || 'Execution failed'
        });
        continue;
      }

      const runOutput = data.run?.stdout || '';
      const runError = data.run?.stderr || data.compile?.stderr || '';

      // Clean trailing whitespace commonly caused by console.log
      const cleanOutput = runOutput.trim();
      const cleanExpected = String(tc.expected).trim();
      const passed = cleanOutput === cleanExpected && !runError;

      results.push({
        passed,
        input: tc.input,
        expected: cleanExpected,
        output: cleanOutput,
        error: runError
      });
    }

    return new Response(JSON.stringify({ results, total_time: totalTime }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('Run-code error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

export {};
