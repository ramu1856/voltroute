declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    TOMTOM_API_KEY?: string;
    NEXT_PUBLIC_SUPABASE_URL?: string;
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
    PHOTON_URL?: string;
    OSRM_URL?: string;
  }
}
