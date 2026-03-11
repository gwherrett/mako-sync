export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12.2.12 (cd3cf9e)"
  }
  public: {
    Tables: {
      album_genres: {
        Row: {
          cached_at: string
          genres: Json
          spotify_album_id: string
        }
        Insert: {
          cached_at?: string
          genres: Json
          spotify_album_id: string
        }
        Update: {
          cached_at?: string
          genres?: Json
          spotify_album_id?: string
        }
        Relationships: []
      }
      artist_genres: {
        Row: {
          cached_at: string
          genres: Json
          spotify_artist_id: string
        }
        Insert: {
          cached_at?: string
          genres: Json
          spotify_artist_id: string
        }
        Update: {
          cached_at?: string
          genres?: Json
          spotify_artist_id?: string
        }
        Relationships: []
      }
      local_mp3s: {
        Row: {
          album: string | null
          artist: string | null
          audio_format: string | null
          bitrate: number | null
          bpm: number | null
          comment: string | null
          core_title: string | null
          created_at: string | null
          date_added: string | null
          duration_seconds: number | null
          featured_artists: string[] | null
          file_path: string
          file_size: number | null
          genre: string | null
          hash: string | null
          id: string
          key: string | null
          last_modified: string | null
          mix: string | null
          normalized_artist: string | null
          normalized_title: string | null
          play_count: number | null
          primary_artist: string | null
          rating: number | null
          sample_rate: number | null
          super_genre: string | null
          title: string | null
          user_id: string
          year: number | null
        }
        Insert: {
          album?: string | null
          artist?: string | null
          audio_format?: string | null
          bitrate?: number | null
          bpm?: number | null
          comment?: string | null
          core_title?: string | null
          created_at?: string | null
          date_added?: string | null
          duration_seconds?: number | null
          featured_artists?: string[] | null
          file_path: string
          file_size?: number | null
          genre?: string | null
          hash?: string | null
          id?: string
          key?: string | null
          last_modified?: string | null
          mix?: string | null
          normalized_artist?: string | null
          normalized_title?: string | null
          play_count?: number | null
          primary_artist?: string | null
          rating?: number | null
          sample_rate?: number | null
          super_genre?: string | null
          title?: string | null
          user_id: string
          year?: number | null
        }
        Update: {
          album?: string | null
          artist?: string | null
          audio_format?: string | null
          bitrate?: number | null
          bpm?: number | null
          comment?: string | null
          core_title?: string | null
          created_at?: string | null
          date_added?: string | null
          duration_seconds?: number | null
          featured_artists?: string[] | null
          file_path?: string
          file_size?: number | null
          genre?: string | null
          hash?: string | null
          id?: string
          key?: string | null
          last_modified?: string | null
          mix?: string | null
          normalized_artist?: string | null
          normalized_title?: string | null
          play_count?: number | null
          primary_artist?: string | null
          rating?: number | null
          sample_rate?: number | null
          super_genre?: string | null
          title?: string | null
          user_id?: string
          year?: number | null
        }
        Relationships: []
      }
      metadata_sync_log: {
        Row: {
          fields_updated: Json | null
          id: string
          mp3_id: string | null
          notes: string | null
          sync_status: string | null
          synced_at: string | null
        }
        Insert: {
          fields_updated?: Json | null
          id?: string
          mp3_id?: string | null
          notes?: string | null
          sync_status?: string | null
          synced_at?: string | null
        }
        Update: {
          fields_updated?: Json | null
          id?: string
          mp3_id?: string | null
          notes?: string | null
          sync_status?: string | null
          synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "metadata_sync_log_mp3_id_fkey"
            columns: ["mp3_id"]
            isOneToOne: false
            referencedRelation: "local_mp3s"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string | null
          id: string
          onboarding_completed: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          onboarding_completed?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          onboarding_completed?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      spotify_connections: {
        Row: {
          access_token: string
          access_token_secret_id: string
          created_at: string | null
          display_name: string | null
          email: string | null
          expires_at: string
          id: string
          refresh_token: string | null
          refresh_token_secret_id: string
          scope: string | null
          spotify_user_id: string
          token_type: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          access_token: string
          access_token_secret_id: string
          created_at?: string | null
          display_name?: string | null
          email?: string | null
          expires_at: string
          id?: string
          refresh_token?: string | null
          refresh_token_secret_id: string
          scope?: string | null
          spotify_user_id: string
          token_type?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          access_token?: string
          access_token_secret_id?: string
          created_at?: string | null
          display_name?: string | null
          email?: string | null
          expires_at?: string
          id?: string
          refresh_token?: string | null
          refresh_token_secret_id?: string
          scope?: string | null
          spotify_user_id?: string
          token_type?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      spotify_genre_map_base: {
        Row: {
          spotify_genre: string
          super_genre: Database["public"]["Enums"]["super_genre"] | null
          updated_at: string
        }
        Insert: {
          spotify_genre: string
          super_genre?: Database["public"]["Enums"]["super_genre"] | null
          updated_at?: string
        }
        Update: {
          spotify_genre?: string
          super_genre?: Database["public"]["Enums"]["super_genre"] | null
          updated_at?: string
        }
        Relationships: []
      }
      spotify_genre_map_overrides: {
        Row: {
          id: string
          spotify_genre: string
          super_genre: Database["public"]["Enums"]["super_genre"]
          updated_at: string
          user_id: string
        }
        Insert: {
          id?: string
          spotify_genre: string
          super_genre: Database["public"]["Enums"]["super_genre"]
          updated_at?: string
          user_id: string
        }
        Update: {
          id?: string
          spotify_genre?: string
          super_genre?: Database["public"]["Enums"]["super_genre"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "spotify_genre_map_overrides_spotify_genre_fkey"
            columns: ["spotify_genre"]
            isOneToOne: false
            referencedRelation: "spotify_genre_map_base"
            referencedColumns: ["spotify_genre"]
          },
        ]
      }
      spotify_liked: {
        Row: {
          added_at: string | null
          album: string | null
          artist: string
          bpm: number | null
          core_title: string | null
          created_at: string | null
          danceability: number | null
          featured_artists: string[] | null
          genre: string | null
          id: string
          key: string | null
          mix: string | null
          normalized_artist: string | null
          normalized_title: string | null
          primary_artist: string | null
          spotify_id: string
          super_genre: Database["public"]["Enums"]["super_genre"] | null
          title: string
          user_id: string
          year: number | null
        }
        Insert: {
          added_at?: string | null
          album?: string | null
          artist: string
          bpm?: number | null
          core_title?: string | null
          created_at?: string | null
          danceability?: number | null
          featured_artists?: string[] | null
          genre?: string | null
          id?: string
          key?: string | null
          mix?: string | null
          normalized_artist?: string | null
          normalized_title?: string | null
          primary_artist?: string | null
          spotify_id: string
          super_genre?: Database["public"]["Enums"]["super_genre"] | null
          title: string
          user_id: string
          year?: number | null
        }
        Update: {
          added_at?: string | null
          album?: string | null
          artist?: string
          bpm?: number | null
          core_title?: string | null
          created_at?: string | null
          danceability?: number | null
          featured_artists?: string[] | null
          genre?: string | null
          id?: string
          key?: string | null
          mix?: string | null
          normalized_artist?: string | null
          normalized_title?: string | null
          primary_artist?: string | null
          spotify_id?: string
          super_genre?: Database["public"]["Enums"]["super_genre"] | null
          title?: string
          user_id?: string
          year?: number | null
        }
        Relationships: []
      }
      sync_progress: {
        Row: {
          artists_processed: number
          cached_genres: Json | null
          created_at: string
          error_message: string | null
          id: string
          is_full_sync: boolean | null
          last_offset: number
          last_sync_completed_at: string | null
          new_tracks_added: number | null
          status: string
          sync_id: string
          total_tracks: number | null
          tracks_fetched: number
          tracks_processed: number
          updated_at: string
          user_id: string
        }
        Insert: {
          artists_processed?: number
          cached_genres?: Json | null
          created_at?: string
          error_message?: string | null
          id?: string
          is_full_sync?: boolean | null
          last_offset?: number
          last_sync_completed_at?: string | null
          new_tracks_added?: number | null
          status?: string
          sync_id?: string
          total_tracks?: number | null
          tracks_fetched?: number
          tracks_processed?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          artists_processed?: number
          cached_genres?: Json | null
          created_at?: string
          error_message?: string | null
          id?: string
          is_full_sync?: boolean | null
          last_offset?: number
          last_sync_completed_at?: string | null
          new_tracks_added?: number | null
          status?: string
          sync_id?: string
          total_tracks?: number | null
          tracks_fetched?: number
          tracks_processed?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      track_matches: {
        Row: {
          id: string
          is_confirmed: boolean | null
          match_confidence: number | null
          match_method: string | null
          matched_at: string | null
          mp3_id: string
          spotify_track_id: string
        }
        Insert: {
          id?: string
          is_confirmed?: boolean | null
          match_confidence?: number | null
          match_method?: string | null
          matched_at?: string | null
          mp3_id: string
          spotify_track_id: string
        }
        Update: {
          id?: string
          is_confirmed?: boolean | null
          match_confidence?: number | null
          match_method?: string | null
          matched_at?: string | null
          mp3_id?: string
          spotify_track_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "track_matches_mp3_id_fkey"
            columns: ["mp3_id"]
            isOneToOne: false
            referencedRelation: "local_mp3s"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "track_matches_spotify_track_id_fkey"
            columns: ["spotify_track_id"]
            isOneToOne: false
            referencedRelation: "spotify_liked"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      v_effective_spotify_genre_map: {
        Row: {
          is_overridden: boolean | null
          spotify_genre: string | null
          super_genre: Database["public"]["Enums"]["super_genre"] | null
        }
        Relationships: []
      }
    }
    Functions: {
      get_distinct_local_albums: {
        Args: { user_uuid: string }
        Returns: {
          album: string
        }[]
      }
      get_distinct_local_artists: {
        Args: { user_uuid: string }
        Returns: {
          artist: string
        }[]
      }
      get_distinct_local_genres: {
        Args: { user_uuid: string }
        Returns: {
          genre: string
        }[]
      }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      migrate_connection_to_vault: {
        Args: { p_connection_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "user"
      super_genre:
        | "Bass"
        | "Blues"
        | "Books & Spoken"
        | "Country"
        | "Dance"
        | "Disco"
        | "Drum & Bass"
        | "Electronic"
        | "Folk"
        | "Hip Hop"
        | "House"
        | "Indie-Alternative"
        | "Jazz"
        | "Latin"
        | "Metal"
        | "Orchestral"
        | "Other"
        | "Pop"
        | "Reggae/Dancehall"
        | "Rock"
        | "Seasonal"
        | "Soul-Jazz"
        | "UK Garage"
        | "Urban"
        | "World"
        | "Soul-Funk"
        | "Reggae-Dancehall"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      super_genre: [
        "Bass",
        "Blues",
        "Books & Spoken",
        "Country",
        "Dance",
        "Disco",
        "Drum & Bass",
        "Electronic",
        "Folk",
        "Hip Hop",
        "House",
        "Indie-Alternative",
        "Jazz",
        "Latin",
        "Metal",
        "Orchestral",
        "Other",
        "Pop",
        "Reggae/Dancehall",
        "Rock",
        "Seasonal",
        "Soul-Jazz",
        "UK Garage",
        "Urban",
        "World",
        "Soul-Funk",
        "Reggae-Dancehall",
      ],
    },
  },
} as const
