export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      message_receipts: {
        Row: {
          conversation_id: string;
          delivered_at: string | null;
          message_id: string;
          read_at: string | null;
          recipient_id: string;
        };
        Insert: {
          conversation_id: string;
          delivered_at?: string | null;
          message_id: string;
          read_at?: string | null;
          recipient_id: string;
        };
        Update: {
          conversation_id?: string;
          delivered_at?: string | null;
          message_id?: string;
          read_at?: string | null;
          recipient_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "message_receipts_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "message_receipts_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id"];
          },
        ];
      };
      conversation_members: {
        Row: {
          conversation_id: string;
          joined_at: string;
          last_read_at: string;
          user_id: string;
        };
        Insert: {
          conversation_id: string;
          joined_at?: string;
          last_read_at?: string;
          user_id: string;
        };
        Update: {
          conversation_id?: string;
          joined_at?: string;
          last_read_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversation_members_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      conversations: {
        Row: {
          ai_moderation_enabled: boolean;
          avatar_url: string | null;
          created_at: string;
          created_by: string | null;
          dm_key: string | null;
          id: string;
          kind: Database["public"]["Enums"]["conversation_kind"];
          name: string | null;
        };
        Insert: {
          ai_moderation_enabled?: boolean;
          avatar_url?: string | null;
          created_at?: string;
          created_by?: string | null;
          dm_key?: string | null;
          id?: string;
          kind: Database["public"]["Enums"]["conversation_kind"];
          name?: string | null;
        };
        Update: {
          ai_moderation_enabled?: boolean;
          avatar_url?: string | null;
          created_at?: string;
          created_by?: string | null;
          dm_key?: string | null;
          id?: string;
          kind?: Database["public"]["Enums"]["conversation_kind"];
          name?: string | null;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          body: string | null;
          conversation_id: string;
          created_at: string;
          id: string;
          image_url: string | null;
          reply_to_message_id: string | null;
          sender_id: string;
        };
        Insert: {
          body?: string | null;
          conversation_id: string;
          created_at?: string;
          id?: string;
          image_url?: string | null;
          reply_to_message_id?: string | null;
          sender_id: string;
        };
        Update: {
          body?: string | null;
          conversation_id?: string;
          created_at?: string;
          id?: string;
          image_url?: string | null;
          reply_to_message_id?: string | null;
          sender_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          banned: boolean;
          created_at: string;
          display_name: string;
          id: string;
          is_admin: boolean;
          last_seen: string;
          last_strike_at: string | null;
          moderation_strikes: number;
          timeout_reason: string | null;
          timeout_until: string | null;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          banned?: boolean;
          created_at?: string;
          display_name?: string;
          id: string;
          is_admin?: boolean;
          last_seen?: string;
          last_strike_at?: string | null;
          moderation_strikes?: number;
          timeout_reason?: string | null;
          timeout_until?: string | null;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          banned?: boolean;
          created_at?: string;
          display_name?: string;
          id?: string;
          is_admin?: boolean;
          last_seen?: string;
          last_strike_at?: string | null;
          moderation_strikes?: number;
          timeout_reason?: string | null;
          timeout_until?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      chat_settings: {
        Row: {
          id: boolean;
          ai_moderation_enabled: boolean;
          character_limit: number;
          keyword_moderation_enabled: boolean;
          moderation_model: string;
          moderation_system_prompt: string;
        };
        Insert: {
          id?: boolean;
          ai_moderation_enabled?: boolean;
          character_limit?: number;
          keyword_moderation_enabled?: boolean;
          moderation_model?: string;
          moderation_system_prompt?: string;
        };
        Update: {
          id?: boolean;
          ai_moderation_enabled?: boolean;
          character_limit?: number;
          keyword_moderation_enabled?: boolean;
          moderation_model?: string;
          moderation_system_prompt?: string;
        };
        Relationships: [];
      };
      moderation_log: {
        Row: {
          action: string | null;
          body: string | null;
          conversation_id: string | null;
          created_at: string;
          id: string;
          reason: string | null;
          user_id: string;
          verdict: string;
        };
        Insert: {
          action?: string | null;
          body?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          id?: string;
          reason?: string | null;
          user_id: string;
          verdict?: string;
        };
        Update: {
          action?: string | null;
          body?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          id?: string;
          reason?: string | null;
          user_id?: string;
          verdict?: string;
        };
        Relationships: [
          {
            foreignKeyName: "moderation_log_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "moderation_log_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      blocked_keywords: {
        Row: {
          id: string;
          keyword: string;
          enabled: boolean;
          replacement: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          keyword: string;
          enabled?: boolean;
          replacement?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          keyword?: string;
          enabled?: boolean;
          replacement?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      admin_set_banned: {
        Args: { _target: string; _value: boolean };
        Returns: undefined;
      };
      admin_set_is_admin: {
        Args: { _target: string; _value: boolean };
        Returns: undefined;
      };
      record_moderation_block: {
        Args: { p_body: string; p_conversation_id: string; p_reason: string };
        Returns: Json;
      };
    };
    Enums: {
      conversation_kind: "public" | "dm" | "group";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      conversation_kind: ["public", "dm", "group"],
    },
  },
} as const;
