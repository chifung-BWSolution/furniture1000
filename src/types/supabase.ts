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
      bwf_product_categories: {
        Row: {
          created_at: string | null
          id: string
          level: number
          name: string
          parent_id: string | null
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          level?: number
          name: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          level?: number
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
          pitching_name: string | null
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
          pitching_name?: string | null
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
          pitching_name?: string | null
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
          id: string
          quote_uuid: string
          sort_order: number
          client_item_id: string | null
          name: string
          image: string
          reference_image: string | null
          remarks_image: string | null
          unit_price: number
          quantity: number
          unit: string | null
          cost_price: number | null
          exchange_rate: number | null
          hkd_cost_price: number | null
          category: string | null
          material: string | null
          color: string | null
          remarks: string | null
          dimension_l_mm: number | null
          dimension_w_mm: number | null
          dimension_h_mm: number | null
          delivery_term_name: string | null
          factory_name: string | null
          factory_from_catalog: boolean | null
          is_custom_term: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          quote_uuid: string
          sort_order?: number
          client_item_id?: string | null
          name?: string
          image?: string
          reference_image?: string | null
          remarks_image?: string | null
          unit_price?: number
          quantity?: number
          unit?: string | null
          cost_price?: number | null
          exchange_rate?: number | null
          hkd_cost_price?: number | null
          category?: string | null
          material?: string | null
          color?: string | null
          remarks?: string | null
          dimension_l_mm?: number | null
          dimension_w_mm?: number | null
          dimension_h_mm?: number | null
          delivery_term_name?: string | null
          factory_name?: string | null
          factory_from_catalog?: boolean | null
          is_custom_term?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          quote_uuid?: string
          sort_order?: number
          client_item_id?: string | null
          name?: string
          image?: string
          reference_image?: string | null
          remarks_image?: string | null
          unit_price?: number
          quantity?: number
          unit?: string | null
          cost_price?: number | null
          exchange_rate?: number | null
          hkd_cost_price?: number | null
          category?: string | null
          material?: string | null
          color?: string | null
          remarks?: string | null
          dimension_l_mm?: number | null
          dimension_w_mm?: number | null
          dimension_h_mm?: number | null
          delivery_term_name?: string | null
          factory_name?: string | null
          factory_from_catalog?: boolean | null
          is_custom_term?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bwf_quote_item_quote_uuid_fkey"
            columns: ["quote_uuid"]
            isOneToOne: false
            referencedRelation: "bwf_quote"
            referencedColumns: ["id"]
          },
        ]
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
          cost_price: number | null
          created_at: string
          created_date: string | null
          creator_staff_id: string | null
          delivery_term_id: string | null
          delivery_term_name: string | null
          description: string
          description_html: string | null
          dimension_h_mm: number | null
          dimension_l_mm: number | null
          dimension_w_mm: number | null
          editor_staff_id: string | null
          error_message: string | null
          factories_display_name: string | null
          factory_id: string | null
          id: string
          image_url: string
          images: Json | null
          lifestyle_image_url: string | null
          material: string | null
          modified_date: string | null
          price: number
          production_date: string | null
          remarks: string | null
          sale_price: number | null
          shipping_days: number | null
          shipping_fee: number | null
          shopify_product_id: string | null
          shopify_synced_data: Json | null
          sku: string | null
          source: string
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
          cost_price?: number | null
          created_at?: string
          created_date?: string | null
          creator_staff_id?: string | null
          delivery_term_id?: string | null
          delivery_term_name?: string | null
          description?: string
          description_html?: string | null
          dimension_h_mm?: number | null
          dimension_l_mm?: number | null
          dimension_w_mm?: number | null
          editor_staff_id?: string | null
          error_message?: string | null
          factories_display_name?: string | null
          factory_id?: string | null
          id: string
          image_url?: string
          images?: Json | null
          lifestyle_image_url?: string | null
          material?: string | null
          modified_date?: string | null
          price?: number
          production_date?: string | null
          remarks?: string | null
          sale_price?: number | null
          shipping_days?: number | null
          shipping_fee?: number | null
          shopify_product_id?: string | null
          shopify_synced_data?: Json | null
          sku?: string | null
          source?: string
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
          cost_price?: number | null
          created_at?: string
          created_date?: string | null
          creator_staff_id?: string | null
          delivery_term_id?: string | null
          delivery_term_name?: string | null
          description?: string
          description_html?: string | null
          dimension_h_mm?: number | null
          dimension_l_mm?: number | null
          dimension_w_mm?: number | null
          editor_staff_id?: string | null
          error_message?: string | null
          factories_display_name?: string | null
          factory_id?: string | null
          id?: string
          image_url?: string
          images?: Json | null
          lifestyle_image_url?: string | null
          material?: string | null
          modified_date?: string | null
          price?: number
          production_date?: string | null
          remarks?: string | null
          sale_price?: number | null
          shipping_days?: number | null
          shipping_fee?: number | null
          shopify_product_id?: string | null
          shopify_synced_data?: Json | null
          sku?: string | null
          source?: string
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
        ]
      }
      shopify_connections: {
        Row: {
          access_token: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
      delivery_term_type: ["stock", "custom"],
    },
  },
} as const
