export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      assignment_answer_images: {
        Row: {
          attempt_id: string | null;
          id: string;
          image_url: string;
          question_id: string | null;
          uploaded_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          attempt_id?: string | null;
          id?: string;
          image_url: string;
          question_id?: string | null;
          uploaded_at?: string | null;
        };
        Update: {
          attempt_id?: string | null;
          id?: string;
          image_url?: string;
          question_id?: string | null;
          uploaded_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'assignment_answer_images_attempt_id_fkey';
            columns: ['attempt_id'];
            isOneToOne: false;
            referencedRelation: 'quiz_attempts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'assignment_answer_images_question_id_fkey';
            columns: ['question_id'];
            isOneToOne: false;
            referencedRelation: 'questions';
            referencedColumns: ['id'];
          },
        ];
      };
      assignment_questions: {
        Row: {
          assignment_id: string | null;
          id: string;
          order_index: number | null;
          points: number;
          question_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          assignment_id?: string | null;
          id?: string;
          order_index?: number | null;
          points?: number;
          question_id?: string | null;
        };
        Update: {
          assignment_id?: string | null;
          id?: string;
          order_index?: number | null;
          points?: number;
          question_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'assignment_questions_assignment_id_fkey';
            columns: ['assignment_id'];
            isOneToOne: false;
            referencedRelation: 'teacher_assignments';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'assignment_questions_question_id_fkey';
            columns: ['question_id'];
            isOneToOne: false;
            referencedRelation: 'questions';
            referencedColumns: ['id'];
          },
        ];
      };
      assignment_targets: {
        Row: {
          assigned_at: string | null;
          assignment_id: string | null;
          group_id: string | null;
          id: string;
          student_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          assigned_at?: string | null;
          assignment_id?: string | null;
          group_id?: string | null;
          id?: string;
          student_id?: string | null;
        };
        Update: {
          assigned_at?: string | null;
          assignment_id?: string | null;
          group_id?: string | null;
          id?: string;
          student_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'assignment_targets_assignment_id_fkey';
            columns: ['assignment_id'];
            isOneToOne: false;
            referencedRelation: 'teacher_assignments';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'assignment_targets_group_id_fkey';
            columns: ['group_id'];
            isOneToOne: false;
            referencedRelation: 'groups';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'assignment_targets_student_id_fkey';
            columns: ['student_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      bank_groups: {
        Row: {
          bank_id: string;
          group_id: string;
        };
        ComputedFields: never;
        Insert: {
          bank_id: string;
          group_id: string;
        };
        Update: {
          bank_id?: string;
          group_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'bank_groups_bank_id_fkey';
            columns: ['bank_id'];
            isOneToOne: false;
            referencedRelation: 'question_banks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bank_groups_group_id_fkey';
            columns: ['group_id'];
            isOneToOne: false;
            referencedRelation: 'groups';
            referencedColumns: ['id'];
          },
        ];
      };
      deck_groups: {
        Row: {
          deck_id: string;
          group_id: string;
        };
        ComputedFields: never;
        Insert: {
          deck_id: string;
          group_id: string;
        };
        Update: {
          deck_id?: string;
          group_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'deck_groups_deck_id_fkey';
            columns: ['deck_id'];
            isOneToOne: false;
            referencedRelation: 'flashcard_decks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'deck_groups_group_id_fkey';
            columns: ['group_id'];
            isOneToOne: false;
            referencedRelation: 'groups';
            referencedColumns: ['id'];
          },
        ];
      };
      feature_flags: {
        Row: {
          created_at: string | null;
          description: string | null;
          id: string;
          is_enabled: boolean | null;
          key: string;
          name: string;
          rollout_percentage: number | null;
          updated_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string | null;
          description?: string | null;
          id?: string;
          is_enabled?: boolean | null;
          key: string;
          name: string;
          rollout_percentage?: number | null;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          description?: string | null;
          id?: string;
          is_enabled?: boolean | null;
          key?: string;
          name?: string;
          rollout_percentage?: number | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      flashcard_decks: {
        Row: {
          created_at: string | null;
          created_by: string | null;
          description: string | null;
          id: string;
          name: string;
          organization_id: string | null;
          search_vector: unknown;
          updated_at: string | null;
          visibility: Database['public']['Enums']['visibility_type'];
        };
        ComputedFields: never;
        Insert: {
          created_at?: string | null;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          name: string;
          organization_id?: string | null;
          search_vector?: never;
          updated_at?: string | null;
          visibility?: Database['public']['Enums']['visibility_type'];
        };
        Update: {
          created_at?: string | null;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          name?: string;
          organization_id?: string | null;
          search_vector?: never;
          updated_at?: string | null;
          visibility?: Database['public']['Enums']['visibility_type'];
        };
        Relationships: [
          {
            foreignKeyName: 'flashcard_decks_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'flashcard_decks_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      flashcard_practice: {
        Row: {
          confidence_level: number | null;
          flashcard_id: string | null;
          id: string;
          practiced_at: string | null;
          response_time_ms: number | null;
          session_id: string | null;
          user_id: string | null;
          was_correct: boolean;
        };
        ComputedFields: never;
        Insert: {
          confidence_level?: number | null;
          flashcard_id?: string | null;
          id?: string;
          practiced_at?: string | null;
          response_time_ms?: number | null;
          session_id?: string | null;
          user_id?: string | null;
          was_correct: boolean;
        };
        Update: {
          confidence_level?: number | null;
          flashcard_id?: string | null;
          id?: string;
          practiced_at?: string | null;
          response_time_ms?: number | null;
          session_id?: string | null;
          user_id?: string | null;
          was_correct?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'flashcard_practice_flashcard_id_fkey';
            columns: ['flashcard_id'];
            isOneToOne: false;
            referencedRelation: 'flashcards';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'flashcard_practice_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      flashcard_review_state: {
        Row: {
          easiness_factor: number;
          flashcard_id: string;
          interval_days: number;
          interval_unit: string;
          is_leech: boolean;
          lapse_count: number;
          last_quality: number | null;
          last_reviewed_at: string | null;
          learning_state: string;
          learning_step: number;
          next_review_at: string;
          repetitions: number;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          easiness_factor?: number;
          flashcard_id: string;
          interval_days?: number;
          interval_unit?: string;
          is_leech?: boolean;
          lapse_count?: number;
          last_quality?: number | null;
          last_reviewed_at?: string | null;
          learning_state?: string;
          learning_step?: number;
          next_review_at?: string;
          repetitions?: number;
          user_id: string;
        };
        Update: {
          easiness_factor?: number;
          flashcard_id?: string;
          interval_days?: number;
          interval_unit?: string;
          is_leech?: boolean;
          lapse_count?: number;
          last_quality?: number | null;
          last_reviewed_at?: string | null;
          learning_state?: string;
          learning_step?: number;
          next_review_at?: string;
          repetitions?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'flashcard_review_state_flashcard_id_fkey';
            columns: ['flashcard_id'];
            isOneToOne: false;
            referencedRelation: 'flashcards';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'flashcard_review_state_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      flashcard_study_sessions: {
        Row: {
          cards_correct: number;
          cards_studied: number;
          completed_at: string;
          created_at: string;
          deck_ids: string[] | null;
          duration_ms: number;
          id: string;
          mode: string;
          started_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          cards_correct?: number;
          cards_studied?: number;
          completed_at: string;
          created_at?: string;
          deck_ids?: string[] | null;
          duration_ms: number;
          id?: string;
          mode: string;
          started_at: string;
          user_id: string;
        };
        Update: {
          cards_correct?: number;
          cards_studied?: number;
          completed_at?: string;
          created_at?: string;
          deck_ids?: string[] | null;
          duration_ms?: number;
          id?: string;
          mode?: string;
          started_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'flashcard_study_sessions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      flashcard_topic_assignments: {
        Row: {
          flashcard_id: string;
          topic_id: string;
        };
        ComputedFields: never;
        Insert: {
          flashcard_id: string;
          topic_id: string;
        };
        Update: {
          flashcard_id?: string;
          topic_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'flashcard_topic_assignments_flashcard_id_fkey';
            columns: ['flashcard_id'];
            isOneToOne: false;
            referencedRelation: 'flashcards';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'flashcard_topic_assignments_topic_id_fkey';
            columns: ['topic_id'];
            isOneToOne: false;
            referencedRelation: 'topics';
            referencedColumns: ['id'];
          },
        ];
      };
      flashcards: {
        Row: {
          back: string;
          created_at: string | null;
          created_by: string | null;
          deck_id: string;
          front: string;
          id: string;
          organization_id: string | null;
          question_id: string | null;
          search_vector: unknown;
          visibility: Database['public']['Enums']['visibility_type'];
        };
        ComputedFields: never;
        Insert: {
          back: string;
          created_at?: string | null;
          created_by?: string | null;
          deck_id: string;
          front: string;
          id?: string;
          organization_id?: string | null;
          question_id?: string | null;
          search_vector?: never;
          visibility?: Database['public']['Enums']['visibility_type'];
        };
        Update: {
          back?: string;
          created_at?: string | null;
          created_by?: string | null;
          deck_id?: string;
          front?: string;
          id?: string;
          organization_id?: string | null;
          question_id?: string | null;
          search_vector?: never;
          visibility?: Database['public']['Enums']['visibility_type'];
        };
        Relationships: [
          {
            foreignKeyName: 'flashcards_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'flashcards_deck_id_fkey';
            columns: ['deck_id'];
            isOneToOne: false;
            referencedRelation: 'flashcard_decks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'flashcards_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'flashcards_question_id_fkey';
            columns: ['question_id'];
            isOneToOne: false;
            referencedRelation: 'questions';
            referencedColumns: ['id'];
          },
        ];
      };
      group_members: {
        Row: {
          group_id: string;
          id: string;
          joined_at: string | null;
          role: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          group_id: string;
          id?: string;
          joined_at?: string | null;
          role: string;
          user_id: string;
        };
        Update: {
          group_id?: string;
          id?: string;
          joined_at?: string | null;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'group_members_group_id_fkey';
            columns: ['group_id'];
            isOneToOne: false;
            referencedRelation: 'groups';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'group_members_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      groups: {
        Row: {
          created_at: string | null;
          created_by: string | null;
          description: string | null;
          id: string;
          is_default: boolean;
          name: string;
          organization_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string | null;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          is_default?: boolean;
          name: string;
          organization_id: string;
        };
        Update: {
          created_at?: string | null;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          is_default?: boolean;
          name?: string;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'groups_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'groups_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      invitations: {
        Row: {
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          inviter_id: string | null;
          is_accepted: boolean | null;
          name: string | null;
          organization_id: string | null;
          target_org_role_id: string;
          token: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          email: string;
          expires_at: string;
          id?: string;
          inviter_id?: string | null;
          is_accepted?: boolean | null;
          name?: string | null;
          organization_id?: string | null;
          target_org_role_id: string;
          token?: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          inviter_id?: string | null;
          is_accepted?: boolean | null;
          name?: string | null;
          organization_id?: string | null;
          target_org_role_id?: string;
          token?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'invitations_inviter_id_fkey';
            columns: ['inviter_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invitations_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invitations_target_org_role_id_fkey';
            columns: ['target_org_role_id'];
            isOneToOne: false;
            referencedRelation: 'org_roles';
            referencedColumns: ['id'];
          },
        ];
      };
      org_members: {
        Row: {
          id: string;
          joined_at: string | null;
          org_role_id: string;
          organization_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          id?: string;
          joined_at?: string | null;
          org_role_id: string;
          organization_id: string;
          user_id: string;
        };
        Update: {
          id?: string;
          joined_at?: string | null;
          org_role_id?: string;
          organization_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'org_members_org_role_id_fkey';
            columns: ['org_role_id'];
            isOneToOne: false;
            referencedRelation: 'org_roles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'org_members_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'org_members_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      org_role_features: {
        Row: {
          feature_key: string;
          id: string;
          is_enabled: boolean;
          org_role_id: string;
        };
        ComputedFields: never;
        Insert: {
          feature_key: string;
          id?: string;
          is_enabled?: boolean;
          org_role_id: string;
        };
        Update: {
          feature_key?: string;
          id?: string;
          is_enabled?: boolean;
          org_role_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'org_role_features_org_role_id_fkey';
            columns: ['org_role_id'];
            isOneToOne: false;
            referencedRelation: 'org_roles';
            referencedColumns: ['id'];
          },
        ];
      };
      org_role_permissions: {
        Row: {
          id: string;
          org_role_id: string;
          permission_name: string;
          scope: string;
        };
        ComputedFields: never;
        Insert: {
          id?: string;
          org_role_id: string;
          permission_name: string;
          scope: string;
        };
        Update: {
          id?: string;
          org_role_id?: string;
          permission_name?: string;
          scope?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'org_role_permissions_org_role_id_fkey';
            columns: ['org_role_id'];
            isOneToOne: false;
            referencedRelation: 'org_roles';
            referencedColumns: ['id'];
          },
        ];
      };
      org_roles: {
        Row: {
          description: string | null;
          display_name: string;
          id: string;
          is_system: boolean | null;
          name: string;
          organization_id: string;
        };
        ComputedFields: never;
        Insert: {
          description?: string | null;
          display_name: string;
          id?: string;
          is_system?: boolean | null;
          name: string;
          organization_id: string;
        };
        Update: {
          description?: string | null;
          display_name?: string;
          id?: string;
          is_system?: boolean | null;
          name?: string;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'org_roles_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      org_seat_assignments: {
        Row: {
          assigned_at: string | null;
          id: string;
          organization_id: string;
          pool_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          assigned_at?: string | null;
          id?: string;
          organization_id: string;
          pool_id: string;
          user_id: string;
        };
        Update: {
          assigned_at?: string | null;
          id?: string;
          organization_id?: string;
          pool_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'org_seat_assignments_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'org_seat_assignments_pool_id_fkey';
            columns: ['pool_id'];
            isOneToOne: false;
            referencedRelation: 'org_seat_pools';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'org_seat_assignments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      org_seat_pools: {
        Row: {
          assigned: number;
          created_at: string | null;
          id: string;
          organization_id: string;
          plan_key: string;
          total: number;
        };
        ComputedFields: never;
        Insert: {
          assigned?: number;
          created_at?: string | null;
          id?: string;
          organization_id: string;
          plan_key: string;
          total: number;
        };
        Update: {
          assigned?: number;
          created_at?: string | null;
          id?: string;
          organization_id?: string;
          plan_key?: string;
          total?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'org_seat_pools_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      organizations: {
        Row: {
          brand_color: string | null;
          created_at: string | null;
          id: string;
          logo_url: string | null;
          name: string;
          plan: string;
        };
        ComputedFields: never;
        Insert: {
          brand_color?: string | null;
          created_at?: string | null;
          id?: string;
          logo_url?: string | null;
          name: string;
          plan?: string;
        };
        Update: {
          brand_color?: string | null;
          created_at?: string | null;
          id?: string;
          logo_url?: string | null;
          name?: string;
          plan?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'organizations_plan_fkey';
            columns: ['plan'];
            isOneToOne: false;
            referencedRelation: 'subscription_plans';
            referencedColumns: ['key'];
          },
        ];
      };
      payments: {
        Row: {
          amount: number;
          currency: string;
          id: string;
          organization_id: string | null;
          paid_at: string;
          plan_key: string;
          plan_name: string;
          session_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          currency?: string;
          id?: string;
          organization_id?: string | null;
          paid_at?: string;
          plan_key: string;
          plan_name: string;
          session_id: string;
          user_id: string;
        };
        Update: {
          amount?: number;
          currency?: string;
          id?: string;
          organization_id?: string | null;
          paid_at?: string;
          plan_key?: string;
          plan_name?: string;
          session_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'payments_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      permissions: {
        Row: {
          id: string;
          name: string;
        };
        ComputedFields: never;
        Insert: {
          id?: string;
          name: string;
        };
        Update: {
          id?: string;
          name?: string;
        };
        Relationships: [];
      };
      plan_features: {
        Row: {
          created_at: string | null;
          feature_key: string;
          id: string;
          plan_key: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string | null;
          feature_key: string;
          id?: string;
          plan_key: string;
        };
        Update: {
          created_at?: string | null;
          feature_key?: string;
          id?: string;
          plan_key?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'plan_features_feature_key_fkey';
            columns: ['feature_key'];
            isOneToOne: false;
            referencedRelation: 'feature_flags';
            referencedColumns: ['key'];
          },
          {
            foreignKeyName: 'plan_features_plan_key_fkey';
            columns: ['plan_key'];
            isOneToOne: false;
            referencedRelation: 'subscription_plans';
            referencedColumns: ['key'];
          },
        ];
      };
      plan_limits: {
        Row: {
          created_at: string | null;
          id: string;
          limit_key: string;
          limit_value: number;
          plan_key: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string | null;
          id?: string;
          limit_key: string;
          limit_value?: number;
          plan_key: string;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          limit_key?: string;
          limit_value?: number;
          plan_key?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'plan_limits_plan_key_fkey';
            columns: ['plan_key'];
            isOneToOne: false;
            referencedRelation: 'subscription_plans';
            referencedColumns: ['key'];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string | null;
          deleted_at: string | null;
          email: string;
          full_name: string | null;
          id: string;
          personal_plan_key: string;
          purge_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string | null;
          deleted_at?: string | null;
          email: string;
          full_name?: string | null;
          id: string;
          personal_plan_key?: string;
          purge_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          deleted_at?: string | null;
          email?: string;
          full_name?: string | null;
          id?: string;
          personal_plan_key?: string;
          purge_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'profiles_personal_plan_key_fkey';
            columns: ['personal_plan_key'];
            isOneToOne: false;
            referencedRelation: 'subscription_plans';
            referencedColumns: ['key'];
          },
        ];
      };
      question_banks: {
        Row: {
          created_at: string | null;
          created_by: string | null;
          description: string | null;
          id: string;
          name: string;
          organization_id: string | null;
          search_vector: unknown;
          updated_at: string | null;
          visibility: Database['public']['Enums']['visibility_type'];
        };
        ComputedFields: never;
        Insert: {
          created_at?: string | null;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          name: string;
          organization_id?: string | null;
          search_vector?: never;
          updated_at?: string | null;
          visibility?: Database['public']['Enums']['visibility_type'];
        };
        Update: {
          created_at?: string | null;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          name?: string;
          organization_id?: string | null;
          search_vector?: never;
          updated_at?: string | null;
          visibility?: Database['public']['Enums']['visibility_type'];
        };
        Relationships: [
          {
            foreignKeyName: 'question_banks_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'question_banks_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      question_options: {
        Row: {
          content: string;
          id: string;
          is_correct: boolean;
          match_group: string | null;
          match_side: string | null;
          order_index: number;
          question_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          content: string;
          id?: string;
          is_correct?: boolean;
          match_group?: string | null;
          match_side?: string | null;
          order_index?: number;
          question_id?: string | null;
        };
        Update: {
          content?: string;
          id?: string;
          is_correct?: boolean;
          match_group?: string | null;
          match_side?: string | null;
          order_index?: number;
          question_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'question_options_question_id_fkey';
            columns: ['question_id'];
            isOneToOne: false;
            referencedRelation: 'questions';
            referencedColumns: ['id'];
          },
        ];
      };
      question_report_messages: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          report_id: string;
          sender_id: string;
        };
        ComputedFields: never;
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          report_id: string;
          sender_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          report_id?: string;
          sender_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'question_report_messages_report_id_fkey';
            columns: ['report_id'];
            isOneToOne: false;
            referencedRelation: 'question_reports';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'question_report_messages_sender_id_fkey';
            columns: ['sender_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      question_reports: {
        Row: {
          created_at: string;
          group_id: string | null;
          id: string;
          organization_id: string | null;
          question_id: string | null;
          reported_by: string;
          reporter_last_read_at: string;
          resolved_at: string | null;
          resolved_by: string | null;
          status: Database['public']['Enums']['report_status'];
          teacher_id: string;
          teacher_last_read_at: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          group_id?: string | null;
          id?: string;
          organization_id?: string | null;
          question_id?: string | null;
          reported_by: string;
          reporter_last_read_at?: string;
          resolved_at?: string | null;
          resolved_by?: string | null;
          status?: Database['public']['Enums']['report_status'];
          teacher_id: string;
          teacher_last_read_at?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          group_id?: string | null;
          id?: string;
          organization_id?: string | null;
          question_id?: string | null;
          reported_by?: string;
          reporter_last_read_at?: string;
          resolved_at?: string | null;
          resolved_by?: string | null;
          status?: Database['public']['Enums']['report_status'];
          teacher_id?: string;
          teacher_last_read_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'question_reports_group_id_fkey';
            columns: ['group_id'];
            isOneToOne: false;
            referencedRelation: 'groups';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'question_reports_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'question_reports_question_id_fkey';
            columns: ['question_id'];
            isOneToOne: false;
            referencedRelation: 'questions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'question_reports_reported_by_fkey';
            columns: ['reported_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'question_reports_resolved_by_fkey';
            columns: ['resolved_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'question_reports_teacher_id_fkey';
            columns: ['teacher_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      question_topic_assignments: {
        Row: {
          question_id: string;
          topic_id: string;
        };
        ComputedFields: never;
        Insert: {
          question_id: string;
          topic_id: string;
        };
        Update: {
          question_id?: string;
          topic_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'question_topic_assignments_question_id_fkey';
            columns: ['question_id'];
            isOneToOne: false;
            referencedRelation: 'questions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'question_topic_assignments_topic_id_fkey';
            columns: ['topic_id'];
            isOneToOne: false;
            referencedRelation: 'topics';
            referencedColumns: ['id'];
          },
        ];
      };
      questions: {
        Row: {
          bank_id: string;
          content: string;
          created_at: string | null;
          created_by: string | null;
          explanation: string | null;
          id: string;
          organization_id: string | null;
          search_vector: unknown;
          type: Database['public']['Enums']['question_type'];
          updated_at: string | null;
          visibility: Database['public']['Enums']['visibility_type'];
        };
        ComputedFields: never;
        Insert: {
          bank_id: string;
          content: string;
          created_at?: string | null;
          created_by?: string | null;
          explanation?: string | null;
          id?: string;
          organization_id?: string | null;
          search_vector?: never;
          type?: Database['public']['Enums']['question_type'];
          updated_at?: string | null;
          visibility?: Database['public']['Enums']['visibility_type'];
        };
        Update: {
          bank_id?: string;
          content?: string;
          created_at?: string | null;
          created_by?: string | null;
          explanation?: string | null;
          id?: string;
          organization_id?: string | null;
          search_vector?: never;
          type?: Database['public']['Enums']['question_type'];
          updated_at?: string | null;
          visibility?: Database['public']['Enums']['visibility_type'];
        };
        Relationships: [
          {
            foreignKeyName: 'questions_bank_id_fkey';
            columns: ['bank_id'];
            isOneToOne: false;
            referencedRelation: 'question_banks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'questions_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'questions_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      quiz_attempt_questions: {
        Row: {
          attempt_id: string;
          order_index: number;
          question_id: string;
          time_spent_seconds: number | null;
        };
        ComputedFields: never;
        Insert: {
          attempt_id: string;
          order_index?: number;
          question_id: string;
          time_spent_seconds?: number | null;
        };
        Update: {
          attempt_id?: string;
          order_index?: number;
          question_id?: string;
          time_spent_seconds?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'quiz_attempt_questions_attempt_id_fkey';
            columns: ['attempt_id'];
            isOneToOne: false;
            referencedRelation: 'quiz_attempts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_attempt_questions_question_id_fkey';
            columns: ['question_id'];
            isOneToOne: false;
            referencedRelation: 'questions';
            referencedColumns: ['id'];
          },
        ];
      };
      quiz_attempts: {
        Row: {
          assignment_id: string | null;
          completed_at: string | null;
          config: Json | null;
          draft_answers: NonNullable<Json>;
          graded_at: string | null;
          id: string;
          is_assignment_attempt: boolean;
          score: number;
          started_at: string | null;
          total_points: number | null;
          total_questions: number;
          user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          assignment_id?: string | null;
          completed_at?: string | null;
          config?: Json | null;
          draft_answers?: NonNullable<Json>;
          graded_at?: string | null;
          id?: string;
          is_assignment_attempt?: boolean;
          score?: number;
          started_at?: string | null;
          total_points?: number | null;
          total_questions?: number;
          user_id?: string | null;
        };
        Update: {
          assignment_id?: string | null;
          completed_at?: string | null;
          config?: Json | null;
          draft_answers?: NonNullable<Json>;
          graded_at?: string | null;
          id?: string;
          is_assignment_attempt?: boolean;
          score?: number;
          started_at?: string | null;
          total_points?: number | null;
          total_questions?: number;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'quiz_attempts_assignment_id_fkey';
            columns: ['assignment_id'];
            isOneToOne: false;
            referencedRelation: 'teacher_assignments';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_attempts_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      quiz_questions: {
        Row: {
          order_index: number;
          points: number;
          question_id: string;
          quiz_id: string;
        };
        ComputedFields: never;
        Insert: {
          order_index: number;
          points?: number;
          question_id: string;
          quiz_id: string;
        };
        Update: {
          order_index?: number;
          points?: number;
          question_id?: string;
          quiz_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'quiz_questions_question_id_fkey';
            columns: ['question_id'];
            isOneToOne: false;
            referencedRelation: 'questions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_questions_quiz_id_fkey';
            columns: ['quiz_id'];
            isOneToOne: false;
            referencedRelation: 'quizzes';
            referencedColumns: ['id'];
          },
        ];
      };
      quizzes: {
        Row: {
          created_at: string;
          created_by: string;
          description: string | null;
          id: string;
          name: string;
          organization_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by: string;
          description?: string | null;
          id?: string;
          name: string;
          organization_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          description?: string | null;
          id?: string;
          name?: string;
          organization_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'quizzes_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quizzes_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      resource_permissions: {
        Row: {
          created_at: string | null;
          id: string;
          permission: string;
          resource_id: string;
          resource_type: string;
          user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string | null;
          id?: string;
          permission: string;
          resource_id: string;
          resource_type: string;
          user_id?: string | null;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          permission?: string;
          resource_id?: string;
          resource_type?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'resource_permissions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      student_answers: {
        Row: {
          ai_graded: boolean;
          attempt_id: string | null;
          id: string;
          is_correct: boolean;
          match_pair_id: string | null;
          points_earned: number | null;
          question_id: string | null;
          question_type: Database['public']['Enums']['question_type'] | null;
          selected_option_id: string | null;
          submitted_position: number | null;
          teacher_feedback: string | null;
          teacher_points: number | null;
          text_answer: string | null;
        };
        ComputedFields: never;
        Insert: {
          ai_graded?: boolean;
          attempt_id?: string | null;
          id?: string;
          is_correct?: boolean;
          match_pair_id?: string | null;
          points_earned?: number | null;
          question_id?: string | null;
          question_type?: Database['public']['Enums']['question_type'] | null;
          selected_option_id?: string | null;
          submitted_position?: number | null;
          teacher_feedback?: string | null;
          teacher_points?: number | null;
          text_answer?: string | null;
        };
        Update: {
          ai_graded?: boolean;
          attempt_id?: string | null;
          id?: string;
          is_correct?: boolean;
          match_pair_id?: string | null;
          points_earned?: number | null;
          question_id?: string | null;
          question_type?: Database['public']['Enums']['question_type'] | null;
          selected_option_id?: string | null;
          submitted_position?: number | null;
          teacher_feedback?: string | null;
          teacher_points?: number | null;
          text_answer?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'student_answers_attempt_id_fkey';
            columns: ['attempt_id'];
            isOneToOne: false;
            referencedRelation: 'quiz_attempts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'student_answers_question_id_fkey';
            columns: ['question_id'];
            isOneToOne: false;
            referencedRelation: 'questions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'student_answers_selected_option_id_fkey';
            columns: ['selected_option_id'];
            isOneToOne: false;
            referencedRelation: 'question_options';
            referencedColumns: ['id'];
          },
        ];
      };
      subscription_plans: {
        Row: {
          created_at: string | null;
          currency: string;
          description: string | null;
          for_account_type: string | null;
          id: string;
          is_active: boolean | null;
          key: string;
          name: string;
          price_monthly: number | null;
          price_yearly: number | null;
          sort_order: number | null;
          updated_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string | null;
          currency?: string;
          description?: string | null;
          for_account_type?: string | null;
          id?: string;
          is_active?: boolean | null;
          key: string;
          name: string;
          price_monthly?: number | null;
          price_yearly?: number | null;
          sort_order?: number | null;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          currency?: string;
          description?: string | null;
          for_account_type?: string | null;
          id?: string;
          is_active?: boolean | null;
          key?: string;
          name?: string;
          price_monthly?: number | null;
          price_yearly?: number | null;
          sort_order?: number | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      suspended_decks: {
        Row: {
          created_at: string | null;
          deck_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string | null;
          deck_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string | null;
          deck_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'suspended_decks_deck_id_fkey';
            columns: ['deck_id'];
            isOneToOne: false;
            referencedRelation: 'flashcard_decks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'suspended_decks_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      teacher_assignments: {
        Row: {
          created_at: string | null;
          created_by: string | null;
          deadline: string | null;
          description: string | null;
          id: string;
          max_attempts: number;
          organization_id: string | null;
          passing_score: number | null;
          question_count: number;
          quiz_id: string | null;
          show_results: boolean;
          shuffle_answers: boolean;
          shuffle_questions: boolean;
          start_time: string | null;
          status: Database['public']['Enums']['assignment_status'];
          time_limit_min: number | null;
          title: string;
          total_points: number;
          updated_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string | null;
          created_by?: string | null;
          deadline?: string | null;
          description?: string | null;
          id?: string;
          max_attempts?: number;
          organization_id?: string | null;
          passing_score?: number | null;
          question_count?: number;
          quiz_id?: string | null;
          show_results?: boolean;
          shuffle_answers?: boolean;
          shuffle_questions?: boolean;
          start_time?: string | null;
          status?: Database['public']['Enums']['assignment_status'];
          time_limit_min?: number | null;
          title: string;
          total_points?: number;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          created_by?: string | null;
          deadline?: string | null;
          description?: string | null;
          id?: string;
          max_attempts?: number;
          organization_id?: string | null;
          passing_score?: number | null;
          question_count?: number;
          quiz_id?: string | null;
          show_results?: boolean;
          shuffle_answers?: boolean;
          shuffle_questions?: boolean;
          start_time?: string | null;
          status?: Database['public']['Enums']['assignment_status'];
          time_limit_min?: number | null;
          title?: string;
          total_points?: number;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'teacher_assignments_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'teacher_assignments_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'teacher_assignments_quiz_id_fkey';
            columns: ['quiz_id'];
            isOneToOne: false;
            referencedRelation: 'quizzes';
            referencedColumns: ['id'];
          },
        ];
      };
      topic_groups: {
        Row: {
          group_id: string;
          topic_id: string;
        };
        ComputedFields: never;
        Insert: {
          group_id: string;
          topic_id: string;
        };
        Update: {
          group_id?: string;
          topic_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'topic_groups_group_id_fkey';
            columns: ['group_id'];
            isOneToOne: false;
            referencedRelation: 'groups';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'topic_groups_topic_id_fkey';
            columns: ['topic_id'];
            isOneToOne: false;
            referencedRelation: 'topics';
            referencedColumns: ['id'];
          },
        ];
      };
      topics: {
        Row: {
          created_at: string | null;
          created_by: string | null;
          id: string;
          name: string;
          organization_id: string | null;
          search_vector: unknown;
          visibility: Database['public']['Enums']['visibility_type'];
        };
        ComputedFields: never;
        Insert: {
          created_at?: string | null;
          created_by?: string | null;
          id?: string;
          name: string;
          organization_id?: string | null;
          search_vector?: never;
          visibility?: Database['public']['Enums']['visibility_type'];
        };
        Update: {
          created_at?: string | null;
          created_by?: string | null;
          id?: string;
          name?: string;
          organization_id?: string | null;
          search_vector?: never;
          visibility?: Database['public']['Enums']['visibility_type'];
        };
        Relationships: [
          {
            foreignKeyName: 'topics_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'topics_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      user_daily_activity: {
        Row: {
          ai_input_tokens: number;
          ai_output_tokens: number;
          date: string;
          quizzes_count: number;
          quizzes_score: number;
          quizzes_total: number;
          reviews_correct: number;
          reviews_count: number;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          ai_input_tokens?: number;
          ai_output_tokens?: number;
          date: string;
          quizzes_count?: number;
          quizzes_score?: number;
          quizzes_total?: number;
          reviews_correct?: number;
          reviews_count?: number;
          user_id: string;
        };
        Update: {
          ai_input_tokens?: number;
          ai_output_tokens?: number;
          date?: string;
          quizzes_count?: number;
          quizzes_score?: number;
          quizzes_total?: number;
          reviews_correct?: number;
          reviews_count?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_daily_activity_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      user_feature_overrides: {
        Row: {
          created_at: string | null;
          created_by: string | null;
          expires_at: string | null;
          feature_key: string;
          id: string;
          is_enabled: boolean;
          reason: string | null;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string | null;
          created_by?: string | null;
          expires_at?: string | null;
          feature_key: string;
          id?: string;
          is_enabled: boolean;
          reason?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string | null;
          created_by?: string | null;
          expires_at?: string | null;
          feature_key?: string;
          id?: string;
          is_enabled?: boolean;
          reason?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_feature_overrides_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'user_feature_overrides_feature_key_fkey';
            columns: ['feature_key'];
            isOneToOne: false;
            referencedRelation: 'feature_flags';
            referencedColumns: ['key'];
          },
          {
            foreignKeyName: 'user_feature_overrides_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      user_study_settings: {
        Row: {
          daily_reset_date: string;
          daily_review_goal: number;
          learning_steps: number[];
          leech_threshold: number;
          new_cards_introduced: number;
          new_cards_per_day: number;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          daily_reset_date?: string;
          daily_review_goal?: number;
          learning_steps?: number[];
          leech_threshold?: number;
          new_cards_introduced?: number;
          new_cards_per_day?: number;
          user_id: string;
        };
        Update: {
          daily_reset_date?: string;
          daily_review_goal?: number;
          learning_steps?: number[];
          leech_threshold?: number;
          new_cards_introduced?: number;
          new_cards_per_day?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_study_settings_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      apply_org_plan: { Args: { p_org_id: string; p_plan: string }; Returns: undefined };
      bulk_create_flashcards: {
        Args: {
          p_cards: Json;
          p_deck_ids?: string[];
          p_organization_id?: string;
          p_topic_ids?: string[];
          p_user_id: string;
          p_visibility?: string;
        };
        Returns: {
          back: string;
          created_at: string | null;
          created_by: string | null;
          deck_id: string;
          front: string;
          id: string;
          organization_id: string | null;
          question_id: string | null;
          search_vector: unknown;
          visibility: Database['public']['Enums']['visibility_type'];
        }[];
        SetofOptions: {
          from: '*';
          to: 'flashcards';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      can_assign_org_role: { Args: { p_actor: string; p_role_id: string }; Returns: boolean };
      count_new_cards: {
        Args: { p_filter_type?: string; p_organization_id?: string; p_user_id: string };
        Returns: number;
      };
      get_accessible_flashcard_decks: {
        Args: { p_deck_id?: string; p_org_id?: string; p_user_id: string };
        Returns: {
          created_at: string;
          created_by: string;
          description: string;
          flashcard_count: number;
          id: string;
          name: string;
          organization_id: string;
          search_vector: unknown;
          updated_at: string;
          visibility: Database['public']['Enums']['visibility_type'];
        }[];
      };
      get_accessible_flashcards: {
        Args: {
          p_deck_id?: string;
          p_deck_ids?: string[];
          p_flashcard_id?: string;
          p_org_id?: string;
          p_topic_ids?: string[];
          p_user_id: string;
        };
        Returns: {
          back: string;
          created_at: string | null;
          created_by: string | null;
          deck_id: string;
          front: string;
          id: string;
          organization_id: string | null;
          question_id: string | null;
          search_vector: unknown;
          visibility: Database['public']['Enums']['visibility_type'];
        }[];
        SetofOptions: {
          from: '*';
          to: 'flashcards';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      get_accessible_question_banks: {
        Args: { p_bank_id?: string; p_org_id?: string; p_user_id: string };
        Returns: {
          created_at: string;
          created_by: string;
          description: string;
          id: string;
          name: string;
          organization_id: string;
          question_count: number;
          search_vector: unknown;
          updated_at: string;
          visibility: Database['public']['Enums']['visibility_type'];
        }[];
      };
      get_accessible_questions: {
        Args: {
          p_bank_ids?: string[];
          p_org_id?: string;
          p_question_id?: string;
          p_scope?: string;
          p_topic_ids?: string[];
          p_type?: string;
          p_user_id: string;
        };
        Returns: {
          content: string;
          created_at: string;
          created_by: string;
          explanation: string;
          id: string;
          organization_id: string;
          question_options: Json;
          search_vector: unknown;
          type: string;
          updated_at: string;
          visibility: Database['public']['Enums']['visibility_type'];
        }[];
      };
      get_accessible_topics: {
        Args: { p_org_id?: string; p_topic_id?: string; p_user_id: string };
        Returns: {
          created_at: string;
          created_by: string;
          flashcard_count: number;
          id: string;
          name: string;
          organization_id: string;
          question_count: number;
          search_vector: unknown;
          visibility: Database['public']['Enums']['visibility_type'];
        }[];
      };
      get_due_breakdown: {
        Args: {
          p_created_by?: string;
          p_deck_ids?: string[];
          p_organization_id?: string;
          p_topic_ids?: string[];
          p_user_id: string;
        };
        Returns: Json;
      };
      get_due_flashcards: {
        Args: {
          p_deck_ids?: string[];
          p_filter_type?: string;
          p_limit?: number;
          p_new_card_limit?: number;
          p_new_only?: boolean;
          p_organization_id?: string;
          p_topic_ids?: string[];
          p_user_id: string;
        };
        Returns: Json;
      };
      get_practice_state_breakdown: {
        Args: { p_created_by?: string; p_organization_id?: string; p_user_id: string };
        Returns: Json;
      };
      get_teacher_problematic_questions: {
        Args: { p_bank_id?: string; p_organization_id?: string; p_user_id: string };
        Returns: Json;
      };
      get_teacher_stats: {
        Args: {
          p_deck_id?: string;
          p_flashcard_ids: string[];
          p_organization_id?: string;
          p_user_id: string;
        };
        Returns: Json;
      };
      get_user_group_ids: {
        Args: { p_org_id: string; p_user_id: string };
        Returns: {
          group_id: string;
        }[];
      };
      has_org_feature: {
        Args: { p_actor: string; p_feature: string; p_organization_id: string };
        Returns: boolean;
      };
      is_org_manager: { Args: { p_actor: string; p_organization_id: string }; Returns: boolean };
      rls_audit: {
        Args: Record<PropertyKey, never>;
        Returns: {
          anon_insert: boolean;
          anon_select: boolean;
          authenticated_truncate: boolean;
          authenticated_update: boolean;
          rls_enabled: boolean;
          table_name: string;
        }[];
      };
      rls_caller_can_assign_org_role: { Args: { p_role_id: string }; Returns: boolean };
      rls_caller_has_org_feature: {
        Args: { p_feature: string; p_organization_id: string };
        Returns: boolean;
      };
      rls_caller_is_org_manager: { Args: { p_organization_id: string }; Returns: boolean };
      rls_caller_org_ids: {
        Args: Record<PropertyKey, never>;
        Returns: {
          organization_id: string;
        }[];
      };
      rls_caller_org_user_ids: {
        Args: Record<PropertyKey, never>;
        Returns: {
          user_id: string;
        }[];
      };
      search_flashcards: {
        Args: {
          p_organization_id?: string;
          p_user_id?: string;
          result_limit?: number;
          search_query: string;
        };
        Returns: {
          back: string;
          deck_id: string;
          deck_name: string;
          front: string;
          id: string;
          rank: number;
        }[];
      };
    };
    Enums: {
      account_type: 'student' | 'educator' | 'manager';
      assignment_status: 'draft' | 'published';
      question_type:
        'mcq' | 'true_false' | 'open' | 'multi_select' | 'matching' | 'ordering' | 'fill_in_blank';
      report_status: 'open' | 'resolved';
      visibility_type: 'personal' | 'group';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      account_type: ['student', 'educator', 'manager'],
      assignment_status: ['draft', 'published'],
      question_type: [
        'mcq',
        'true_false',
        'open',
        'multi_select',
        'matching',
        'ordering',
        'fill_in_blank',
      ],
      report_status: ['open', 'resolved'],
      visibility_type: ['personal', 'group'],
    },
  },
} as const;
