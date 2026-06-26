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
      chat_conversations: {
        Row: {
          agent_session_id: string | null
          created_at: string
          folder_id: string | null
          id: string
          state: Json
          title: string
          tool: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_session_id?: string | null
          created_at?: string
          folder_id?: string | null
          id?: string
          state?: Json
          title?: string
          tool: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_session_id?: string | null
          created_at?: string
          folder_id?: string | null
          id?: string
          state?: Json
          title?: string
          tool?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      folders: {
        Row: {
          created_at: string
          id: string
          instructions: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          instructions?: string
          name?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          instructions?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      folder_files: {
        Row: {
          created_at: string
          extracted_text: string
          folder_id: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          extracted_text?: string
          folder_id: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          created_at?: string
          extracted_text?: string
          folder_id?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      interview_participants: {
        Row: {
          created_at: string
          display_name: string
          id: string
          interview_date: string | null
          ordinal: number
          participant_label: string
          persona: Json
          status: string
          study_id: string
          turns: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          interview_date?: string | null
          ordinal?: number
          participant_label: string
          persona?: Json
          status?: string
          study_id: string
          turns?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          interview_date?: string | null
          ordinal?: number
          participant_label?: string
          persona?: Json
          status?: string
          study_id?: string
          turns?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_participants_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "interview_studies"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_studies: {
        Row: {
          anonymize: boolean
          brief: string | null
          context_summary: string | null
          created_at: string
          date_end: string | null
          date_start: string | null
          depth: string
          guide_questions: Json
          id: string
          interview_mode: string
          interviewer_name: string
          naming_context: string | null
          respondent_count: number
          source_excerpt: string | null
          status: string
          title: string
          user_id: string
        }
        Insert: {
          anonymize?: boolean
          brief?: string | null
          context_summary?: string | null
          created_at?: string
          date_end?: string | null
          date_start?: string | null
          depth?: string
          guide_questions?: Json
          id?: string
          interview_mode?: string
          interviewer_name: string
          naming_context?: string | null
          respondent_count?: number
          source_excerpt?: string | null
          status?: string
          title: string
          user_id: string
        }
        Update: {
          anonymize?: boolean
          brief?: string | null
          context_summary?: string | null
          created_at?: string
          date_end?: string | null
          date_start?: string | null
          depth?: string
          guide_questions?: Json
          id?: string
          interview_mode?: string
          interviewer_name?: string
          naming_context?: string | null
          respondent_count?: number
          source_excerpt?: string | null
          status?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          level: string
          link: string | null
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          level?: string
          link?: string | null
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          level?: string
          link?: string | null
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      personas: {
        Row: {
          age: number | null
          bio: string | null
          city: string | null
          core_values: string[] | null
          country: string | null
          created_at: string
          education: string | null
          gender: string | null
          id: string
          income_bracket: string | null
          key_concerns: string[] | null
          language_style: string | null
          life_situation: string | null
          name: string
          occupation: string | null
          political_sentiment: string | null
          population_id: string | null
          tags: string[] | null
          user_id: string
          voice_sample: string | null
        }
        Insert: {
          age?: number | null
          bio?: string | null
          city?: string | null
          core_values?: string[] | null
          country?: string | null
          created_at?: string
          education?: string | null
          gender?: string | null
          id?: string
          income_bracket?: string | null
          key_concerns?: string[] | null
          language_style?: string | null
          life_situation?: string | null
          name: string
          occupation?: string | null
          political_sentiment?: string | null
          population_id?: string | null
          tags?: string[] | null
          user_id: string
          voice_sample?: string | null
        }
        Update: {
          age?: number | null
          bio?: string | null
          city?: string | null
          core_values?: string[] | null
          country?: string | null
          created_at?: string
          education?: string | null
          gender?: string | null
          id?: string
          income_bracket?: string | null
          key_concerns?: string[] | null
          language_style?: string | null
          life_situation?: string | null
          name?: string
          occupation?: string | null
          political_sentiment?: string | null
          population_id?: string | null
          tags?: string[] | null
          user_id?: string
          voice_sample?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "personas_population_id_fkey"
            columns: ["population_id"]
            isOneToOne: false
            referencedRelation: "populations"
            referencedColumns: ["id"]
          },
        ]
      }
      populations: {
        Row: {
          brief: string
          created_at: string
          id: string
          name: string
          target_size: number
          user_id: string
        }
        Insert: {
          brief: string
          created_at?: string
          id?: string
          name: string
          target_size?: number
          user_id: string
        }
        Update: {
          brief?: string
          created_at?: string
          id?: string
          name?: string
          target_size?: number
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      responses: {
        Row: {
          answers: Json
          created_at: string
          id: string
          persona_id: string
          simulation_id: string
          user_id: string
        }
        Insert: {
          answers?: Json
          created_at?: string
          id?: string
          persona_id: string
          simulation_id: string
          user_id: string
        }
        Update: {
          answers?: Json
          created_at?: string
          id?: string
          persona_id?: string
          simulation_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "responses_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "responses_simulation_id_fkey"
            columns: ["simulation_id"]
            isOneToOne: false
            referencedRelation: "simulations"
            referencedColumns: ["id"]
          },
        ]
      }
      simulations: {
        Row: {
          completed_count: number
          created_at: string
          id: string
          status: string
          survey_id: string
          total_personas: number
          user_id: string
        }
        Insert: {
          completed_count?: number
          created_at?: string
          id?: string
          status?: string
          survey_id: string
          total_personas?: number
          user_id: string
        }
        Update: {
          completed_count?: number
          created_at?: string
          id?: string
          status?: string
          survey_id?: string
          total_personas?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "simulations_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
            referencedRelation: "surveys"
            referencedColumns: ["id"]
          },
        ]
      }
      surveys: {
        Row: {
          background_context: string | null
          created_at: string
          id: string
          interviewer_affiliation: string | null
          interviewer_name: string | null
          parsed_questions: Json
          project_id: string
          raw_input: string | null
          source_type: string
          source_url: string | null
          title: string
          user_id: string
        }
        Insert: {
          background_context?: string | null
          created_at?: string
          id?: string
          interviewer_affiliation?: string | null
          interviewer_name?: string | null
          parsed_questions?: Json
          project_id: string
          raw_input?: string | null
          source_type?: string
          source_url?: string | null
          title: string
          user_id: string
        }
        Update: {
          background_context?: string | null
          created_at?: string
          id?: string
          interviewer_affiliation?: string | null
          interviewer_name?: string | null
          parsed_questions?: Json
          project_id?: string
          raw_input?: string | null
          source_type?: string
          source_url?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "surveys_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      transcripts: {
        Row: {
          created_at: string
          id: string
          persona_id: string
          survey_id: string
          user_id: string
          vtt_content: string
        }
        Insert: {
          created_at?: string
          id?: string
          persona_id: string
          survey_id: string
          user_id: string
          vtt_content: string
        }
        Update: {
          created_at?: string
          id?: string
          persona_id?: string
          survey_id?: string
          user_id?: string
          vtt_content?: string
        }
        Relationships: [
          {
            foreignKeyName: "transcripts_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transcripts_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
            referencedRelation: "surveys"
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
