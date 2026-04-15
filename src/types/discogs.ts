export interface DiscogsConnection {
  id: string;
  user_id: string;
  discogs_username: string;
  access_token_secret_id: string;
  access_secret_secret_id: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface DiscogsSearchResult {
  id: number;
  master_id: number | null;
  title: string;
  year: string | null;
  label: string[] | null;
  country: string | null;
  format: string[] | null;
  catno: string | null;
  thumb: string | null;
  cover_image: string | null;
  resource_url: string;
  // Parsed fields (split from "Artist - Title" title string)
  artist?: string;
  releaseTitle?: string;
}

export interface DiscogsTrack {
  position: string;
  title: string;
  duration: string | null;
  type_: string | null;
}

export interface DiscogsRelease {
  id: number;
  master_id: number | null;
  title: string;
  artists: Array<{ name: string; id: number }>;
  year: number | null;
  labels: Array<{ name: string; catno: string }> | null;
  formats: Array<{ name: string; descriptions: string[] | null; qty: string | null }> | null;
  country: string | null;
  genres: string[] | null;
  styles: string[] | null;
  tracklist: DiscogsTrack[];
  images: Array<{ uri: string; type: string }> | null;
  thumb: string | null;
}

export interface PhysicalMediaRecord {
  id: string;
  user_id: string;
  discogs_release_id: number | null;
  discogs_master_id: number | null;
  artist: string;
  title: string;
  label: string | null;
  catalogue_number: string | null;
  year: number | null;
  country: string | null;
  pressing: 'original' | 'reissue' | 'remaster' | null;
  condition: 'M' | 'NM' | 'VG+' | 'VG' | 'G+' | 'G' | 'F' | 'P' | null;
  format: 'LP' | '12"' | '7"' | '10"' | 'EP' | 'Single' | 'Other' | null;
  format_details: string | null;
  notes: string | null;
  cover_image_url: string | null;
  tracklist: DiscogsTrack[] | null;
  genres: string[] | null;
  styles: string[] | null;
  created_at: string;
  updated_at: string;
}

export type NewPhysicalMedia = Omit<PhysicalMediaRecord, 'id' | 'user_id' | 'created_at' | 'updated_at'>;
