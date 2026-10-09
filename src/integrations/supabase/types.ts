export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      lunch_card_orders: {
        Row: {
          amount_aed: number;
          back_url: string;
          created_at: string;
          front_url: string;
          full_name: string;
          id: string;
          meeting_area: string;
          meeting_time: string;
          status: string;
          stripe_session_id: string | null;
          student_class: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          amount_aed?: number;
          back_url: string;
          created_at?: string;
          front_url: string;
          full_name: string;
          id?: string;
          meeting_area: string;
          meeting_time: string;
          status?: string;
          stripe_session_id?: string | null;
          student_class: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          amount_aed?: number;
          back_url?: string;
          created_at?: string;
          front_url?: string;
          full_name?: string;
          id?: string;
          meeting_area?: string;
          meeting_time?: string;
          status?: string;
          stripe_session_id?: string | null;
          student_class?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
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
          application_status: string;
          avatar_url: string | null;
          banned: boolean;
          bio: string;
          created_at: string;
          device_fingerprint: string | null;
          display_name: string;
          id: string;
          is_admin: boolean;
          last_seen: string;
          last_strike_at: string | null;
          moderation_strikes: number;
          plan: string;
          plan_renews_at: string | null;
          plan_status: string | null;
          r6_profile: string | null;
          timeout_reason: string | null;
          timeout_until: string | null;
          updated_at: string;
          username: string | null;
          username_changed_at: string | null;
        };
        Insert: {
          application_status?: string;
          avatar_url?: string | null;
          banned?: boolean;
          bio?: string;
          created_at?: string;
          device_fingerprint?: string | null;
          display_name?: string;
          id: string;
          is_admin?: boolean;
          last_seen?: string;
          last_strike_at?: string | null;
          moderation_strikes?: number;
          plan?: string;
          plan_renews_at?: string | null;
          plan_status?: string | null;
          r6_profile?: string | null;
          timeout_reason?: string | null;
          timeout_until?: string | null;
          updated_at?: string;
          username?: string | null;
          username_changed_at?: string | null;
        };
        Update: {
          application_status?: string;
          avatar_url?: string | null;
          banned?: boolean;
          bio?: string;
          created_at?: string;
          device_fingerprint?: string | null;
          display_name?: string;
          id?: string;
          is_admin?: boolean;
          last_seen?: string;
          last_strike_at?: string | null;
          moderation_strikes?: number;
          plan?: string;
          plan_renews_at?: string | null;
          plan_status?: string | null;
          r6_profile?: string | null;
          timeout_reason?: string | null;
          timeout_until?: string | null;
          updated_at?: string;
          username?: string | null;
          username_changed_at?: string | null;
        };
        Relationships: [];
      };
      message_reports: {
        Row: {
          conversation_id: string;
          created_at: string;
          id: string;
          message_id: string;
          reason: string;
          reporter_id: string;
          resolution: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          status: string;
        };
        Insert: {
          conversation_id: string;
          created_at?: string;
          id?: string;
          message_id: string;
          reason?: string;
          reporter_id: string;
          resolution?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          status?: string;
        };
        Update: {
          conversation_id?: string;
          created_at?: string;
          id?: string;
          message_id?: string;
          reason?: string;
          reporter_id?: string;
          resolution?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          status?: string;
        };
        Relationships: [];
      };
      friendships: {
        Row: {
          addressee_id: string;
          created_at: string;
          id: string;
          requester_id: string;
          responded_at: string | null;
          status: string;
        };
        Insert: {
          addressee_id: string;
          created_at?: string;
          id?: string;
          requester_id: string;
          responded_at?: string | null;
          status?: string;
        };
        Update: {
          addressee_id?: string;
          created_at?: string;
          id?: string;
          requester_id?: string;
          responded_at?: string | null;
          status?: string;
        };
        Relationships: [];
      };
      upload_log: {
        Row: {
          bytes: number;
          created_at: string;
          id: string;
          user_id: string;
        };
        Insert: {
          bytes: number;
          created_at?: string;
          id?: string;
          user_id: string;
        };
        Update: {
          bytes?: number;
          created_at?: string;
          id?: string;
          user_id?: string;
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
      banned_appeals: {
        Row: {
          created_at: string;
          id: string;
          message: string;
          resolved: boolean;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          message: string;
          resolved?: boolean;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          message?: string;
          resolved?: boolean;
          user_id?: string;
        };
        Relationships: [];
      };
      ban_appeal_threads: {
        Row: {
          created_at: string;
          resolved: boolean;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          resolved?: boolean;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          resolved?: boolean;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      ban_appeal_messages: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          is_moderator: boolean;
          sender_id: string;
          user_id: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          is_moderator?: boolean;
          sender_id: string;
          user_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          is_moderator?: boolean;
          sender_id?: string;
          user_id?: string;
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
      admin_set_plan: {
        Args: { _plan: string; _target: string };
        Returns: undefined;
      };
      backfill_device_fingerprint: {
        Args: { p_fingerprint: string };
        Returns: undefined;
      };
      record_moderation_block: {
        Args: { p_body: string; p_conversation_id: string; p_reason: string };
        Returns: Json;
      };
      review_application: {
        Args: { _approve: boolean; _user_id: string };
        Returns: undefined;
      };
      username_available: {
        Args: { _username: string };
        Returns: boolean;
      };
      friends_list: {
        Args: Record<PropertyKey, never>;
        Returns: {
          avatar_url: string | null;
          created_at: string;
          direction: string;
          display_name: string;
          friend_id: string;
          status: string;
          username: string | null;
        }[];
      };
      remove_friend: {
        Args: { p_user: string };
        Returns: undefined;
      };
      respond_friend_request: {
        Args: { p_accept: boolean; p_user: string };
        Returns: undefined;
      };
      send_friend_request: {
        Args: { p_username: string };
        Returns: string;
      };
      upload_quota_left: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      admin_set_r6: {
        Args: { _target: string; _url: string };
        Returns: undefined;
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
