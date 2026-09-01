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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      documents: {
        Row: {
          category: string | null
          created_at: string
          file_path: string | null
          id: string
          mime_type: string | null
          name: string
          size_bytes: number | null
          tags: string[] | null
          user_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          file_path?: string | null
          id?: string
          mime_type?: string | null
          name: string
          size_bytes?: number | null
          tags?: string[] | null
          user_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          file_path?: string | null
          id?: string
          mime_type?: string | null
          name?: string
          size_bytes?: number | null
          tags?: string[] | null
          user_id?: string
        }
        Relationships: []
      }
      email_summaries: {
        Row: {
          action_required: boolean | null
          created_at: string
          id: string
          received_at: string
          sender: string | null
          subject: string
          suggested_reply: string | null
          summary: string | null
          user_id: string
        }
        Insert: {
          action_required?: boolean | null
          created_at?: string
          id?: string
          received_at?: string
          sender?: string | null
          subject: string
          suggested_reply?: string | null
          summary?: string | null
          user_id: string
        }
        Update: {
          action_required?: boolean | null
          created_at?: string
          id?: string
          received_at?: string
          sender?: string | null
          subject?: string
          suggested_reply?: string | null
          summary?: string | null
          user_id?: string
        }
        Relationships: []
      }
      google_connections: {
        Row: {
          access_token: string | null
          connected_at: string
          created_at: string
          email: string | null
          expires_at: string | null
          id: string
          provider: string
          refresh_token: string | null
          scope: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token?: string | null
          connected_at?: string
          created_at?: string
          email?: string | null
          expires_at?: string | null
          id?: string
          provider?: string
          refresh_token?: string | null
          scope?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string | null
          connected_at?: string
          created_at?: string
          email?: string | null
          expires_at?: string | null
          id?: string
          provider?: string
          refresh_token?: string | null
          scope?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      google_oauth_states: {
        Row: {
          created_at: string
          redirect_uri: string
          state: string
          user_id: string
        }
        Insert: {
          created_at?: string
          redirect_uri: string
          state: string
          user_id: string
        }
        Update: {
          created_at?: string
          redirect_uri?: string
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      payslips: {
        Row: {
          anomalies: Json | null
          created_at: string
          file_path: string | null
          gross_amount: number | null
          id: string
          net_amount: number | null
          period: string
          summary: string | null
          user_id: string
        }
        Insert: {
          anomalies?: Json | null
          created_at?: string
          file_path?: string | null
          gross_amount?: number | null
          id?: string
          net_amount?: number | null
          period: string
          summary?: string | null
          user_id: string
        }
        Update: {
          anomalies?: Json | null
          created_at?: string
          file_path?: string | null
          gross_amount?: number | null
          id?: string
          net_amount?: number | null
          period?: string
          summary?: string | null
          user_id?: string
        }
        Relationships: []
      }
      planning_events: {
        Row: {
          activity: string | null
          created_at: string
          end_time: string | null
          id: string
          location: string | null
          planning_id: string
          raw_text: string | null
          shift_date: string | null
          start_time: string | null
          status: string | null
          user_id: string
          warnings: Json | null
        }
        Insert: {
          activity?: string | null
          created_at?: string
          end_time?: string | null
          id?: string
          location?: string | null
          planning_id: string
          raw_text?: string | null
          shift_date?: string | null
          start_time?: string | null
          status?: string | null
          user_id: string
          warnings?: Json | null
        }
        Update: {
          activity?: string | null
          created_at?: string
          end_time?: string | null
          id?: string
          location?: string | null
          planning_id?: string
          raw_text?: string | null
          shift_date?: string | null
          start_time?: string | null
          status?: string | null
          user_id?: string
          warnings?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "planning_events_planning_id_fkey"
            columns: ["planning_id"]
            isOneToOne: false
            referencedRelation: "plannings"
            referencedColumns: ["id"]
          },
        ]
      }
      plannings: {
        Row: {
          ai_error_message: string | null
          ai_raw_json: Json | null
          ai_status: string | null
          created_at: string
          error_message: string | null
          extracted_text: string | null
          file_name: string
          file_path: string
          id: string
          mime_type: string | null
          page_count: number | null
          planning_type: string | null
          selected_employee: Json | null
          size_bytes: number | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_error_message?: string | null
          ai_raw_json?: Json | null
          ai_status?: string | null
          created_at?: string
          error_message?: string | null
          extracted_text?: string | null
          file_name: string
          file_path: string
          id?: string
          mime_type?: string | null
          page_count?: number | null
          planning_type?: string | null
          selected_employee?: Json | null
          size_bytes?: number | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_error_message?: string | null
          ai_raw_json?: Json | null
          ai_status?: string | null
          created_at?: string
          error_message?: string | null
          extracted_text?: string | null
          file_name?: string
          file_path?: string
          id?: string
          mime_type?: string | null
          page_count?: number | null
          planning_type?: string | null
          selected_employee?: Json | null
          size_bytes?: number | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          first_name: string | null
          full_name: string | null
          id: string
          last_name: string | null
          professional_email: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          id: string
          last_name?: string | null
          professional_email?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          id?: string
          last_name?: string | null
          professional_email?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      schedule_events: {
        Row: {
          created_at: string
          ends_at: string
          id: string
          location: string | null
          notes: string | null
          source: string | null
          starts_at: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          id?: string
          location?: string | null
          notes?: string | null
          source?: string | null
          starts_at: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: string
          location?: string | null
          notes?: string | null
          source?: string | null
          starts_at?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      shifts: {
        Row: {
          activity: string | null
          confidence: string
          created_at: string
          end_time: string | null
          google_event_id: string | null
          id: string
          notes: string | null
          planning_id: string
          raw_line: string | null
          shift_date: string | null
          start_time: string | null
          user_id: string
        }
        Insert: {
          activity?: string | null
          confidence?: string
          created_at?: string
          end_time?: string | null
          google_event_id?: string | null
          id?: string
          notes?: string | null
          planning_id: string
          raw_line?: string | null
          shift_date?: string | null
          start_time?: string | null
          user_id: string
        }
        Update: {
          activity?: string | null
          confidence?: string
          created_at?: string
          end_time?: string | null
          google_event_id?: string | null
          id?: string
          notes?: string | null
          planning_id?: string
          raw_line?: string | null
          shift_date?: string | null
          start_time?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_planning_id_fkey"
            columns: ["planning_id"]
            isOneToOne: false
            referencedRelation: "plannings"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
