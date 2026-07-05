import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const SUPABASE_URL = 'https://exhhsaoggienjqalqxym.supabase.co'
const SUPABASE_KEY = 'sb_publishable_V4UdZ-FOO5OIIrRSdLcjsA_dTUVWThT'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)