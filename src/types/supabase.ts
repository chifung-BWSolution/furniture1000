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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      bwf_development_command_logs: {
        Row: {
          cached_input_tokens: number | null
          completed_at: string | null
          cost_usd: number | null
          created_at: string
          credits_used: number | null
          developer_auth_user_id: string | null
          developer_email: string
          developer_name: string
          duration_seconds: number | null
          external_id: string | null
          failure_reason: string | null
          id: string
          input_tokens: number | null
          instruction_text: string
          model: string | null
          output_tokens: number | null
          result_summary: string | null
          started_at: string
          status: string
          task_reference: string | null
        }
        Insert: {
          cached_input_tokens?: number | null
          completed_at?: string | null
          cost_usd?: number | null
          created_at?: string
          credits_used?: number | null
          developer_auth_user_id?: string | null
          developer_email: string
          developer_name: string
          duration_seconds?: number | null
          external_id?: string | null
          failure_reason?: string | null
          id?: string
          input_tokens?: number | null
          instruction_text: string
          model?: string | null
          output_tokens?: number | null
          result_summary?: string | null
          started_at?: string
          status?: string
          task_reference?: string | null
        }
        Update: {
          cached_input_tokens?: number | null
          completed_at?: string | null
          cost_usd?: number | null
          created_at?: string
          credits_used?: number | null
          developer_auth_user_id?: string | null
          developer_email?: string
          developer_name?: string
          duration_seconds?: number | null
          external_id?: string | null
          failure_reason?: string | null
          id?: string
          input_tokens?: number | null
          instruction_text?: string
          model?: string | null
          output_tokens?: number | null
          result_summary?: string | null
          started_at?: string
          status?: string
          task_reference?: string | null
        }
        Relationships: []
      }
      bwf_development_cost_settings: {
        Row: {
          current_revision: number
          setting_key: string
          updated_at: string | null
          updated_by_auth_user_id: string | null
        }
        Insert: {
          current_revision?: number
          setting_key: string
          updated_at?: string | null
          updated_by_auth_user_id?: string | null
        }
        Update: {
          current_revision?: number
          setting_key?: string
          updated_at?: string | null
          updated_by_auth_user_id?: string | null
        }
        Relationships: []
      }
      bwf_development_hourly_rate_versions: {
        Row: {
          change_reason: string
          created_at: string
          created_by_auth_user_id: string | null
          created_by_email: string
          created_by_name: string
          effective_from: string
          hourly_rate_hkd: number
          id: string
          revision_no: number
        }
        Insert: {
          change_reason: string
          created_at?: string
          created_by_auth_user_id?: string | null
          created_by_email?: string
          created_by_name?: string
          effective_from: string
          hourly_rate_hkd: number
          id?: string
          revision_no: number
        }
        Update: {
          change_reason?: string
          created_at?: string
          created_by_auth_user_id?: string | null
          created_by_email?: string
          created_by_name?: string
          effective_from?: string
          hourly_rate_hkd?: number
          id?: string
          revision_no?: number
        }
        Relationships: []
      }
      bwf_product_categories: {
        Row: {
          created_at: string | null
          created_date: string | null
          creator_staff_id: string | null
          editor_staff_id: string | null
          id: string
          level: number
          modified_date: string | null
          name: string
          parent_id: string | null
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_date?: string | null
          creator_staff_id?: string | null
          editor_staff_id?: string | null
          id?: string
          level?: number
          modified_date?: string | null
          name: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_date?: string | null
          creator_staff_id?: string | null
          editor_staff_id?: string | null
          id?: string
          level?: number
          modified_date?: string | null
          name?: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bwf_product_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "bwf_product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      bwf_quote: {
        Row: {
          bwf_pitching_id: string | null
          bwf_project_id: string | null
          cost_price: number | null
          created_at: string | null
          created_date: string | null
          creator_staff_id: string | null
          editor_staff_id: string | null
          exchange_rate: number | null
          hkd_cost_price: number | null
          id: string
          modified_date: string | null
          project_data: Json
          quote_id: string
          status: string
          submitter: string
          terms_content: Json | null
          total_amount: number
          version: string
        }
        Insert: {
          bwf_pitching_id?: string | null
          bwf_project_id?: string | null
          cost_price?: number | null
          created_at?: string | null
          created_date?: string | null
          creator_staff_id?: string | null
          editor_staff_id?: string | null
          exchange_rate?: number | null
          hkd_cost_price?: number | null
          id?: string
          modified_date?: string | null
          project_data?: Json
          quote_id: string
          status?: string
          submitter: string
          terms_content?: Json | null
          total_amount?: number
          version?: string
        }
        Update: {
          bwf_pitching_id?: string | null
          bwf_project_id?: string | null
          cost_price?: number | null
          created_at?: string | null
          created_date?: string | null
          creator_staff_id?: string | null
          editor_staff_id?: string | null
          exchange_rate?: number | null
          hkd_cost_price?: number | null
          id?: string
          modified_date?: string | null
          project_data?: Json
          quote_id?: string
          status?: string
          submitter?: string
          terms_content?: Json | null
          total_amount?: number
          version?: string
        }
        Relationships: []
      }
      bwf_quote_item: {
        Row: {
          category: string | null
          client_item_id: string | null
          color: string | null
          cost_price: number | null
          created_at: string | null
          delivery_term_name: string | null
          dimension_h_mm: string | null
          dimension_l_mm: string | null
          dimension_w_mm: string | null
          exchange_rate: number | null
          factory_from_catalog: boolean | null
          factory_name: string | null
          hide_in_pdf: boolean
          hkd_cost_price: number | null
          id: string
          image: string
          is_custom_term: boolean | null
          is_optional: boolean
          is_section_title: boolean
          material: string | null
          name: string
          product_category_id: string | null
          product_id: string | null
          quantity: number
          quote_uuid: string
          reference_image: string | null
          remarks: string | null
          remarks_image: string | null
          sku: string | null
          sort_order: number
          unit: string | null
          unit_price: number
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          client_item_id?: string | null
          color?: string | null
          cost_price?: number | null
          created_at?: string | null
          delivery_term_name?: string | null
          dimension_h_mm?: string | null
          dimension_l_mm?: string | null
          dimension_w_mm?: string | null
          exchange_rate?: number | null
          factory_from_catalog?: boolean | null
          factory_name?: string | null
          hide_in_pdf?: boolean
          hkd_cost_price?: number | null
          id?: string
          image?: string
          is_custom_term?: boolean | null
          is_optional?: boolean
          is_section_title?: boolean
          material?: string | null
          name?: string
          product_category_id?: string | null
          product_id?: string | null
          quantity?: number
          quote_uuid: string
          reference_image?: string | null
          remarks?: string | null
          remarks_image?: string | null
          sku?: string | null
          sort_order?: number
          unit?: string | null
          unit_price?: number
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          client_item_id?: string | null
          color?: string | null
          cost_price?: number | null
          created_at?: string | null
          delivery_term_name?: string | null
          dimension_h_mm?: string | null
          dimension_l_mm?: string | null
          dimension_w_mm?: string | null
          exchange_rate?: number | null
          factory_from_catalog?: boolean | null
          factory_name?: string | null
          hide_in_pdf?: boolean
          hkd_cost_price?: number | null
          id?: string
          image?: string
          is_custom_term?: boolean | null
          is_optional?: boolean
          is_section_title?: boolean
          material?: string | null
          name?: string
          product_category_id?: string | null
          product_id?: string | null
          quantity?: number
          quote_uuid?: string
          reference_image?: string | null
          remarks?: string | null
          remarks_image?: string | null
          sku?: string | null
          sort_order?: number
          unit?: string | null
          unit_price?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bwf_quote_item_product_category_id_fkey"
            columns: ["product_category_id"]
            isOneToOne: false
            referencedRelation: "product_category"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bwf_quote_item_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bwf_quote_item_quote_uuid_fkey"
            columns: ["quote_uuid"]
            isOneToOne: false
            referencedRelation: "bwf_quote"
            referencedColumns: ["id"]
          },
        ]
      }
      bwf_quote_share_links: {
        Row: {
          created_at: string
          created_date: string | null
          creator_staff_id: string | null
          editor_staff_id: string | null
          id: string
          last_viewed_at: string | null
          modified_date: string | null
          quote_id: string
          quote_uuid: string
          share_token: string
          status: string
        }
        Insert: {
          created_at?: string
          created_date?: string | null
          creator_staff_id?: string | null
          editor_staff_id?: string | null
          id?: string
          last_viewed_at?: string | null
          modified_date?: string | null
          quote_id: string
          quote_uuid: string
          share_token: string
          status?: string
        }
        Update: {
          created_at?: string
          created_date?: string | null
          creator_staff_id?: string | null
          editor_staff_id?: string | null
          id?: string
          last_viewed_at?: string | null
          modified_date?: string | null
          quote_id?: string
          quote_uuid?: string
          share_token?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "bwf_quote_share_links_quote_uuid_fkey"
            columns: ["quote_uuid"]
            isOneToOne: false
            referencedRelation: "bwf_quote"
            referencedColumns: ["id"]
          },
        ]
      }
      client_companies: {
        Row: {
          address: string | null
          contact_email: string | null
          contact_person: string | null
          contact_phone: string | null
          created_at: string | null
          created_date: string | null
          creator_staff_id: string | null
          editor_staff_id: string | null
          id: string
          modified_date: string | null
          name: string
          pending_changes: Json
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          contact_email?: string | null
          contact_person?: string | null
          contact_phone?: string | null
          created_at?: string | null
          created_date?: string | null
          creator_staff_id?: string | null
          editor_staff_id?: string | null
          id?: string
          modified_date?: string | null
          name: string
          pending_changes?: Json
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          contact_email?: string | null
          contact_person?: string | null
          contact_phone?: string | null
          created_at?: string | null
          created_date?: string | null
          creator_staff_id?: string | null
          editor_staff_id?: string | null
          id?: string
          modified_date?: string | null
          name?: string
          pending_changes?: Json
          updated_at?: string | null
        }
        Relationships: []
      }
      delivery_terms: {
        Row: {
          created_at: string | null
          created_date: string | null
          creator_staff_id: string | null
          editor_staff_id: string | null
          id: string
          max_days: number
          min_days: number
          modified_date: string | null
          name: string
          parent_id: string | null
          sort_order: number
          type: Database["public"]["Enums"]["delivery_term_type"]
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_date?: string | null
          creator_staff_id?: string | null
          editor_staff_id?: string | null
          id?: string
          max_days?: number
          min_days?: number
          modified_date?: string | null
          name: string
          parent_id?: string | null
          sort_order?: number
          type?: Database["public"]["Enums"]["delivery_term_type"]
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_date?: string | null
          creator_staff_id?: string | null
          editor_staff_id?: string | null
          id?: string
          max_days?: number
          min_days?: number
          modified_date?: string | null
          name?: string
          parent_id?: string | null
          sort_order?: number
          type?: Database["public"]["Enums"]["delivery_term_type"]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_terms_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "delivery_terms"
            referencedColumns: ["id"]
          },
        ]
      }
      design_projects: {
        Row: {
          active_scheme: string
          client_company: string | null
          client_name: string | null
          created_at: string | null
          created_by: string | null
          created_date: string | null
          creator_staff_id: string | null
          editor_staff_id: string | null
          floor_plan_type: string | null
          floor_plan_url: string | null
          id: string
          meta: Json
          modified_date: string | null
          name: string
          progress: number
          status: string
          updated_at: string | null
        }
        Insert: {
          active_scheme?: string
          client_company?: string | null
          client_name?: string | null
          created_at?: string | null
          created_by?: string | null
          created_date?: string | null
          creator_staff_id?: string | null
          editor_staff_id?: string | null
          floor_plan_type?: string | null
          floor_plan_url?: string | null
          id?: string
          meta?: Json
          modified_date?: string | null
          name: string
          progress?: number
          status?: string
          updated_at?: string | null
        }
        Update: {
          active_scheme?: string
          client_company?: string | null
          client_name?: string | null
          created_at?: string | null
          created_by?: string | null
          created_date?: string | null
          creator_staff_id?: string | null
          editor_staff_id?: string | null
          floor_plan_type?: string | null
          floor_plan_url?: string | null
          id?: string
          meta?: Json
          modified_date?: string | null
          name?: string
          progress?: number
          status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      factory_correction_patterns: {
        Row: {
          confidence: number | null
          corrected_value: string
          correction_context: Json | null
          created_at: string | null
          created_date: string | null
          creator_staff_id: string | null
          editor_staff_id: string | null
          factory_id: string
          factory_name: string
          field_name: string
          id: string
          model_number: string | null
          modified_date: string | null
          occurrence_count: number | null
          original_value: string | null
          updated_at: string | null
        }
        Insert: {
          confidence?: number | null
          corrected_value: string
          correction_context?: Json | null
          created_at?: string | null
          created_date?: string | null
          creator_staff_id?: string | null
          editor_staff_id?: string | null
          factory_id: string
          factory_name: string
          field_name: string
          id?: string
          model_number?: string | null
          modified_date?: string | null
          occurrence_count?: number | null
          original_value?: string | null
          updated_at?: string | null
        }
        Update: {
          confidence?: number | null
          corrected_value?: string
          correction_context?: Json | null
          created_at?: string | null
          created_date?: string | null
          creator_staff_id?: string | null
          editor_staff_id?: string | null
          factory_id?: string
          factory_name?: string
          field_name?: string
          id?: string
          model_number?: string | null
          modified_date?: string | null
          occurrence_count?: number | null
          original_value?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      login_log: {
        Row: {
          event: string
          id: string
          logged_at: string
          login_method: string
          user_email: string | null
          user_id: string
          user_name: string | null
        }
        Insert: {
          event?: string
          id?: string
          logged_at?: string
          login_method?: string
          user_email?: string | null
          user_id: string
          user_name?: string | null
        }
        Update: {
          event?: string
          id?: string
          logged_at?: string
          login_method?: string
          user_email?: string | null
          user_id?: string
          user_name?: string | null
        }
        Relationships: []
      }
      platform_user_profiles: {
        Row: {
          active: boolean
          auth_user_id: string | null
          created_at: string
          display_name: string | null
          email: string
          id: string
          last_login_at: string | null
          role: string
          source: string
          staff_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          auth_user_id?: string | null
          created_at?: string
          display_name?: string | null
          email: string
          id?: string
          last_login_at?: string | null
          role?: string
          source?: string
          staff_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          auth_user_id?: string | null
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
          last_login_at?: string | null
          role?: string
          source?: string
          staff_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      pms_sso_codes: {
        Row: {
          code: string
          created_at: string
          email: string
          expires_at: string
          id: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          email: string
          expires_at: string
          id?: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      processing_jobs: {
        Row: {
          attempts: number
          cost_actual: number | null
          cost_estimate: number | null
          created_at: string
          creator_staff_id: string | null
          document_id: string | null
          error: string | null
          error_log: Json
          finished_at: string | null
          heartbeat_at: string | null
          id: string
          idempotency_key: string | null
          job_type: string
          max_attempts: number
          ocr_pages: number | null
          pages: number | null
          payload: Json
          progress: number
          result: Json | null
          run_after: string
          started_at: string | null
          status: string
          tokens: number | null
          updated_at: string
          worker: string | null
        }
        Insert: {
          attempts?: number
          cost_actual?: number | null
          cost_estimate?: number | null
          created_at?: string
          creator_staff_id?: string | null
          document_id?: string | null
          error?: string | null
          error_log?: Json
          finished_at?: string | null
          heartbeat_at?: string | null
          id?: string
          idempotency_key?: string | null
          job_type: string
          max_attempts?: number
          ocr_pages?: number | null
          pages?: number | null
          payload?: Json
          progress?: number
          result?: Json | null
          run_after?: string
          started_at?: string | null
          status?: string
          tokens?: number | null
          updated_at?: string
          worker?: string | null
        }
        Update: {
          attempts?: number
          cost_actual?: number | null
          cost_estimate?: number | null
          created_at?: string
          creator_staff_id?: string | null
          document_id?: string | null
          error?: string | null
          error_log?: Json
          finished_at?: string | null
          heartbeat_at?: string | null
          id?: string
          idempotency_key?: string | null
          job_type?: string
          max_attempts?: number
          ocr_pages?: number | null
          pages?: number | null
          payload?: Json
          progress?: number
          result?: Json | null
          run_after?: string
          started_at?: string | null
          status?: string
          tokens?: number | null
          updated_at?: string
          worker?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "processing_jobs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "supplier_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      product_category: {
        Row: {
          created_at: string | null
          created_date: string | null
          creator_staff_id: string | null
          editor_staff_id: string | null
          id: string
          level1: string
          level2: string
          modified_date: string | null
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_date?: string | null
          creator_staff_id?: string | null
          editor_staff_id?: string | null
          id?: string
          level1: string
          level2: string
          modified_date?: string | null
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_date?: string | null
          creator_staff_id?: string | null
          editor_staff_id?: string | null
          id?: string
          level1?: string
          level2?: string
          modified_date?: string | null
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      product_discussions: {
        Row: {
          author: string
          author_role: string
          body: string
          created_at: string | null
          created_date: string | null
          creator_staff_id: string | null
          editor_staff_id: string | null
          id: string
          mentions: string[]
          modified_date: string | null
          project_id: string
          zone_product_id: string | null
        }
        Insert: {
          author: string
          author_role?: string
          body: string
          created_at?: string | null
          created_date?: string | null
          creator_staff_id?: string | null
          editor_staff_id?: string | null
          id?: string
          mentions?: string[]
          modified_date?: string | null
          project_id: string
          zone_product_id?: string | null
        }
        Update: {
          author?: string
          author_role?: string
          body?: string
          created_at?: string | null
          created_date?: string | null
          creator_staff_id?: string | null
          editor_staff_id?: string | null
          id?: string
          mentions?: string[]
          modified_date?: string | null
          project_id?: string
          zone_product_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_discussions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "design_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_discussions_zone_product_id_fkey"
            columns: ["zone_product_id"]
            isOneToOne: false
            referencedRelation: "zone_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          color: string
          created_date: string | null
          creator_staff_id: string | null
          editor_staff_id: string | null
          id: string
          inventory: number
          modified_date: string | null
          price: number
          product_id: string
          size: string
          sku: string
        }
        Insert: {
          color?: string
          created_date?: string | null
          creator_staff_id?: string | null
          editor_staff_id?: string | null
          id: string
          inventory?: number
          modified_date?: string | null
          price?: number
          product_id: string
          size?: string
          sku?: string
        }
        Update: {
          color?: string
          created_date?: string | null
          creator_staff_id?: string | null
          editor_staff_id?: string | null
          id?: string
          inventory?: number
          modified_date?: string | null
          price?: number
          product_id?: string
          size?: string
          sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          bwf_master_id: string | null
          category: string | null
          collection: string
          color: string | null
          compare_at_price: number | null
          copy_done: boolean
          copy_done_at: string | null
          copy_queued_at: string | null
          cost_price: number | null
          created_at: string
          created_date: string | null
          creator_staff_id: string | null
          customize: string | null
          delivery_term_id: string | null
          delivery_term_name: string | null
          description: string
          description_html: string | null
          dimension_h_mm: number | null
          dimension_l_mm: number | null
          dimension_w_mm: number | null
          dismissed: boolean
          editor_staff_id: string | null
          error_message: string | null
          factories_display_name: string | null
          factory_highlights: string[] | null
          factory_id: string | null
          id: string
          image_url: string
          image_url_2: string | null
          image_url_3: string | null
          images: Json | null
          in_catalog: boolean
          in_shopify_queue: boolean
          in_stock: boolean | null
          info_done: boolean
          level1_category: string | null
          level2_category: string | null
          lifestyle_image_url: string | null
          material: string | null
          model: string | null
          modified_date: string | null
          price: number
          product_category_id: string | null
          product_sku: string | null
          production_date: number | null
          ready_to_publish: boolean
          remarks: string | null
          revert_reason: Json | null
          sale_price: number | null
          shipping_days: number | null
          shipping_fee: number | null
          shopify_product_id: string | null
          shopify_synced_data: Json | null
          sku: string | null
          source: string
          specifications: string | null
          status: string
          synced_at: string | null
          tags: string[]
          title: string
          total_lead_time: number | null
          upload_session_id: string | null
        }
        Insert: {
          bwf_master_id?: string | null
          category?: string | null
          collection?: string
          color?: string | null
          compare_at_price?: number | null
          copy_done?: boolean
          copy_done_at?: string | null
          copy_queued_at?: string | null
          cost_price?: number | null
          created_at?: string
          created_date?: string | null
          creator_staff_id?: string | null
          customize?: string | null
          delivery_term_id?: string | null
          delivery_term_name?: string | null
          description?: string
          description_html?: string | null
          dimension_h_mm?: number | null
          dimension_l_mm?: number | null
          dimension_w_mm?: number | null
          dismissed?: boolean
          editor_staff_id?: string | null
          error_message?: string | null
          factories_display_name?: string | null
          factory_highlights?: string[] | null
          factory_id?: string | null
          id: string
          image_url?: string
          image_url_2?: string | null
          image_url_3?: string | null
          images?: Json | null
          in_catalog?: boolean
          in_shopify_queue?: boolean
          in_stock?: boolean | null
          info_done?: boolean
          level1_category?: string | null
          level2_category?: string | null
          lifestyle_image_url?: string | null
          material?: string | null
          model?: string | null
          modified_date?: string | null
          price?: number
          product_category_id?: string | null
          product_sku?: string | null
          production_date?: number | null
          ready_to_publish?: boolean
          remarks?: string | null
          revert_reason?: Json | null
          sale_price?: number | null
          shipping_days?: number | null
          shipping_fee?: number | null
          shopify_product_id?: string | null
          shopify_synced_data?: Json | null
          sku?: string | null
          source?: string
          specifications?: string | null
          status?: string
          synced_at?: string | null
          tags?: string[]
          title: string
          total_lead_time?: number | null
          upload_session_id?: string | null
        }
        Update: {
          bwf_master_id?: string | null
          category?: string | null
          collection?: string
          color?: string | null
          compare_at_price?: number | null
          copy_done?: boolean
          copy_done_at?: string | null
          copy_queued_at?: string | null
          cost_price?: number | null
          created_at?: string
          created_date?: string | null
          creator_staff_id?: string | null
          customize?: string | null
          delivery_term_id?: string | null
          delivery_term_name?: string | null
          description?: string
          description_html?: string | null
          dimension_h_mm?: number | null
          dimension_l_mm?: number | null
          dimension_w_mm?: number | null
          dismissed?: boolean
          editor_staff_id?: string | null
          error_message?: string | null
          factories_display_name?: string | null
          factory_highlights?: string[] | null
          factory_id?: string | null
          id?: string
          image_url?: string
          image_url_2?: string | null
          image_url_3?: string | null
          images?: Json | null
          in_catalog?: boolean
          in_shopify_queue?: boolean
          in_stock?: boolean | null
          info_done?: boolean
          level1_category?: string | null
          level2_category?: string | null
          lifestyle_image_url?: string | null
          material?: string | null
          model?: string | null
          modified_date?: string | null
          price?: number
          product_category_id?: string | null
          product_sku?: string | null
          production_date?: number | null
          ready_to_publish?: boolean
          remarks?: string | null
          revert_reason?: Json | null
          sale_price?: number | null
          shipping_days?: number | null
          shipping_fee?: number | null
          shopify_product_id?: string | null
          shopify_synced_data?: Json | null
          sku?: string | null
          source?: string
          specifications?: string | null
          status?: string
          synced_at?: string | null
          tags?: string[]
          title?: string
          total_lead_time?: number | null
          upload_session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_delivery_term_id_fkey"
            columns: ["delivery_term_id"]
            isOneToOne: false
            referencedRelation: "delivery_terms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_product_category_id_fkey"
            columns: ["product_category_id"]
            isOneToOne: false
            referencedRelation: "product_category"
            referencedColumns: ["id"]
          },
        ]
      }
      project_invitations: {
        Row: {
          channel: string
          created_at: string | null
          created_date: string | null
          creator_staff_id: string | null
          editor_staff_id: string | null
          email: string | null
          id: string
          modified_date: string | null
          project_id: string
          share_token: string
          status: string
          viewed_at: string | null
        }
        Insert: {
          channel?: string
          created_at?: string | null
          created_date?: string | null
          creator_staff_id?: string | null
          editor_staff_id?: string | null
          email?: string | null
          id?: string
          modified_date?: string | null
          project_id: string
          share_token: string
          status?: string
          viewed_at?: string | null
        }
        Update: {
          channel?: string
          created_at?: string | null
          created_date?: string | null
          creator_staff_id?: string | null
          editor_staff_id?: string | null
          email?: string | null
          id?: string
          modified_date?: string | null
          project_id?: string
          share_token?: string
          status?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_invitations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "design_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_zones: {
        Row: {
          ai_suggested: boolean
          bounds: Json
          code: string | null
          created_at: string | null
          created_date: string | null
          creator_staff_id: string | null
          editor_staff_id: string | null
          id: string
          modified_date: string | null
          name: string
          project_id: string
          sort_order: number
        }
        Insert: {
          ai_suggested?: boolean
          bounds?: Json
          code?: string | null
          created_at?: string | null
          created_date?: string | null
          creator_staff_id?: string | null
          editor_staff_id?: string | null
          id?: string
          modified_date?: string | null
          name: string
          project_id: string
          sort_order?: number
        }
        Update: {
          ai_suggested?: boolean
          bounds?: Json
          code?: string | null
          created_at?: string | null
          created_date?: string | null
          creator_staff_id?: string | null
          editor_staff_id?: string | null
          id?: string
          modified_date?: string | null
          name?: string
          project_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_zones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "design_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      ready_to_shopify: {
        Row: {
          body_html: string | null
          checked_edited_at: string | null
          color: string | null
          compare_at_price: number | null
          configurable: string | null
          copy_done: boolean
          copy_done_at: string | null
          copy_queued_at: string | null
          cost: number | null
          customize: string | null
          dimension_h_mm: number | null
          dimension_l_mm: number | null
          dimension_w_mm: number | null
          factory_id: string | null
          furniture_group_checked: boolean | null
          handle: string | null
          id: string
          image_url: string | null
          images: Json | null
          imported_at: string
          in_shopify_queue: boolean
          in_stock: boolean | null
          info_completed_at: string | null
          info_done: boolean
          material: string | null
          "my_fields.materials": string | null
          price: number | null
          product_id: string | null
          product_type: string | null
          production_time: string | null
          published_at: string | null
          ready_to_publish_at: string | null
          rejected: boolean
          remarks: string | null
          revert_reason: Json | null
          shop_domain: string | null
          shopify_created_at: string | null
          shopify_page_description: string | null
          shopify_page_title: string | null
          shopify_product_id: string | null
          shopify_updated_at: string | null
          shopify_url: string | null
          sku: string | null
          status: string | null
          tags: string[] | null
          title: string | null
          variants: Json | null
          vendor: string | null
        }
        Insert: {
          body_html?: string | null
          checked_edited_at?: string | null
          color?: string | null
          compare_at_price?: number | null
          configurable?: string | null
          copy_done?: boolean
          copy_done_at?: string | null
          copy_queued_at?: string | null
          cost?: number | null
          customize?: string | null
          dimension_h_mm?: number | null
          dimension_l_mm?: number | null
          dimension_w_mm?: number | null
          factory_id?: string | null
          furniture_group_checked?: boolean | null
          handle?: string | null
          id?: string
          image_url?: string | null
          images?: Json | null
          imported_at?: string
          in_shopify_queue?: boolean
          in_stock?: boolean | null
          info_completed_at?: string | null
          info_done?: boolean
          material?: string | null
          "my_fields.materials"?: string | null
          price?: number | null
          product_id?: string | null
          product_type?: string | null
          production_time?: string | null
          published_at?: string | null
          ready_to_publish_at?: string | null
          rejected?: boolean
          remarks?: string | null
          revert_reason?: Json | null
          shop_domain?: string | null
          shopify_created_at?: string | null
          shopify_page_description?: string | null
          shopify_page_title?: string | null
          shopify_product_id?: string | null
          shopify_updated_at?: string | null
          shopify_url?: string | null
          sku?: string | null
          status?: string | null
          tags?: string[] | null
          title?: string | null
          variants?: Json | null
          vendor?: string | null
        }
        Update: {
          body_html?: string | null
          checked_edited_at?: string | null
          color?: string | null
          compare_at_price?: number | null
          configurable?: string | null
          copy_done?: boolean
          copy_done_at?: string | null
          copy_queued_at?: string | null
          cost?: number | null
          customize?: string | null
          dimension_h_mm?: number | null
          dimension_l_mm?: number | null
          dimension_w_mm?: number | null
          factory_id?: string | null
          furniture_group_checked?: boolean | null
          handle?: string | null
          id?: string
          image_url?: string | null
          images?: Json | null
          imported_at?: string
          in_shopify_queue?: boolean
          in_stock?: boolean | null
          info_completed_at?: string | null
          info_done?: boolean
          material?: string | null
          "my_fields.materials"?: string | null
          price?: number | null
          product_id?: string | null
          product_type?: string | null
          production_time?: string | null
          published_at?: string | null
          ready_to_publish_at?: string | null
          rejected?: boolean
          remarks?: string | null
          revert_reason?: Json | null
          shop_domain?: string | null
          shopify_created_at?: string | null
          shopify_page_description?: string | null
          shopify_page_title?: string | null
          shopify_product_id?: string | null
          shopify_updated_at?: string | null
          shopify_url?: string | null
          sku?: string | null
          status?: string | null
          tags?: string[] | null
          title?: string | null
          variants?: Json | null
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ready_to_shopify_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      rejectedd_products: {
        Row: {
          bwf_master_id: string | null
          category: string | null
          collection: string | null
          color: string | null
          compare_at_price: number | null
          cost_price: number | null
          customize: string | null
          delivery_term_id: string | null
          delivery_term_name: string | null
          description: string | null
          description_html: string | null
          dimension_h_mm: number | null
          dimension_l_mm: number | null
          dimension_w_mm: number | null
          factories_display_name: string | null
          factory_id: string | null
          id: string
          image_url: string | null
          images: Json | null
          in_stock: boolean | null
          level1_category: string | null
          level2_category: string | null
          material: string | null
          model: string | null
          original_product_id: string | null
          price: number | null
          product_sku: string | null
          production_lead_time: number | null
          production_time: string | null
          rejected_at: string
          rejection_source: string | null
          remarks: string | null
          sale_price: number | null
          shipping_days: number | null
          shipping_fee: number | null
          shopify_product_id: string | null
          source: string | null
          specifications: string | null
          status: string | null
          synced_at: string | null
          tags: string[] | null
          title: string | null
          total_lead_time: number | null
          variants: Json | null
        }
        Insert: {
          bwf_master_id?: string | null
          category?: string | null
          collection?: string | null
          color?: string | null
          compare_at_price?: number | null
          cost_price?: number | null
          customize?: string | null
          delivery_term_id?: string | null
          delivery_term_name?: string | null
          description?: string | null
          description_html?: string | null
          dimension_h_mm?: number | null
          dimension_l_mm?: number | null
          dimension_w_mm?: number | null
          factories_display_name?: string | null
          factory_id?: string | null
          id?: string
          image_url?: string | null
          images?: Json | null
          in_stock?: boolean | null
          level1_category?: string | null
          level2_category?: string | null
          material?: string | null
          model?: string | null
          original_product_id?: string | null
          price?: number | null
          product_sku?: string | null
          production_lead_time?: number | null
          production_time?: string | null
          rejected_at?: string
          rejection_source?: string | null
          remarks?: string | null
          sale_price?: number | null
          shipping_days?: number | null
          shipping_fee?: number | null
          shopify_product_id?: string | null
          source?: string | null
          specifications?: string | null
          status?: string | null
          synced_at?: string | null
          tags?: string[] | null
          title?: string | null
          total_lead_time?: number | null
          variants?: Json | null
        }
        Update: {
          bwf_master_id?: string | null
          category?: string | null
          collection?: string | null
          color?: string | null
          compare_at_price?: number | null
          cost_price?: number | null
          customize?: string | null
          delivery_term_id?: string | null
          delivery_term_name?: string | null
          description?: string | null
          description_html?: string | null
          dimension_h_mm?: number | null
          dimension_l_mm?: number | null
          dimension_w_mm?: number | null
          factories_display_name?: string | null
          factory_id?: string | null
          id?: string
          image_url?: string | null
          images?: Json | null
          in_stock?: boolean | null
          level1_category?: string | null
          level2_category?: string | null
          material?: string | null
          model?: string | null
          original_product_id?: string | null
          price?: number | null
          product_sku?: string | null
          production_lead_time?: number | null
          production_time?: string | null
          rejected_at?: string
          rejection_source?: string | null
          remarks?: string | null
          sale_price?: number | null
          shipping_days?: number | null
          shipping_fee?: number | null
          shopify_product_id?: string | null
          source?: string | null
          specifications?: string | null
          status?: string | null
          synced_at?: string | null
          tags?: string[] | null
          title?: string | null
          total_lead_time?: number | null
          variants?: Json | null
        }
        Relationships: []
      }
      shopify_connections: {
        Row: {
          access_token: string
          client_id: string | null
          client_secret: string | null
          connected_at: string | null
          is_active: boolean | null
          last_refresh_error: string | null
          refresh_attempt_count: number | null
          refresh_token: string | null
          refresh_token_expires_at: string | null
          scope: string | null
          shop_domain: string
          token_expires_at: string | null
          updated_at: string | null
        }
        Insert: {
          access_token: string
          client_id?: string | null
          client_secret?: string | null
          connected_at?: string | null
          is_active?: boolean | null
          last_refresh_error?: string | null
          refresh_attempt_count?: number | null
          refresh_token?: string | null
          refresh_token_expires_at?: string | null
          scope?: string | null
          shop_domain: string
          token_expires_at?: string | null
          updated_at?: string | null
        }
        Update: {
          access_token?: string
          client_id?: string | null
          client_secret?: string | null
          connected_at?: string | null
          is_active?: boolean | null
          last_refresh_error?: string | null
          refresh_attempt_count?: number | null
          refresh_token?: string | null
          refresh_token_expires_at?: string | null
          scope?: string | null
          shop_domain?: string
          token_expires_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      shopify_products: {
        Row: {
          body_html: string | null
          compare_at_price: number | null
          configurable: string | null
          cost: number | null
          "custom.more_image_alt_1": string | null
          "custom.more_image_alt_2": string | null
          "custom.more_image_alt_3": string | null
          "custom.more_image_alt_4": string | null
          "custom.more_image_link_1": string | null
          "custom.more_image_link_2": string | null
          "custom.more_image_link_3": string | null
          "custom.more_image_link_4": string | null
          customize: string | null
          handle: string | null
          id: string
          image_url: string | null
          images: Json | null
          imported_at: string
          in_stock: boolean | null
          metafields: Json | null
          "my_fields.image_alt": string | null
          "my_fields.image_link": string | null
          "my_fields.materials": string | null
          "my_fields.more_recommend_size": string | null
          "my_fields.normal_size": string | null
          "my_fields.production_time": string | null
          "my_fields.recommend_size": string | null
          "my_fields.video_link": string | null
          options: Json | null
          price: number | null
          product_type: string | null
          published_at: string | null
          ready_to_shopify_id: string | null
          shop_domain: string | null
          shopify_created_at: string | null
          shopify_page_description: string | null
          shopify_page_title: string | null
          shopify_product_id: string
          shopify_updated_at: string | null
          shopify_url: string | null
          "shopify.color-pattern": string | null
          sku: string | null
          source_product_id: string | null
          status: string | null
          tags: string[] | null
          title: string | null
          variants: Json | null
          vendor: string | null
        }
        Insert: {
          body_html?: string | null
          compare_at_price?: number | null
          configurable?: string | null
          cost?: number | null
          "custom.more_image_alt_1"?: string | null
          "custom.more_image_alt_2"?: string | null
          "custom.more_image_alt_3"?: string | null
          "custom.more_image_alt_4"?: string | null
          "custom.more_image_link_1"?: string | null
          "custom.more_image_link_2"?: string | null
          "custom.more_image_link_3"?: string | null
          "custom.more_image_link_4"?: string | null
          customize?: string | null
          handle?: string | null
          id?: string
          image_url?: string | null
          images?: Json | null
          imported_at?: string
          in_stock?: boolean | null
          metafields?: Json | null
          "my_fields.image_alt"?: string | null
          "my_fields.image_link"?: string | null
          "my_fields.materials"?: string | null
          "my_fields.more_recommend_size"?: string | null
          "my_fields.normal_size"?: string | null
          "my_fields.production_time"?: string | null
          "my_fields.recommend_size"?: string | null
          "my_fields.video_link"?: string | null
          options?: Json | null
          price?: number | null
          product_type?: string | null
          published_at?: string | null
          ready_to_shopify_id?: string | null
          shop_domain?: string | null
          shopify_created_at?: string | null
          shopify_page_description?: string | null
          shopify_page_title?: string | null
          shopify_product_id: string
          shopify_updated_at?: string | null
          shopify_url?: string | null
          "shopify.color-pattern"?: string | null
          sku?: string | null
          source_product_id?: string | null
          status?: string | null
          tags?: string[] | null
          title?: string | null
          variants?: Json | null
          vendor?: string | null
        }
        Update: {
          body_html?: string | null
          compare_at_price?: number | null
          configurable?: string | null
          cost?: number | null
          "custom.more_image_alt_1"?: string | null
          "custom.more_image_alt_2"?: string | null
          "custom.more_image_alt_3"?: string | null
          "custom.more_image_alt_4"?: string | null
          "custom.more_image_link_1"?: string | null
          "custom.more_image_link_2"?: string | null
          "custom.more_image_link_3"?: string | null
          "custom.more_image_link_4"?: string | null
          customize?: string | null
          handle?: string | null
          id?: string
          image_url?: string | null
          images?: Json | null
          imported_at?: string
          in_stock?: boolean | null
          metafields?: Json | null
          "my_fields.image_alt"?: string | null
          "my_fields.image_link"?: string | null
          "my_fields.materials"?: string | null
          "my_fields.more_recommend_size"?: string | null
          "my_fields.normal_size"?: string | null
          "my_fields.production_time"?: string | null
          "my_fields.recommend_size"?: string | null
          "my_fields.video_link"?: string | null
          options?: Json | null
          price?: number | null
          product_type?: string | null
          published_at?: string | null
          ready_to_shopify_id?: string | null
          shop_domain?: string | null
          shopify_created_at?: string | null
          shopify_page_description?: string | null
          shopify_page_title?: string | null
          shopify_product_id?: string
          shopify_updated_at?: string | null
          shopify_url?: string | null
          "shopify.color-pattern"?: string | null
          sku?: string | null
          source_product_id?: string | null
          status?: string | null
          tags?: string[] | null
          title?: string | null
          variants?: Json | null
          vendor?: string | null
        }
        Relationships: []
      }
      supplier_documents: {
        Row: {
          content_hash: string | null
          created_at: string
          created_date: string
          creator_staff_id: string | null
          currency: string | null
          doc_type: string
          editor_staff_id: string | null
          error_message: string | null
          factory_id: string | null
          factory_name: string
          file_size: number | null
          id: string
          modified_date: string
          page_count: number | null
          page_offset: number
          parent_document_id: string | null
          part_count: number | null
          part_index: number | null
          parts_done: number | null
          source: string
          status: string
          storage_path: string
          title: string | null
        }
        Insert: {
          content_hash?: string | null
          created_at?: string
          created_date?: string
          creator_staff_id?: string | null
          currency?: string | null
          doc_type?: string
          editor_staff_id?: string | null
          error_message?: string | null
          factory_id?: string | null
          factory_name?: string
          file_size?: number | null
          id?: string
          modified_date?: string
          page_count?: number | null
          page_offset?: number
          parent_document_id?: string | null
          part_count?: number | null
          part_index?: number | null
          parts_done?: number | null
          source?: string
          status?: string
          storage_path: string
          title?: string | null
        }
        Update: {
          content_hash?: string | null
          created_at?: string
          created_date?: string
          creator_staff_id?: string | null
          currency?: string | null
          doc_type?: string
          editor_staff_id?: string | null
          error_message?: string | null
          factory_id?: string | null
          factory_name?: string
          file_size?: number | null
          id?: string
          modified_date?: string
          page_count?: number | null
          page_offset?: number
          parent_document_id?: string | null
          part_count?: number | null
          part_index?: number | null
          parts_done?: number | null
          source?: string
          status?: string
          storage_path?: string
          title?: string | null
        }
        Relationships: []
      }
      upload_log: {
        Row: {
          action: string
          id: string
          logged_at: string
          page_label: string | null
          product_id: string | null
          product_sku: string | null
          rts_id: string | null
          stage: string
          user_email: string | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          action: string
          id?: string
          logged_at?: string
          page_label?: string | null
          product_id?: string | null
          product_sku?: string | null
          rts_id?: string | null
          stage: string
          user_email?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          action?: string
          id?: string
          logged_at?: string
          page_label?: string | null
          product_id?: string | null
          product_sku?: string | null
          rts_id?: string | null
          stage?: string
          user_email?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "upload_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      zone_products: {
        Row: {
          created_at: string | null
          created_date: string | null
          creator_staff_id: string | null
          dimension_h_mm: number | null
          dimension_l_mm: number | null
          dimension_w_mm: number | null
          editor_staff_id: string | null
          id: string
          modified_date: string | null
          notes: string
          product_id: string | null
          product_image_url: string | null
          product_title: string | null
          project_id: string
          quantity: number
          sale_price: number | null
          scheme: string
          sort_order: number
          status: string
          zone_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_date?: string | null
          creator_staff_id?: string | null
          dimension_h_mm?: number | null
          dimension_l_mm?: number | null
          dimension_w_mm?: number | null
          editor_staff_id?: string | null
          id?: string
          modified_date?: string | null
          notes?: string
          product_id?: string | null
          product_image_url?: string | null
          product_title?: string | null
          project_id: string
          quantity?: number
          sale_price?: number | null
          scheme?: string
          sort_order?: number
          status?: string
          zone_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_date?: string | null
          creator_staff_id?: string | null
          dimension_h_mm?: number | null
          dimension_l_mm?: number | null
          dimension_w_mm?: number | null
          editor_staff_id?: string | null
          id?: string
          modified_date?: string | null
          notes?: string
          product_id?: string | null
          product_image_url?: string | null
          product_title?: string | null
          project_id?: string
          quantity?: number
          sale_price?: number | null
          scheme?: string
          sort_order?: number
          status?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "zone_products_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "design_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zone_products_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "project_zones"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bwf_assert_platform_admin: { Args: never; Returns: undefined }
      bwf_assert_role: { Args: { p_roles: string[] }; Returns: undefined }
      bwf_current_staff_id: { Args: never; Returns: string }
      bwf_dev_command_log_complete: {
        Args: {
          p_cached_input_tokens?: number
          p_completed_at?: string
          p_cost_usd?: number
          p_credits_used?: number
          p_failure_reason?: string
          p_id: string
          p_input_tokens?: number
          p_model?: string
          p_output_tokens?: number
          p_result_summary?: string
          p_status: string
        }
        Returns: Json
      }
      bwf_dev_command_log_delete: { Args: { p_id: string }; Returns: undefined }
      bwf_dev_command_log_start: {
        Args: {
          p_developer_email: string
          p_instruction_text: string
          p_model?: string
          p_task_reference?: string
        }
        Returns: Json
      }
      bwf_dev_command_logs_analytics: {
        Args: { p_developer_email?: string; p_from?: string; p_to?: string }
        Returns: Json
      }
      bwf_dev_command_logs_list: {
        Args: {
          p_developer_email?: string
          p_from?: string
          p_limit?: number
          p_model?: string
          p_offset?: number
          p_search?: string
          p_status?: string
          p_to?: string
        }
        Returns: Json
      }
      bwf_development_cost_overview: { Args: never; Returns: Json }
      bwf_development_cost_save_rate: {
        Args: {
          p_effective_from: string
          p_expected_revision: number
          p_hourly_rate: number
          p_reason: string
        }
        Returns: Json
      }
      bwf_development_cost_span: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      bwf_development_rate_for_date: {
        Args: { p_date: string }
        Returns: number
      }
      bwf_has_role: { Args: { p_roles: string[] }; Returns: boolean }
      bwf_quote_items_json_to_rpc: { Args: { p_items: Json }; Returns: Json }
      factory_counts: {
        Args: { p_source: string }
        Returns: {
          cnt: number
          factory_name: string
        }[]
      }
      fds_processing_job_cancel: { Args: { p_job_id: string }; Returns: Json }
      fds_processing_job_complete: {
        Args: {
          p_cost_actual?: number
          p_document_status?: string
          p_job_id: string
          p_ocr_pages?: number
          p_pages?: number
          p_result?: Json
          p_tokens?: number
        }
        Returns: boolean
      }
      fds_processing_job_fail: {
        Args: { p_error: string; p_job_id: string; p_retryable?: boolean }
        Returns: string
      }
      fds_processing_job_heartbeat: {
        Args: { p_job_id: string; p_progress?: number }
        Returns: string
      }
      fds_processing_jobs_claim: {
        Args: {
          p_job_types: string[]
          p_limit?: number
          p_max_running?: number
          p_stale_after?: string
          p_worker?: string
        }
        Returns: {
          attempts: number
          cost_actual: number | null
          cost_estimate: number | null
          created_at: string
          creator_staff_id: string | null
          document_id: string | null
          error: string | null
          error_log: Json
          finished_at: string | null
          heartbeat_at: string | null
          id: string
          idempotency_key: string | null
          job_type: string
          max_attempts: number
          ocr_pages: number | null
          pages: number | null
          payload: Json
          progress: number
          result: Json | null
          run_after: string
          started_at: string | null
          status: string
          tokens: number | null
          updated_at: string
          worker: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "processing_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      fds_supplier_document_create: {
        Args: {
          p_content_hash?: string
          p_currency?: string
          p_doc_type?: string
          p_enqueue?: boolean
          p_factory_id?: string
          p_factory_name?: string
          p_source?: string
          p_storage_path: string
          p_title?: string
        }
        Returns: Json
      }
      fds_supplier_document_enqueue_parse: {
        Args: { p_document_id: string }
        Returns: Json
      }
      fds_supplier_document_update: {
        Args: {
          p_currency?: string
          p_doc_type?: string
          p_document_id: string
          p_title?: string
        }
        Returns: undefined
      }
      fds_worker_verify_secret: { Args: { p_secret: string }; Returns: boolean }
      get_dashboard_stats: {
        Args: { month_end: string; month_start: string }
        Returns: {
          catalog_count: number
          copywriting_pending: number
          invites_this_month: number
          projects_this_month: number
          quotes_this_month: number
          tier_a: number
          tier_b: number
          tier_c: number
          uploaded_this_month: number
        }[]
      }
      get_fg_check_count: {
        Args: {
          p_factory?: string
          p_level1?: string
          p_level2?: string
          p_search?: string
        }
        Returns: number
      }
      get_fg_check_rows: {
        Args: {
          p_factory?: string
          p_level1?: string
          p_level2?: string
          p_limit?: number
          p_offset?: number
          p_search?: string
        }
        Returns: Json[]
      }
      get_products_image_migration_count: { Args: never; Returns: number }
      get_products_list_page: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: Json[]
      }
      get_publish_rts_count: {
        Args: {
          p_factories?: string[]
          p_level1?: string
          p_level2?: string
          p_rejected_only?: boolean
          p_search?: string
          p_stage: string
        }
        Returns: number
      }
      get_publish_rts_factories: {
        Args: { p_rejected_only?: boolean; p_stage: string }
        Returns: string[]
      }
      get_publish_rts_rows: {
        Args: {
          p_factories?: string[]
          p_level1?: string
          p_level2?: string
          p_limit?: number
          p_offset?: number
          p_rejected_only?: boolean
          p_search?: string
          p_stage: string
        }
        Returns: Json[]
      }
      get_ready_to_publish_count: {
        Args: {
          p_factory?: string
          p_level1?: string
          p_level2?: string
          p_search?: string
        }
        Returns: number
      }
      get_ready_to_publish_rows: {
        Args: {
          p_factory?: string
          p_level1?: string
          p_level2?: string
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_sort?: string
          p_sort_asc?: boolean
        }
        Returns: Json[]
      }
      get_rts_image_migration_batch: {
        Args: { p_limit?: number }
        Returns: {
          image_url: string
          images: Json
          product_id: string
        }[]
      }
      get_rts_image_migration_count: { Args: never; Returns: number }
      is_pdf_svg_placeholder: { Args: { p_url: string }; Returns: boolean }
      latest_quote_version_ids: {
        Args: { p_large_amount?: boolean }
        Returns: {
          id: string
        }[]
      }
      light_http_image_url: {
        Args: { prod_url: string; rts_url: string }
        Returns: string
      }
      product_category_counts: {
        Args: { p_factories?: string[]; p_mode?: string }
        Returns: {
          cnt: number
          level1: string
          level2: string
        }[]
      }
      product_duplicate_skus: {
        Args: { p_mode?: string }
        Returns: {
          cnt: number
          product_sku: string
        }[]
      }
      product_factory_names: {
        Args: { p_mode?: string }
        Returns: {
          cnt: number
          factory_name: string
        }[]
      }
      reconcile_category_registry: { Args: never; Returns: Json }
      resolve_product_category_id: {
        Args: { p_level1: string; p_level2: string }
        Returns: string
      }
      resolve_product_category_id_from_label: {
        Args: { p_fuzzy?: boolean; p_label: string }
        Returns: string
      }
      rts_row_needs_image_migration: {
        Args: { p_image_url: string; p_images: Json }
        Returns: boolean
      }
      save_bwf_quote_items: {
        Args: { p_items: Json; p_quote_uuid: string }
        Returns: undefined
      }
      shopify_published_category_counts: {
        Args: never
        Returns: {
          cnt: number
          level1: string
          level2: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      upsert_factory_correction: {
        Args: {
          p_context?: Json
          p_corrected_value: string
          p_factory_id: string
          p_factory_name: string
          p_field_name: string
          p_model_number?: string
          p_original_value: string
        }
        Returns: undefined
      }
    }
    Enums: {
      delivery_term_type: "stock" | "custom"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      delivery_term_type: ["stock", "custom"],
    },
  },
} as const
