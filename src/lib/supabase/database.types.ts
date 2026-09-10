export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      _menufacil: {
        Row: {
          nombre: string | null;
          precio_cents: number | null;
          seccion: string | null;
        };
        Insert: {
          nombre?: string | null;
          precio_cents?: number | null;
          seccion?: string | null;
        };
        Update: {
          nombre?: string | null;
          precio_cents?: number | null;
          seccion?: string | null;
        };
        Relationships: [];
      };
      _mx_precios_20260528: {
        Row: {
          key: string;
          precio_cents: number;
        };
        Insert: {
          key: string;
          precio_cents: number;
        };
        Update: {
          key?: string;
          precio_cents?: number;
        };
        Relationships: [];
      };
      _mxemp: {
        Row: {
          apellido: string | null;
          codigo: number | null;
          fecha_baja: string | null;
          nivel: number | null;
          nombre: string | null;
          rinde: boolean | null;
          tipo: string | null;
        };
        Insert: {
          apellido?: string | null;
          codigo?: number | null;
          fecha_baja?: string | null;
          nivel?: number | null;
          nombre?: string | null;
          rinde?: boolean | null;
          tipo?: string | null;
        };
        Update: {
          apellido?: string | null;
          codigo?: number | null;
          fecha_baja?: string | null;
          nivel?: number | null;
          nombre?: string | null;
          rinde?: boolean | null;
          tipo?: string | null;
        };
        Relationships: [];
      };
      _price_backup_20260728: {
        Row: {
          id: string | null;
          name: string | null;
          price_cents: number | null;
          snapshot_at: string | null;
        };
        Insert: {
          id?: string | null;
          name?: string | null;
          price_cents?: number | null;
          snapshot_at?: string | null;
        };
        Update: {
          id?: string | null;
          name?: string | null;
          price_cents?: number | null;
          snapshot_at?: string | null;
        };
        Relationships: [];
      };
      afip_gateway_credentials: {
        Row: {
          api_key: string;
          base_url: string;
          business_id: string;
          created_at: string;
          tenant_slug: string;
          updated_at: string;
          webhook_secret: string | null;
        };
        Insert: {
          api_key: string;
          base_url?: string;
          business_id: string;
          created_at?: string;
          tenant_slug: string;
          updated_at?: string;
          webhook_secret?: string | null;
        };
        Update: {
          api_key?: string;
          base_url?: string;
          business_id?: string;
          created_at?: string;
          tenant_slug?: string;
          updated_at?: string;
          webhook_secret?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "afip_gateway_credentials_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: true;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      app_config: {
        Row: {
          key: string;
          updated_at: string;
          value: string | null;
        };
        Insert: {
          key: string;
          updated_at?: string;
          value?: string | null;
        };
        Update: {
          key?: string;
          updated_at?: string;
          value?: string | null;
        };
        Relationships: [];
      };
      ayuda_lecturas: {
        Row: {
          business_id: string;
          leido_at: string;
          tema: string;
          user_id: string;
        };
        Insert: {
          business_id: string;
          leido_at?: string;
          tema: string;
          user_id: string;
        };
        Update: {
          business_id?: string;
          leido_at?: string;
          tema?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ayuda_lecturas_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      business_hours: {
        Row: {
          business_id: string;
          closes_at: string;
          day_of_week: number;
          id: string;
          opens_at: string;
        };
        Insert: {
          business_id: string;
          closes_at: string;
          day_of_week: number;
          id?: string;
          opens_at: string;
        };
        Update: {
          business_id?: string;
          closes_at?: string;
          day_of_week?: number;
          id?: string;
          opens_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "business_hours_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      business_users: {
        Row: {
          business_id: string;
          created_at: string;
          disabled_at: string | null;
          full_name: string | null;
          phone: string | null;
          pin: string | null;
          role: string;
          user_id: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          disabled_at?: string | null;
          full_name?: string | null;
          phone?: string | null;
          pin?: string | null;
          role: string;
          user_id: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          disabled_at?: string | null;
          full_name?: string | null;
          phone?: string | null;
          pin?: string | null;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "business_users_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "business_users_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      businesses: {
        Row: {
          address: string | null;
          afip_auto_emit: boolean;
          afip_cuit: string | null;
          afip_default_tipo: string | null;
          afip_enabled: boolean;
          afip_gateway_connected: boolean;
          afip_mode: string;
          afip_provider: string | null;
          afip_punto_venta: number | null;
          control_printer_enabled: boolean;
          control_printer_ip: string | null;
          control_printer_port: number;
          cover_image_url: string | null;
          created_at: string;
          cuenta_printer_enabled: boolean;
          cuenta_printer_ip: string | null;
          cuenta_printer_port: number;
          currency: string;
          customer_channel: string;
          delivery_fee_cents: number;
          email: string | null;
          estimated_delivery_minutes: number | null;
          estimated_pickup_minutes: number | null;
          id: string;
          is_active: boolean;
          lat: number | null;
          lng: number | null;
          logo_url: string | null;
          min_order_cents: number;
          mp_accepts_payments: boolean;
          mp_access_token: string | null;
          mp_public_key: string | null;
          mp_webhook_secret: string | null;
          name: string;
          phone: string | null;
          plan: string | null;
          print_agent_key_set: boolean;
          scheduled_march_lead_delivery_min: number;
          scheduled_march_lead_kitchen_min: number;
          scheduled_march_lead_pickup_min: number;
          settings: Json;
          slug: string;
          timezone: string;
          whatsapp_connected: boolean;
        };
        Insert: {
          address?: string | null;
          afip_auto_emit?: boolean;
          afip_cuit?: string | null;
          afip_default_tipo?: string | null;
          afip_enabled?: boolean;
          afip_gateway_connected?: boolean;
          afip_mode?: string;
          afip_provider?: string | null;
          afip_punto_venta?: number | null;
          control_printer_enabled?: boolean;
          control_printer_ip?: string | null;
          control_printer_port?: number;
          cover_image_url?: string | null;
          created_at?: string;
          cuenta_printer_enabled?: boolean;
          cuenta_printer_ip?: string | null;
          cuenta_printer_port?: number;
          currency?: string;
          customer_channel?: string;
          delivery_fee_cents?: number;
          email?: string | null;
          estimated_delivery_minutes?: number | null;
          estimated_pickup_minutes?: number | null;
          id?: string;
          is_active?: boolean;
          lat?: number | null;
          lng?: number | null;
          logo_url?: string | null;
          min_order_cents?: number;
          mp_accepts_payments?: boolean;
          mp_access_token?: string | null;
          mp_public_key?: string | null;
          mp_webhook_secret?: string | null;
          name: string;
          phone?: string | null;
          plan?: string | null;
          print_agent_key_set?: boolean;
          scheduled_march_lead_delivery_min?: number;
          scheduled_march_lead_kitchen_min?: number;
          scheduled_march_lead_pickup_min?: number;
          settings?: Json;
          slug: string;
          timezone?: string;
          whatsapp_connected?: boolean;
        };
        Update: {
          address?: string | null;
          afip_auto_emit?: boolean;
          afip_cuit?: string | null;
          afip_default_tipo?: string | null;
          afip_enabled?: boolean;
          afip_gateway_connected?: boolean;
          afip_mode?: string;
          afip_provider?: string | null;
          afip_punto_venta?: number | null;
          control_printer_enabled?: boolean;
          control_printer_ip?: string | null;
          control_printer_port?: number;
          cover_image_url?: string | null;
          created_at?: string;
          cuenta_printer_enabled?: boolean;
          cuenta_printer_ip?: string | null;
          cuenta_printer_port?: number;
          currency?: string;
          customer_channel?: string;
          delivery_fee_cents?: number;
          email?: string | null;
          estimated_delivery_minutes?: number | null;
          estimated_pickup_minutes?: number | null;
          id?: string;
          is_active?: boolean;
          lat?: number | null;
          lng?: number | null;
          logo_url?: string | null;
          min_order_cents?: number;
          mp_accepts_payments?: boolean;
          mp_access_token?: string | null;
          mp_public_key?: string | null;
          mp_webhook_secret?: string | null;
          name?: string;
          phone?: string | null;
          plan?: string | null;
          print_agent_key_set?: boolean;
          scheduled_march_lead_delivery_min?: number;
          scheduled_march_lead_kitchen_min?: number;
          scheduled_march_lead_pickup_min?: number;
          settings?: Json;
          slug?: string;
          timezone?: string;
          whatsapp_connected?: boolean;
        };
        Relationships: [];
      };
      caja_audit_log: {
        Row: {
          business_id: string;
          by_user_id: string | null;
          caja_id: string | null;
          created_at: string;
          entity_id: string;
          entity_type: string;
          field: string;
          from_value: string | null;
          id: string;
          reason: string;
          to_value: string | null;
        };
        Insert: {
          business_id: string;
          by_user_id?: string | null;
          caja_id?: string | null;
          created_at?: string;
          entity_id: string;
          entity_type: string;
          field: string;
          from_value?: string | null;
          id?: string;
          reason: string;
          to_value?: string | null;
        };
        Update: {
          business_id?: string;
          by_user_id?: string | null;
          caja_id?: string | null;
          created_at?: string;
          entity_id?: string;
          entity_type?: string;
          field?: string;
          from_value?: string | null;
          id?: string;
          reason?: string;
          to_value?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "caja_audit_log_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "caja_audit_log_by_user_id_fkey";
            columns: ["by_user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "caja_audit_log_caja_id_fkey";
            columns: ["caja_id"];
            isOneToOne: false;
            referencedRelation: "cajas";
            referencedColumns: ["id"];
          },
        ];
      };
      caja_cortes: {
        Row: {
          business_id: string;
          caja_id: string;
          closing_cash_cents: number;
          closing_notes: string | null;
          created_at: string;
          denomination_count: Json | null;
          difference_cents: number;
          encargado_id: string;
          expected_cash_cents: number;
          id: string;
          numero: number | null;
          resumen: Json | null;
        };
        Insert: {
          business_id: string;
          caja_id: string;
          closing_cash_cents: number;
          closing_notes?: string | null;
          created_at?: string;
          denomination_count?: Json | null;
          difference_cents: number;
          encargado_id: string;
          expected_cash_cents: number;
          id?: string;
          numero?: number | null;
          resumen?: Json | null;
        };
        Update: {
          business_id?: string;
          caja_id?: string;
          closing_cash_cents?: number;
          closing_notes?: string | null;
          created_at?: string;
          denomination_count?: Json | null;
          difference_cents?: number;
          encargado_id?: string;
          expected_cash_cents?: number;
          id?: string;
          numero?: number | null;
          resumen?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "caja_cortes_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "caja_cortes_caja_id_fkey";
            columns: ["caja_id"];
            isOneToOne: false;
            referencedRelation: "cajas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "caja_cortes_encargado_id_fkey";
            columns: ["encargado_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      caja_movimientos: {
        Row: {
          amount_cents: number;
          business_id: string;
          caja_id: string;
          cancelled_at: string | null;
          cancelled_by: string | null;
          cancelled_reason: string | null;
          corte_id: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          kind: string;
          reason: string | null;
        };
        Insert: {
          amount_cents: number;
          business_id: string;
          caja_id: string;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          cancelled_reason?: string | null;
          corte_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          kind: string;
          reason?: string | null;
        };
        Update: {
          amount_cents?: number;
          business_id?: string;
          caja_id?: string;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          cancelled_reason?: string | null;
          corte_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          kind?: string;
          reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "caja_movimientos_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "caja_movimientos_caja_id_fkey";
            columns: ["caja_id"];
            isOneToOne: false;
            referencedRelation: "cajas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "caja_movimientos_cancelled_by_fkey";
            columns: ["cancelled_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "caja_movimientos_corte_id_fkey";
            columns: ["corte_id"];
            isOneToOne: false;
            referencedRelation: "caja_cortes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "caja_movimientos_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      caja_user_assignments: {
        Row: {
          business_id: string;
          caja_id: string;
          created_at: string;
          id: string;
          user_id: string;
        };
        Insert: {
          business_id: string;
          caja_id: string;
          created_at?: string;
          id?: string;
          user_id: string;
        };
        Update: {
          business_id?: string;
          caja_id?: string;
          created_at?: string;
          id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "caja_user_assignments_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "caja_user_assignments_caja_id_fkey";
            columns: ["caja_id"];
            isOneToOne: false;
            referencedRelation: "cajas";
            referencedColumns: ["id"];
          },
        ];
      };
      cajas: {
        Row: {
          business_id: string;
          created_at: string;
          fiscal_printer_enabled: boolean;
          fiscal_printer_ip: string | null;
          fiscal_printer_port: number;
          id: string;
          is_active: boolean;
          is_administrative: boolean;
          is_default: boolean;
          name: string;
          sort_order: number;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          fiscal_printer_enabled?: boolean;
          fiscal_printer_ip?: string | null;
          fiscal_printer_port?: number;
          id?: string;
          is_active?: boolean;
          is_administrative?: boolean;
          is_default?: boolean;
          name: string;
          sort_order?: number;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          fiscal_printer_enabled?: boolean;
          fiscal_printer_ip?: string | null;
          fiscal_printer_port?: number;
          id?: string;
          is_active?: boolean;
          is_administrative?: boolean;
          is_default?: boolean;
          name?: string;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "cajas_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      campaign_messages: {
        Row: {
          campaign_id: string;
          created_at: string;
          customer_id: string;
          customer_name: string | null;
          customer_phone: string;
          id: string;
          promo_code_id: string | null;
          promo_code_text: string | null;
          redeemed_at: string | null;
          redeemed_order_id: string | null;
          rendered_message: string;
          sent_at: string | null;
          status: string;
        };
        Insert: {
          campaign_id: string;
          created_at?: string;
          customer_id: string;
          customer_name?: string | null;
          customer_phone: string;
          id?: string;
          promo_code_id?: string | null;
          promo_code_text?: string | null;
          redeemed_at?: string | null;
          redeemed_order_id?: string | null;
          rendered_message: string;
          sent_at?: string | null;
          status?: string;
        };
        Update: {
          campaign_id?: string;
          created_at?: string;
          customer_id?: string;
          customer_name?: string | null;
          customer_phone?: string;
          id?: string;
          promo_code_id?: string | null;
          promo_code_text?: string | null;
          redeemed_at?: string | null;
          redeemed_order_id?: string | null;
          rendered_message?: string;
          sent_at?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "campaign_messages_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaign_messages_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaign_messages_promo_code_id_fkey";
            columns: ["promo_code_id"];
            isOneToOne: false;
            referencedRelation: "promo_codes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaign_messages_redeemed_order_id_fkey";
            columns: ["redeemed_order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      campaigns: {
        Row: {
          audience_count: number;
          audience_customer_ids: string[] | null;
          audience_segment: string | null;
          audience_type: string;
          business_id: string;
          channel: string;
          created_at: string;
          description: string | null;
          id: string;
          launched_at: string | null;
          message_template: string;
          name: string;
          promo_template: Json;
          redeemed_count: number;
          sent_count: number;
          status: string;
          updated_at: string;
        };
        Insert: {
          audience_count?: number;
          audience_customer_ids?: string[] | null;
          audience_segment?: string | null;
          audience_type?: string;
          business_id: string;
          channel?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          launched_at?: string | null;
          message_template: string;
          name: string;
          promo_template: Json;
          redeemed_count?: number;
          sent_count?: number;
          status?: string;
          updated_at?: string;
        };
        Update: {
          audience_count?: number;
          audience_customer_ids?: string[] | null;
          audience_segment?: string | null;
          audience_type?: string;
          business_id?: string;
          channel?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          launched_at?: string | null;
          message_template?: string;
          name?: string;
          promo_template?: Json;
          redeemed_count?: number;
          sent_count?: number;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "campaigns_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      categories: {
        Row: {
          business_id: string;
          id: string;
          is_active: boolean;
          name: string;
          slug: string;
          sort_order: number;
          station_id: string | null;
          super_category_id: string | null;
        };
        Insert: {
          business_id: string;
          id?: string;
          is_active?: boolean;
          name: string;
          slug: string;
          sort_order?: number;
          station_id?: string | null;
          super_category_id?: string | null;
        };
        Update: {
          business_id?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          slug?: string;
          sort_order?: number;
          station_id?: string | null;
          super_category_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "categories_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "categories_station_id_fkey";
            columns: ["station_id"];
            isOneToOne: false;
            referencedRelation: "stations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "categories_super_category_id_fkey";
            columns: ["super_category_id"];
            isOneToOne: false;
            referencedRelation: "super_categories";
            referencedColumns: ["id"];
          },
        ];
      };
      chatbot_configs: {
        Row: {
          business_id: string;
          chatbot_enabled: boolean;
          enabled_tools: string[] | null;
          system_prompt: string;
          tool_overrides: Json;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          chatbot_enabled?: boolean;
          enabled_tools?: string[] | null;
          system_prompt?: string;
          tool_overrides?: Json;
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          chatbot_enabled?: boolean;
          enabled_tools?: string[] | null;
          system_prompt?: string;
          tool_overrides?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chatbot_configs_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: true;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      chatbot_contacts: {
        Row: {
          business_id: string;
          channel: string;
          created_at: string;
          display_name: string | null;
          id: string;
          identifier: string;
        };
        Insert: {
          business_id: string;
          channel: string;
          created_at?: string;
          display_name?: string | null;
          id?: string;
          identifier: string;
        };
        Update: {
          business_id?: string;
          channel?: string;
          created_at?: string;
          display_name?: string | null;
          id?: string;
          identifier?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chatbot_contacts_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      chatbot_conversations: {
        Row: {
          agent_enabled: boolean;
          business_id: string;
          cart_state: Json;
          cart_token: string | null;
          closed_at: string | null;
          contact_id: string;
          created_at: string;
          id: string;
          reservation_intent: Json | null;
          reservation_token: string | null;
          updated_at: string;
        };
        Insert: {
          agent_enabled?: boolean;
          business_id: string;
          cart_state?: Json;
          cart_token?: string | null;
          closed_at?: string | null;
          contact_id: string;
          created_at?: string;
          id?: string;
          reservation_intent?: Json | null;
          reservation_token?: string | null;
          updated_at?: string;
        };
        Update: {
          agent_enabled?: boolean;
          business_id?: string;
          cart_state?: Json;
          cart_token?: string | null;
          closed_at?: string | null;
          contact_id?: string;
          created_at?: string;
          id?: string;
          reservation_intent?: Json | null;
          reservation_token?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chatbot_conversations_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "chatbot_conversations_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "chatbot_contacts";
            referencedColumns: ["id"];
          },
        ];
      };
      chatbot_messages: {
        Row: {
          content: string;
          conversation_id: string;
          created_at: string;
          id: string;
          metadata: Json | null;
          role: string;
        };
        Insert: {
          content: string;
          conversation_id: string;
          created_at?: string;
          id?: string;
          metadata?: Json | null;
          role: string;
        };
        Update: {
          content?: string;
          conversation_id?: string;
          created_at?: string;
          id?: string;
          metadata?: Json | null;
          role?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chatbot_messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "chatbot_conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      clock_allowed_origins: {
        Row: {
          business_id: string;
          cidr: string;
          created_at: string;
          created_by: string | null;
          id: string;
          label: string | null;
        };
        Insert: {
          business_id: string;
          cidr: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          label?: string | null;
        };
        Update: {
          business_id?: string;
          cidr?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          label?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "clock_allowed_origins_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      clock_blocked_attempts: {
        Row: {
          attempted_at: string;
          business_id: string;
          id: string;
          ip: string | null;
          pin_masked: string | null;
          reason: string;
        };
        Insert: {
          attempted_at?: string;
          business_id: string;
          id?: string;
          ip?: string | null;
          pin_masked?: string | null;
          reason?: string;
        };
        Update: {
          attempted_at?: string;
          business_id?: string;
          id?: string;
          ip?: string | null;
          pin_masked?: string | null;
          reason?: string;
        };
        Relationships: [
          {
            foreignKeyName: "clock_blocked_attempts_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      clock_entries: {
        Row: {
          business_id: string;
          clock_in: string;
          clock_out: string | null;
          created_at: string;
          duration_minutes: number | null;
          id: string;
          notes: string | null;
          user_id: string;
        };
        Insert: {
          business_id: string;
          clock_in?: string;
          clock_out?: string | null;
          created_at?: string;
          duration_minutes?: number | null;
          id?: string;
          notes?: string | null;
          user_id: string;
        };
        Update: {
          business_id?: string;
          clock_in?: string;
          clock_out?: string | null;
          created_at?: string;
          duration_minutes?: number | null;
          id?: string;
          notes?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "clock_entries_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      comanda_items: {
        Row: {
          comanda_id: string;
          order_item_id: string;
        };
        Insert: {
          comanda_id: string;
          order_item_id: string;
        };
        Update: {
          comanda_id?: string;
          order_item_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "comanda_items_comanda_id_fkey";
            columns: ["comanda_id"];
            isOneToOne: false;
            referencedRelation: "comandas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comanda_items_order_item_id_fkey";
            columns: ["order_item_id"];
            isOneToOne: false;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
        ];
      };
      comandas: {
        Row: {
          batch: number;
          cancelled_at: string | null;
          cancelled_by: string | null;
          cancelled_reason: string | null;
          delivered_at: string | null;
          emitted_at: string;
          id: string;
          notes: string | null;
          order_id: string;
          print_failed_at: string | null;
          reprint_requested_at: string | null;
          station_id: string;
          status: string;
        };
        Insert: {
          batch: number;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          cancelled_reason?: string | null;
          delivered_at?: string | null;
          emitted_at?: string;
          id?: string;
          notes?: string | null;
          order_id: string;
          print_failed_at?: string | null;
          reprint_requested_at?: string | null;
          station_id: string;
          status?: string;
        };
        Update: {
          batch?: number;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          cancelled_reason?: string | null;
          delivered_at?: string | null;
          emitted_at?: string;
          id?: string;
          notes?: string | null;
          order_id?: string;
          print_failed_at?: string | null;
          reprint_requested_at?: string | null;
          station_id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "comandas_cancelled_by_fkey";
            columns: ["cancelled_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comandas_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comandas_station_id_fkey";
            columns: ["station_id"];
            isOneToOne: false;
            referencedRelation: "stations";
            referencedColumns: ["id"];
          },
        ];
      };
      customer_addresses: {
        Row: {
          apartment: string | null;
          created_at: string;
          customer_id: string;
          id: string;
          label: string | null;
          lat: number | null;
          lng: number | null;
          notes: string | null;
          number: string | null;
          street: string;
        };
        Insert: {
          apartment?: string | null;
          created_at?: string;
          customer_id: string;
          id?: string;
          label?: string | null;
          lat?: number | null;
          lng?: number | null;
          notes?: string | null;
          number?: string | null;
          street: string;
        };
        Update: {
          apartment?: string | null;
          created_at?: string;
          customer_id?: string;
          id?: string;
          label?: string | null;
          lat?: number | null;
          lng?: number | null;
          notes?: string | null;
          number?: string | null;
          street?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customer_addresses_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      customer_credit_settlements: {
        Row: {
          amount_cents: number;
          business_id: string;
          caja_id: string | null;
          caja_movimiento_id: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          cancelled_reason: string | null;
          created_at: string;
          created_by: string | null;
          customer_id: string;
          id: string;
          method: string;
          notes: string | null;
        };
        Insert: {
          amount_cents: number;
          business_id: string;
          caja_id?: string | null;
          caja_movimiento_id?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          cancelled_reason?: string | null;
          created_at?: string;
          created_by?: string | null;
          customer_id: string;
          id?: string;
          method: string;
          notes?: string | null;
        };
        Update: {
          amount_cents?: number;
          business_id?: string;
          caja_id?: string | null;
          caja_movimiento_id?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          cancelled_reason?: string | null;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string;
          id?: string;
          method?: string;
          notes?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "customer_credit_settlements_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_credit_settlements_caja_id_fkey";
            columns: ["caja_id"];
            isOneToOne: false;
            referencedRelation: "cajas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_credit_settlements_caja_movimiento_id_fkey";
            columns: ["caja_movimiento_id"];
            isOneToOne: false;
            referencedRelation: "caja_movimientos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_credit_settlements_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      customer_message_log: {
        Row: {
          business_id: string;
          channel: string;
          created_at: string;
          event: string;
          id: string;
          reason: string | null;
          ref_id: string | null;
          sent_at: string | null;
          status: string;
        };
        Insert: {
          business_id: string;
          channel: string;
          created_at?: string;
          event: string;
          id?: string;
          reason?: string | null;
          ref_id?: string | null;
          sent_at?: string | null;
          status: string;
        };
        Update: {
          business_id?: string;
          channel?: string;
          created_at?: string;
          event?: string;
          id?: string;
          reason?: string | null;
          ref_id?: string | null;
          sent_at?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customer_message_log_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      customers: {
        Row: {
          business_id: string;
          created_at: string;
          credit_enabled: boolean;
          email: string | null;
          id: string;
          name: string | null;
          phone: string;
          user_id: string | null;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          credit_enabled?: boolean;
          email?: string | null;
          id?: string;
          name?: string | null;
          phone: string;
          user_id?: string | null;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          credit_enabled?: boolean;
          email?: string | null;
          id?: string;
          name?: string | null;
          phone?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "customers_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      daily_menu_choice_groups: {
        Row: {
          applies_when_group_id: string | null;
          applies_when_product_ids: string[];
          created_at: string;
          id: string;
          menu_id: string;
          name: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          applies_when_group_id?: string | null;
          applies_when_product_ids?: string[];
          created_at?: string;
          id: string;
          menu_id: string;
          name: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          applies_when_group_id?: string | null;
          applies_when_product_ids?: string[];
          created_at?: string;
          id?: string;
          menu_id?: string;
          name?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "daily_menu_choice_groups_applies_when_group_id_fkey";
            columns: ["applies_when_group_id"];
            isOneToOne: false;
            referencedRelation: "daily_menu_choice_groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "daily_menu_choice_groups_menu_id_fkey";
            columns: ["menu_id"];
            isOneToOne: false;
            referencedRelation: "daily_menus";
            referencedColumns: ["id"];
          },
        ];
      };
      daily_menu_components: {
        Row: {
          choice_group_id: string | null;
          description: string | null;
          extra_price_cents: number;
          id: string;
          ignored_modifier_group_ids: string[];
          kind: string;
          label: string;
          menu_id: string;
          product_id: string | null;
          sort_order: number;
        };
        Insert: {
          choice_group_id?: string | null;
          description?: string | null;
          extra_price_cents?: number;
          id?: string;
          ignored_modifier_group_ids?: string[];
          kind?: string;
          label: string;
          menu_id: string;
          product_id?: string | null;
          sort_order?: number;
        };
        Update: {
          choice_group_id?: string | null;
          description?: string | null;
          extra_price_cents?: number;
          id?: string;
          ignored_modifier_group_ids?: string[];
          kind?: string;
          label?: string;
          menu_id?: string;
          product_id?: string | null;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "daily_menu_components_choice_group_fkey";
            columns: ["menu_id", "choice_group_id"];
            isOneToOne: false;
            referencedRelation: "daily_menu_choice_groups";
            referencedColumns: ["menu_id", "id"];
          },
          {
            foreignKeyName: "daily_menu_components_menu_id_fkey";
            columns: ["menu_id"];
            isOneToOne: false;
            referencedRelation: "daily_menus";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "daily_menu_components_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      daily_menus: {
        Row: {
          available_days: number[];
          business_id: string;
          created_at: string;
          description: string | null;
          display_context: string;
          id: string;
          image_url: string | null;
          is_active: boolean;
          is_available: boolean;
          is_suggestion: boolean;
          name: string;
          price_cents: number;
          slug: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          available_days?: number[];
          business_id: string;
          created_at?: string;
          description?: string | null;
          display_context?: string;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          is_available?: boolean;
          is_suggestion?: boolean;
          name: string;
          price_cents: number;
          slug: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          available_days?: number[];
          business_id?: string;
          created_at?: string;
          description?: string | null;
          display_context?: string;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          is_available?: boolean;
          is_suggestion?: boolean;
          name?: string;
          price_cents?: number;
          slug?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "daily_menus_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      delivery_message_templates: {
        Row: {
          body: string;
          business_id: string;
          created_at: string;
          enabled: boolean;
          id: string;
          status: string;
          template_lang: string;
          template_name: string | null;
          template_params: Json | null;
          updated_at: string;
        };
        Insert: {
          body: string;
          business_id: string;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          status: string;
          template_lang?: string;
          template_name?: string | null;
          template_params?: Json | null;
          updated_at?: string;
        };
        Update: {
          body?: string;
          business_id?: string;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          status?: string;
          template_lang?: string;
          template_name?: string | null;
          template_params?: Json | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "delivery_message_templates_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      expense_concepts: {
        Row: {
          business_id: string;
          created_at: string;
          id: string;
          is_active: boolean;
          name: string;
          rubro: string;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name: string;
          rubro: string;
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          rubro?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "expense_concepts_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      fiscal_entities: {
        Row: {
          business_id: string;
          cod_postal: string | null;
          condicion_iva: number;
          created_at: string;
          cuit: string;
          customer_id: string | null;
          domicilio: string | null;
          email: string | null;
          external_ref: string | null;
          id: string;
          localidad: string | null;
          phone: string | null;
          provincia: string | null;
          razon_social: string;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          cod_postal?: string | null;
          condicion_iva: number;
          created_at?: string;
          cuit: string;
          customer_id?: string | null;
          domicilio?: string | null;
          email?: string | null;
          external_ref?: string | null;
          id?: string;
          localidad?: string | null;
          phone?: string | null;
          provincia?: string | null;
          razon_social: string;
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          cod_postal?: string | null;
          condicion_iva?: number;
          created_at?: string;
          cuit?: string;
          customer_id?: string | null;
          domicilio?: string | null;
          email?: string | null;
          external_ref?: string | null;
          id?: string;
          localidad?: string | null;
          phone?: string | null;
          provincia?: string | null;
          razon_social?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fiscal_entities_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fiscal_entities_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      floor_plans: {
        Row: {
          background_image_url: string | null;
          background_opacity: number;
          business_id: string;
          created_at: string;
          cuenta_printer_enabled: boolean;
          cuenta_printer_ip: string | null;
          cuenta_printer_port: number;
          height: number;
          id: string;
          name: string;
          show_customer_name: boolean;
          updated_at: string;
          width: number;
        };
        Insert: {
          background_image_url?: string | null;
          background_opacity?: number;
          business_id: string;
          created_at?: string;
          cuenta_printer_enabled?: boolean;
          cuenta_printer_ip?: string | null;
          cuenta_printer_port?: number;
          height?: number;
          id?: string;
          name?: string;
          show_customer_name?: boolean;
          updated_at?: string;
          width?: number;
        };
        Update: {
          background_image_url?: string | null;
          background_opacity?: number;
          business_id?: string;
          created_at?: string;
          cuenta_printer_enabled?: boolean;
          cuenta_printer_ip?: string | null;
          cuenta_printer_port?: number;
          height?: number;
          id?: string;
          name?: string;
          show_customer_name?: boolean;
          updated_at?: string;
          width?: number;
        };
        Relationships: [
          {
            foreignKeyName: "floor_plans_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      ingredient_consumptions: {
        Row: {
          business_id: string;
          cost_cents_snapshot: number;
          created_at: string;
          created_by: string | null;
          id: string;
          ingredient_id: string;
          kind: string;
          order_item_id: string | null;
          quantity: number;
          reason: string | null;
        };
        Insert: {
          business_id: string;
          cost_cents_snapshot?: number;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          ingredient_id: string;
          kind?: string;
          order_item_id?: string | null;
          quantity: number;
          reason?: string | null;
        };
        Update: {
          business_id?: string;
          cost_cents_snapshot?: number;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          ingredient_id?: string;
          kind?: string;
          order_item_id?: string | null;
          quantity?: number;
          reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ingredient_consumptions_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ingredient_consumptions_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ingredient_consumptions_ingredient_id_fkey";
            columns: ["ingredient_id"];
            isOneToOne: false;
            referencedRelation: "ingredients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ingredient_consumptions_order_item_id_fkey";
            columns: ["order_item_id"];
            isOneToOne: false;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
        ];
      };
      ingredient_presentations: {
        Row: {
          cost_cents: number;
          created_at: string;
          id: string;
          ingredient_id: string;
          is_default: boolean;
          name: string;
          net_quantity: number;
        };
        Insert: {
          cost_cents?: number;
          created_at?: string;
          id?: string;
          ingredient_id: string;
          is_default?: boolean;
          name: string;
          net_quantity: number;
        };
        Update: {
          cost_cents?: number;
          created_at?: string;
          id?: string;
          ingredient_id?: string;
          is_default?: boolean;
          name?: string;
          net_quantity?: number;
        };
        Relationships: [
          {
            foreignKeyName: "ingredient_presentations_ingredient_id_fkey";
            columns: ["ingredient_id"];
            isOneToOne: false;
            referencedRelation: "ingredients";
            referencedColumns: ["id"];
          },
        ];
      };
      ingredient_price_log: {
        Row: {
          id: string;
          ingredient_id: string;
          new_cost_cents: number;
          old_cost_cents: number;
          presentation_id: string | null;
          recorded_at: string;
          recorded_by: string | null;
        };
        Insert: {
          id?: string;
          ingredient_id: string;
          new_cost_cents: number;
          old_cost_cents: number;
          presentation_id?: string | null;
          recorded_at?: string;
          recorded_by?: string | null;
        };
        Update: {
          id?: string;
          ingredient_id?: string;
          new_cost_cents?: number;
          old_cost_cents?: number;
          presentation_id?: string | null;
          recorded_at?: string;
          recorded_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ingredient_price_log_ingredient_id_fkey";
            columns: ["ingredient_id"];
            isOneToOne: false;
            referencedRelation: "ingredients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ingredient_price_log_presentation_id_fkey";
            columns: ["presentation_id"];
            isOneToOne: false;
            referencedRelation: "ingredient_presentations";
            referencedColumns: ["id"];
          },
        ];
      };
      ingredient_recipes: {
        Row: {
          child_ingredient_id: string;
          id: string;
          notes: string | null;
          parent_ingredient_id: string;
          quantity: number;
        };
        Insert: {
          child_ingredient_id: string;
          id?: string;
          notes?: string | null;
          parent_ingredient_id: string;
          quantity: number;
        };
        Update: {
          child_ingredient_id?: string;
          id?: string;
          notes?: string | null;
          parent_ingredient_id?: string;
          quantity?: number;
        };
        Relationships: [
          {
            foreignKeyName: "ingredient_recipes_child_ingredient_id_fkey";
            columns: ["child_ingredient_id"];
            isOneToOne: false;
            referencedRelation: "ingredients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ingredient_recipes_parent_ingredient_id_fkey";
            columns: ["parent_ingredient_id"];
            isOneToOne: false;
            referencedRelation: "ingredients";
            referencedColumns: ["id"];
          },
        ];
      };
      ingredients: {
        Row: {
          business_id: string;
          created_at: string;
          id: string;
          is_active: boolean;
          is_composite: boolean;
          name: string;
          stock_min_alert: number | null;
          stock_quantity: number;
          unit: string;
          updated_at: string;
          waste_percent: number;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_composite?: boolean;
          name: string;
          stock_min_alert?: number | null;
          stock_quantity?: number;
          unit: string;
          updated_at?: string;
          waste_percent?: number;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_composite?: boolean;
          name?: string;
          stock_min_alert?: number | null;
          stock_quantity?: number;
          unit?: string;
          updated_at?: string;
          waste_percent?: number;
        };
        Relationships: [
          {
            foreignKeyName: "ingredients_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      invoices: {
        Row: {
          auto_emitted: boolean;
          business_id: string;
          cae: string | null;
          cae_vencimiento: string | null;
          cancelled_by: string | null;
          cancelled_reason: string | null;
          cancels_invoice_id: string | null;
          condicion_iva_receptor: number | null;
          created_at: string;
          cuit_receptor: string | null;
          error_message: string | null;
          fiscal_entity_id: string | null;
          id: string;
          idempotency_key: string | null;
          iva_cents: number;
          iva_rate: number;
          neto_cents: number;
          numero: number | null;
          order_id: string | null;
          payment_id: string | null;
          pdf_url: string | null;
          provider: string;
          provider_job_id: string | null;
          provider_response: Json | null;
          punto_venta: number;
          qr_url: string | null;
          razon_social_receptor: string | null;
          status: string;
          tipo_comprobante: string;
          total_cents: number;
        };
        Insert: {
          auto_emitted?: boolean;
          business_id: string;
          cae?: string | null;
          cae_vencimiento?: string | null;
          cancelled_by?: string | null;
          cancelled_reason?: string | null;
          cancels_invoice_id?: string | null;
          condicion_iva_receptor?: number | null;
          created_at?: string;
          cuit_receptor?: string | null;
          error_message?: string | null;
          fiscal_entity_id?: string | null;
          id?: string;
          idempotency_key?: string | null;
          iva_cents: number;
          iva_rate?: number;
          neto_cents: number;
          numero?: number | null;
          order_id?: string | null;
          payment_id?: string | null;
          pdf_url?: string | null;
          provider?: string;
          provider_job_id?: string | null;
          provider_response?: Json | null;
          punto_venta: number;
          qr_url?: string | null;
          razon_social_receptor?: string | null;
          status?: string;
          tipo_comprobante: string;
          total_cents: number;
        };
        Update: {
          auto_emitted?: boolean;
          business_id?: string;
          cae?: string | null;
          cae_vencimiento?: string | null;
          cancelled_by?: string | null;
          cancelled_reason?: string | null;
          cancels_invoice_id?: string | null;
          condicion_iva_receptor?: number | null;
          created_at?: string;
          cuit_receptor?: string | null;
          error_message?: string | null;
          fiscal_entity_id?: string | null;
          id?: string;
          idempotency_key?: string | null;
          iva_cents?: number;
          iva_rate?: number;
          neto_cents?: number;
          numero?: number | null;
          order_id?: string | null;
          payment_id?: string | null;
          pdf_url?: string | null;
          provider?: string;
          provider_job_id?: string | null;
          provider_response?: Json | null;
          punto_venta?: number;
          qr_url?: string | null;
          razon_social_receptor?: string | null;
          status?: string;
          tipo_comprobante?: string;
          total_cents?: number;
        };
        Relationships: [
          {
            foreignKeyName: "invoices_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_cancels_invoice_id_fkey";
            columns: ["cancels_invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_fiscal_entity_id_fkey";
            columns: ["fiscal_entity_id"];
            isOneToOne: false;
            referencedRelation: "fiscal_entities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
        ];
      };
      modifier_groups: {
        Row: {
          business_id: string;
          id: string;
          is_required: boolean;
          max_selection: number;
          min_selection: number;
          name: string;
          product_id: string;
          sort_order: number;
        };
        Insert: {
          business_id: string;
          id?: string;
          is_required?: boolean;
          max_selection?: number;
          min_selection?: number;
          name: string;
          product_id: string;
          sort_order?: number;
        };
        Update: {
          business_id?: string;
          id?: string;
          is_required?: boolean;
          max_selection?: number;
          min_selection?: number;
          name?: string;
          product_id?: string;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "modifier_groups_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "modifier_groups_product_business_fkey";
            columns: ["product_id", "business_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id", "business_id"];
          },
        ];
      };
      modifiers: {
        Row: {
          group_id: string;
          id: string;
          is_available: boolean;
          name: string;
          price_delta_cents: number;
          sort_order: number;
        };
        Insert: {
          group_id: string;
          id?: string;
          is_available?: boolean;
          name: string;
          price_delta_cents?: number;
          sort_order?: number;
        };
        Update: {
          group_id?: string;
          id?: string;
          is_available?: boolean;
          name?: string;
          price_delta_cents?: number;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "modifiers_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "modifier_groups";
            referencedColumns: ["id"];
          },
        ];
      };
      mozo_rendiciones: {
        Row: {
          business_id: string;
          created_at: string;
          delivered_cash_cents: number;
          difference_cents: number;
          estado: string;
          expected_cash_cents: number;
          id: string;
          mozo_id: string;
          notes: string | null;
          por_metodo: Json;
          registered_by: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          delivered_cash_cents?: number;
          difference_cents?: number;
          estado?: string;
          expected_cash_cents?: number;
          id?: string;
          mozo_id: string;
          notes?: string | null;
          por_metodo?: Json;
          registered_by: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          delivered_cash_cents?: number;
          difference_cents?: number;
          estado?: string;
          expected_cash_cents?: number;
          id?: string;
          mozo_id?: string;
          notes?: string | null;
          por_metodo?: Json;
          registered_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mozo_rendiciones_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      notification_preferences: {
        Row: {
          business_id: string;
          channel: string;
          created_at: string;
          enabled: boolean;
          event_type: string;
          id: string;
          target_role: string | null;
          target_user_id: string | null;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          channel: string;
          created_at?: string;
          enabled?: boolean;
          event_type: string;
          id?: string;
          target_role?: string | null;
          target_user_id?: string | null;
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          channel?: string;
          created_at?: string;
          enabled?: boolean;
          event_type?: string;
          id?: string;
          target_role?: string | null;
          target_user_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notification_preferences_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notification_preferences_target_user_id_fkey";
            columns: ["target_user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          business_id: string;
          created_at: string;
          id: string;
          payload: Json;
          read_at: string | null;
          target_role: string | null;
          type: string;
          user_id: string | null;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          id?: string;
          payload?: Json;
          read_at?: string | null;
          target_role?: string | null;
          type: string;
          user_id?: string | null;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          id?: string;
          payload?: Json;
          read_at?: string | null;
          target_role?: string | null;
          type?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      order_item_modifiers: {
        Row: {
          id: string;
          modifier_id: string | null;
          modifier_name: string;
          order_item_id: string;
          price_delta_cents: number;
        };
        Insert: {
          id?: string;
          modifier_id?: string | null;
          modifier_name: string;
          order_item_id: string;
          price_delta_cents: number;
        };
        Update: {
          id?: string;
          modifier_id?: string | null;
          modifier_name?: string;
          order_item_id?: string;
          price_delta_cents?: number;
        };
        Relationships: [
          {
            foreignKeyName: "order_item_modifiers_modifier_id_fkey";
            columns: ["modifier_id"];
            isOneToOne: false;
            referencedRelation: "modifiers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_item_modifiers_order_item_id_fkey";
            columns: ["order_item_id"];
            isOneToOne: false;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
        ];
      };
      order_items: {
        Row: {
          cancelled_at: string | null;
          cancelled_by: string | null;
          cancelled_reason: string | null;
          client_line_key: string | null;
          daily_menu_id: string | null;
          daily_menu_snapshot: Json | null;
          id: string;
          is_combo_component: boolean;
          kitchen_status: string;
          loaded_by: string | null;
          notes: string | null;
          order_id: string;
          parent_order_item_id: string | null;
          price_original_cents: number | null;
          price_override_at: string | null;
          price_override_by: string | null;
          price_override_reason: string | null;
          product_id: string | null;
          product_name: string;
          quantity: number;
          seat_number: number | null;
          station_id: string | null;
          subtotal_cents: number;
          unit_price_cents: number;
        };
        Insert: {
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          cancelled_reason?: string | null;
          client_line_key?: string | null;
          daily_menu_id?: string | null;
          daily_menu_snapshot?: Json | null;
          id?: string;
          is_combo_component?: boolean;
          kitchen_status?: string;
          loaded_by?: string | null;
          notes?: string | null;
          order_id: string;
          parent_order_item_id?: string | null;
          price_original_cents?: number | null;
          price_override_at?: string | null;
          price_override_by?: string | null;
          price_override_reason?: string | null;
          product_id?: string | null;
          product_name: string;
          quantity: number;
          seat_number?: number | null;
          station_id?: string | null;
          subtotal_cents: number;
          unit_price_cents: number;
        };
        Update: {
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          cancelled_reason?: string | null;
          client_line_key?: string | null;
          daily_menu_id?: string | null;
          daily_menu_snapshot?: Json | null;
          id?: string;
          is_combo_component?: boolean;
          kitchen_status?: string;
          loaded_by?: string | null;
          notes?: string | null;
          order_id?: string;
          parent_order_item_id?: string | null;
          price_original_cents?: number | null;
          price_override_at?: string | null;
          price_override_by?: string | null;
          price_override_reason?: string | null;
          product_id?: string | null;
          product_name?: string;
          quantity?: number;
          seat_number?: number | null;
          station_id?: string | null;
          subtotal_cents?: number;
          unit_price_cents?: number;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_daily_menu_id_fkey";
            columns: ["daily_menu_id"];
            isOneToOne: false;
            referencedRelation: "daily_menus";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_loaded_by_fkey";
            columns: ["loaded_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_parent_order_item_id_fkey";
            columns: ["parent_order_item_id"];
            isOneToOne: false;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_price_override_by_fkey";
            columns: ["price_override_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_station_id_fkey";
            columns: ["station_id"];
            isOneToOne: false;
            referencedRelation: "stations";
            referencedColumns: ["id"];
          },
        ];
      };
      order_split_items: {
        Row: {
          order_item_id: string;
          split_id: string;
        };
        Insert: {
          order_item_id: string;
          split_id: string;
        };
        Update: {
          order_item_id?: string;
          split_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_split_items_order_item_id_fkey";
            columns: ["order_item_id"];
            isOneToOne: false;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_split_items_split_id_fkey";
            columns: ["split_id"];
            isOneToOne: false;
            referencedRelation: "order_splits";
            referencedColumns: ["id"];
          },
        ];
      };
      order_splits: {
        Row: {
          business_id: string;
          created_at: string;
          expected_amount_cents: number;
          id: string;
          label: string | null;
          order_id: string;
          paid_amount_cents: number;
          split_index: number;
          split_mode: string;
          status: string;
          tip_cents: number;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          expected_amount_cents: number;
          id?: string;
          label?: string | null;
          order_id: string;
          paid_amount_cents?: number;
          split_index: number;
          split_mode: string;
          status?: string;
          tip_cents?: number;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          expected_amount_cents?: number;
          id?: string;
          label?: string | null;
          order_id?: string;
          paid_amount_cents?: number;
          split_index?: number;
          split_mode?: string;
          status?: string;
          tip_cents?: number;
        };
        Relationships: [
          {
            foreignKeyName: "order_splits_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_splits_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      order_status_history: {
        Row: {
          changed_by: string | null;
          created_at: string;
          id: string;
          notes: string | null;
          order_id: string;
          status: string;
        };
        Insert: {
          changed_by?: string | null;
          created_at?: string;
          id?: string;
          notes?: string | null;
          order_id: string;
          status: string;
        };
        Update: {
          changed_by?: string | null;
          created_at?: string;
          id?: string;
          notes?: string | null;
          order_id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_status_history_changed_by_fkey";
            columns: ["changed_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_status_history_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          bill_requested_at: string | null;
          business_day: string;
          business_id: string;
          cancelled_at: string | null;
          cancelled_by: string | null;
          cancelled_reason: string | null;
          closed_at: string | null;
          comprobante_elegido: Json | null;
          created_at: string;
          customer_email: string | null;
          customer_id: string | null;
          customer_name: string;
          customer_phone: string;
          daily_number: number;
          delivery_address: string | null;
          delivery_fee_cents: number;
          delivery_lat: number | null;
          delivery_lng: number | null;
          delivery_notes: string | null;
          delivery_type: string;
          discount_cents: number;
          discount_reason: string | null;
          id: string;
          kitchen_at: string | null;
          kitchen_notes: string | null;
          lifecycle_status: string;
          march_alerted_at: string | null;
          mozo_id: string | null;
          mp_payment_id: string | null;
          mp_preference_id: string | null;
          order_number: number;
          party_size: number | null;
          payment_method: string;
          payment_status: string;
          promo_code_id: string | null;
          promo_code_snapshot: string | null;
          scheduled_at: string | null;
          status: string;
          subtotal_cents: number;
          table_id: string | null;
          tip_cents: number;
          total_cents: number;
          total_paid_cents: number;
          updated_at: string;
        };
        Insert: {
          bill_requested_at?: string | null;
          business_day: string;
          business_id: string;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          cancelled_reason?: string | null;
          closed_at?: string | null;
          comprobante_elegido?: Json | null;
          created_at?: string;
          customer_email?: string | null;
          customer_id?: string | null;
          customer_name: string;
          customer_phone: string;
          daily_number: number;
          delivery_address?: string | null;
          delivery_fee_cents?: number;
          delivery_lat?: number | null;
          delivery_lng?: number | null;
          delivery_notes?: string | null;
          delivery_type: string;
          discount_cents?: number;
          discount_reason?: string | null;
          id?: string;
          kitchen_at?: string | null;
          kitchen_notes?: string | null;
          lifecycle_status?: string;
          march_alerted_at?: string | null;
          mozo_id?: string | null;
          mp_payment_id?: string | null;
          mp_preference_id?: string | null;
          order_number: number;
          party_size?: number | null;
          payment_method?: string;
          payment_status?: string;
          promo_code_id?: string | null;
          promo_code_snapshot?: string | null;
          scheduled_at?: string | null;
          status?: string;
          subtotal_cents: number;
          table_id?: string | null;
          tip_cents?: number;
          total_cents: number;
          total_paid_cents?: number;
          updated_at?: string;
        };
        Update: {
          bill_requested_at?: string | null;
          business_day?: string;
          business_id?: string;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          cancelled_reason?: string | null;
          closed_at?: string | null;
          comprobante_elegido?: Json | null;
          created_at?: string;
          customer_email?: string | null;
          customer_id?: string | null;
          customer_name?: string;
          customer_phone?: string;
          daily_number?: number;
          delivery_address?: string | null;
          delivery_fee_cents?: number;
          delivery_lat?: number | null;
          delivery_lng?: number | null;
          delivery_notes?: string | null;
          delivery_type?: string;
          discount_cents?: number;
          discount_reason?: string | null;
          id?: string;
          kitchen_at?: string | null;
          kitchen_notes?: string | null;
          lifecycle_status?: string;
          march_alerted_at?: string | null;
          mozo_id?: string | null;
          mp_payment_id?: string | null;
          mp_preference_id?: string | null;
          order_number?: number;
          party_size?: number | null;
          payment_method?: string;
          payment_status?: string;
          promo_code_id?: string | null;
          promo_code_snapshot?: string | null;
          scheduled_at?: string | null;
          status?: string;
          subtotal_cents?: number;
          table_id?: string | null;
          tip_cents?: number;
          total_cents?: number;
          total_paid_cents?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "orders_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_mozo_id_fkey";
            columns: ["mozo_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_promo_code_id_fkey";
            columns: ["promo_code_id"];
            isOneToOne: false;
            referencedRelation: "promo_codes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_table_id_fkey";
            columns: ["table_id"];
            isOneToOne: false;
            referencedRelation: "tables";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_method_configs: {
        Row: {
          adjustment_percent: number;
          business_id: string;
          created_at: string;
          id: string;
          is_active: boolean;
          label: string | null;
          method: string;
          sort_order: number;
        };
        Insert: {
          adjustment_percent?: number;
          business_id: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          label?: string | null;
          method: string;
          sort_order?: number;
        };
        Update: {
          adjustment_percent?: number;
          business_id?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          label?: string | null;
          method?: string;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "payment_method_configs_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          adjustment_cents: number;
          adjustment_percent: number;
          amount_cents: number;
          attributed_mozo_id: string | null;
          business_id: string;
          caja_id: string;
          card_brand: string | null;
          created_at: string;
          credit_customer_id: string | null;
          id: string;
          last_four: string | null;
          method: string;
          mp_payment_id: string | null;
          mp_preference_id: string | null;
          notes: string | null;
          operated_by: string | null;
          order_id: string;
          payment_status: string;
          refunded_at: string | null;
          refunded_reason: string | null;
          request_id: string | null;
          split_id: string | null;
          tip_cents: number;
        };
        Insert: {
          adjustment_cents?: number;
          adjustment_percent?: number;
          amount_cents: number;
          attributed_mozo_id?: string | null;
          business_id: string;
          caja_id: string;
          card_brand?: string | null;
          created_at?: string;
          credit_customer_id?: string | null;
          id?: string;
          last_four?: string | null;
          method: string;
          mp_payment_id?: string | null;
          mp_preference_id?: string | null;
          notes?: string | null;
          operated_by?: string | null;
          order_id: string;
          payment_status?: string;
          refunded_at?: string | null;
          refunded_reason?: string | null;
          request_id?: string | null;
          split_id?: string | null;
          tip_cents?: number;
        };
        Update: {
          adjustment_cents?: number;
          adjustment_percent?: number;
          amount_cents?: number;
          attributed_mozo_id?: string | null;
          business_id?: string;
          caja_id?: string;
          card_brand?: string | null;
          created_at?: string;
          credit_customer_id?: string | null;
          id?: string;
          last_four?: string | null;
          method?: string;
          mp_payment_id?: string | null;
          mp_preference_id?: string | null;
          notes?: string | null;
          operated_by?: string | null;
          order_id?: string;
          payment_status?: string;
          refunded_at?: string | null;
          refunded_reason?: string | null;
          request_id?: string | null;
          split_id?: string | null;
          tip_cents?: number;
        };
        Relationships: [
          {
            foreignKeyName: "payments_attributed_mozo_id_fkey";
            columns: ["attributed_mozo_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_caja_id_fkey";
            columns: ["caja_id"];
            isOneToOne: false;
            referencedRelation: "cajas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_credit_customer_id_fkey";
            columns: ["credit_customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_operated_by_fkey";
            columns: ["operated_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_split_id_fkey";
            columns: ["split_id"];
            isOneToOne: false;
            referencedRelation: "order_splits";
            referencedColumns: ["id"];
          },
        ];
      };
      phone_verification_codes: {
        Row: {
          attempts: number;
          business_id: string;
          code_hash: string;
          consumed_at: string | null;
          created_at: string;
          expires_at: string;
          id: string;
          phone: string;
          user_id: string;
        };
        Insert: {
          attempts?: number;
          business_id: string;
          code_hash: string;
          consumed_at?: string | null;
          created_at?: string;
          expires_at: string;
          id?: string;
          phone: string;
          user_id: string;
        };
        Update: {
          attempts?: number;
          business_id?: string;
          code_hash?: string;
          consumed_at?: string | null;
          created_at?: string;
          expires_at?: string;
          id?: string;
          phone?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "phone_verification_codes_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      print_agent_credentials: {
        Row: {
          api_key: string;
          business_id: string;
          created_at: string;
          id: string;
          label: string;
          printer_scope: string[] | null;
          updated_at: string;
        };
        Insert: {
          api_key: string;
          business_id: string;
          created_at?: string;
          id?: string;
          label: string;
          printer_scope?: string[] | null;
          updated_at?: string;
        };
        Update: {
          api_key?: string;
          business_id?: string;
          created_at?: string;
          id?: string;
          label?: string;
          printer_scope?: string[] | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "print_agent_credentials_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      print_agent_status: {
        Row: {
          agent_id: string;
          agent_version: string | null;
          business_id: string;
          last_seen_at: string;
        };
        Insert: {
          agent_id: string;
          agent_version?: string | null;
          business_id: string;
          last_seen_at?: string;
        };
        Update: {
          agent_id?: string;
          agent_version?: string | null;
          business_id?: string;
          last_seen_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "print_agent_status_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "print_agent_credentials";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "print_agent_status_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      print_jobs: {
        Row: {
          business_id: string;
          corte_id: string | null;
          emitted_at: string;
          id: string;
          invoice_id: string | null;
          kind: string;
          last_error: string | null;
          order_id: string | null;
          print_failed_at: string | null;
          printed_at: string | null;
          reprint_requested_at: string | null;
          requested_by: string | null;
          status: string;
          test_label: string | null;
          test_printer_ip: string | null;
          test_printer_port: number | null;
        };
        Insert: {
          business_id: string;
          corte_id?: string | null;
          emitted_at?: string;
          id?: string;
          invoice_id?: string | null;
          kind: string;
          last_error?: string | null;
          order_id?: string | null;
          print_failed_at?: string | null;
          printed_at?: string | null;
          reprint_requested_at?: string | null;
          requested_by?: string | null;
          status?: string;
          test_label?: string | null;
          test_printer_ip?: string | null;
          test_printer_port?: number | null;
        };
        Update: {
          business_id?: string;
          corte_id?: string | null;
          emitted_at?: string;
          id?: string;
          invoice_id?: string | null;
          kind?: string;
          last_error?: string | null;
          order_id?: string | null;
          print_failed_at?: string | null;
          printed_at?: string | null;
          reprint_requested_at?: string | null;
          requested_by?: string | null;
          status?: string;
          test_label?: string | null;
          test_printer_ip?: string | null;
          test_printer_port?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "print_jobs_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "print_jobs_corte_id_fkey";
            columns: ["corte_id"];
            isOneToOne: false;
            referencedRelation: "caja_cortes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "print_jobs_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "print_jobs_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "print_jobs_requested_by_fkey";
            columns: ["requested_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      product_price_log: {
        Row: {
          business_id: string;
          id: string;
          new_price_cents: number;
          old_price_cents: number;
          product_id: string;
          recorded_at: string;
          recorded_by: string | null;
        };
        Insert: {
          business_id: string;
          id?: string;
          new_price_cents: number;
          old_price_cents: number;
          product_id: string;
          recorded_at?: string;
          recorded_by?: string | null;
        };
        Update: {
          business_id?: string;
          id?: string;
          new_price_cents?: number;
          old_price_cents?: number;
          product_id?: string;
          recorded_at?: string;
          recorded_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "product_price_log_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_price_log_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      products: {
        Row: {
          business_id: string;
          category_id: string | null;
          created_at: string;
          description: string | null;
          id: string;
          image_url: string | null;
          is_active: boolean;
          is_available: boolean;
          is_bar_stock: boolean;
          name: string;
          prep_time_minutes: number | null;
          price_cents: number;
          show_online: boolean;
          slug: string;
          sort_order: number;
          station_id: string | null;
          track_stock: boolean;
        };
        Insert: {
          business_id: string;
          category_id?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          is_available?: boolean;
          is_bar_stock?: boolean;
          name: string;
          prep_time_minutes?: number | null;
          price_cents: number;
          show_online?: boolean;
          slug: string;
          sort_order?: number;
          station_id?: string | null;
          track_stock?: boolean;
        };
        Update: {
          business_id?: string;
          category_id?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          is_available?: boolean;
          is_bar_stock?: boolean;
          name?: string;
          prep_time_minutes?: number | null;
          price_cents?: number;
          show_online?: boolean;
          slug?: string;
          sort_order?: number;
          station_id?: string | null;
          track_stock?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "products_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "products_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "products_station_id_fkey";
            columns: ["station_id"];
            isOneToOne: false;
            referencedRelation: "stations";
            referencedColumns: ["id"];
          },
        ];
      };
      promo_codes: {
        Row: {
          business_id: string;
          code: string;
          created_at: string;
          customer_id: string | null;
          description: string | null;
          discount_type: string;
          discount_value: number;
          id: string;
          is_active: boolean;
          max_uses: number | null;
          min_order_cents: number;
          updated_at: string;
          uses_count: number;
          valid_from: string | null;
          valid_until: string | null;
        };
        Insert: {
          business_id: string;
          code: string;
          created_at?: string;
          customer_id?: string | null;
          description?: string | null;
          discount_type: string;
          discount_value?: number;
          id?: string;
          is_active?: boolean;
          max_uses?: number | null;
          min_order_cents?: number;
          updated_at?: string;
          uses_count?: number;
          valid_from?: string | null;
          valid_until?: string | null;
        };
        Update: {
          business_id?: string;
          code?: string;
          created_at?: string;
          customer_id?: string | null;
          description?: string | null;
          discount_type?: string;
          discount_value?: number;
          id?: string;
          is_active?: boolean;
          max_uses?: number | null;
          min_order_cents?: number;
          updated_at?: string;
          uses_count?: number;
          valid_from?: string | null;
          valid_until?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "promo_codes_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "promo_codes_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      recipes: {
        Row: {
          id: string;
          ingredient_id: string;
          notes: string | null;
          product_id: string;
          quantity: number;
        };
        Insert: {
          id?: string;
          ingredient_id: string;
          notes?: string | null;
          product_id: string;
          quantity: number;
        };
        Update: {
          id?: string;
          ingredient_id?: string;
          notes?: string | null;
          product_id?: string;
          quantity?: number;
        };
        Relationships: [
          {
            foreignKeyName: "recipes_ingredient_id_fkey";
            columns: ["ingredient_id"];
            isOneToOne: false;
            referencedRelation: "ingredients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recipes_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      reservation_message_templates: {
        Row: {
          body: string;
          business_id: string;
          created_at: string;
          enabled: boolean;
          event: string;
          id: string;
          template_lang: string;
          template_name: string | null;
          updated_at: string;
        };
        Insert: {
          body: string;
          business_id: string;
          created_at?: string;
          enabled?: boolean;
          event: string;
          id?: string;
          template_lang?: string;
          template_name?: string | null;
          updated_at?: string;
        };
        Update: {
          body?: string;
          business_id?: string;
          created_at?: string;
          enabled?: boolean;
          event?: string;
          id?: string;
          template_lang?: string;
          template_name?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reservation_message_templates_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      reservation_services: {
        Row: {
          business_id: string;
          closes_at: string;
          created_at: string;
          day_of_week: number | null;
          floor_plan_id: string | null;
          hold_tables: number;
          id: string;
          name: string;
          opens_at: string;
          soft_capacity: number | null;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          closes_at: string;
          created_at?: string;
          day_of_week?: number | null;
          floor_plan_id?: string | null;
          hold_tables?: number;
          id?: string;
          name: string;
          opens_at: string;
          soft_capacity?: number | null;
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          closes_at?: string;
          created_at?: string;
          day_of_week?: number | null;
          floor_plan_id?: string | null;
          hold_tables?: number;
          id?: string;
          name?: string;
          opens_at?: string;
          soft_capacity?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reservation_services_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reservation_services_floor_plan_id_fkey";
            columns: ["floor_plan_id"];
            isOneToOne: false;
            referencedRelation: "floor_plans";
            referencedColumns: ["id"];
          },
        ];
      };
      reservation_settings: {
        Row: {
          advance_days_max: number;
          approval_expiry_min: number;
          buffer_min: number;
          business_id: string;
          lead_time_min: number;
          max_party_size: number;
          mode: string;
          no_show_grace_min: number;
          schedule: Json;
          slot_duration_min: number;
          updated_at: string;
        };
        Insert: {
          advance_days_max?: number;
          approval_expiry_min?: number;
          buffer_min?: number;
          business_id: string;
          lead_time_min?: number;
          max_party_size?: number;
          mode?: string;
          no_show_grace_min?: number;
          schedule?: Json;
          slot_duration_min?: number;
          updated_at?: string;
        };
        Update: {
          advance_days_max?: number;
          approval_expiry_min?: number;
          buffer_min?: number;
          business_id?: string;
          lead_time_min?: number;
          max_party_size?: number;
          mode?: string;
          no_show_grace_min?: number;
          schedule?: Json;
          slot_duration_min?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reservation_settings_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: true;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      reservations: {
        Row: {
          business_id: string;
          client_confirmed_at: string | null;
          confirm_token: string;
          created_at: string;
          customer_email: string | null;
          customer_name: string;
          customer_phone: string;
          decided_at: string | null;
          decided_by: string | null;
          ends_at: string;
          floor_plan_id: string | null;
          id: string;
          notes: string | null;
          party_size: number;
          rejection_reason: string | null;
          service: string | null;
          source: string;
          starts_at: string;
          status: string;
          table_id: string | null;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          business_id: string;
          client_confirmed_at?: string | null;
          confirm_token?: string;
          created_at?: string;
          customer_email?: string | null;
          customer_name: string;
          customer_phone: string;
          decided_at?: string | null;
          decided_by?: string | null;
          ends_at: string;
          floor_plan_id?: string | null;
          id?: string;
          notes?: string | null;
          party_size: number;
          rejection_reason?: string | null;
          service?: string | null;
          source?: string;
          starts_at: string;
          status?: string;
          table_id?: string | null;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          business_id?: string;
          client_confirmed_at?: string | null;
          confirm_token?: string;
          created_at?: string;
          customer_email?: string | null;
          customer_name?: string;
          customer_phone?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          ends_at?: string;
          floor_plan_id?: string | null;
          id?: string;
          notes?: string | null;
          party_size?: number;
          rejection_reason?: string | null;
          service?: string | null;
          source?: string;
          starts_at?: string;
          status?: string;
          table_id?: string | null;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "reservations_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reservations_floor_plan_id_fkey";
            columns: ["floor_plan_id"];
            isOneToOne: false;
            referencedRelation: "floor_plans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reservations_table_id_fkey";
            columns: ["table_id"];
            isOneToOne: false;
            referencedRelation: "tables";
            referencedColumns: ["id"];
          },
        ];
      };
      shift_summary_sends: {
        Row: {
          business_id: string;
          sent_at: string;
          sent_for_date: string;
        };
        Insert: {
          business_id: string;
          sent_at?: string;
          sent_for_date: string;
        };
        Update: {
          business_id?: string;
          sent_at?: string;
          sent_for_date?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shift_summary_sends_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      stations: {
        Row: {
          business_id: string;
          created_at: string;
          id: string;
          is_active: boolean;
          name: string;
          printer_enabled: boolean;
          printer_ip: string | null;
          printer_port: number;
          sort_order: number;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name: string;
          printer_enabled?: boolean;
          printer_ip?: string | null;
          printer_port?: number;
          sort_order?: number;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          printer_enabled?: boolean;
          printer_ip?: string | null;
          printer_port?: number;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "stations_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_items: {
        Row: {
          business_id: string;
          created_at: string;
          current_qty: number;
          id: string;
          min_qty: number;
          product_id: string;
          unit: string;
          unit_cost_cents: number;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          current_qty?: number;
          id?: string;
          min_qty?: number;
          product_id: string;
          unit?: string;
          unit_cost_cents?: number;
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          current_qty?: number;
          id?: string;
          min_qty?: number;
          product_id?: string;
          unit?: string;
          unit_cost_cents?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_items_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_movimientos: {
        Row: {
          business_id: string;
          cost_cents_snapshot: number | null;
          created_at: string;
          created_by: string | null;
          id: string;
          kind: string;
          order_item_id: string | null;
          qty: number;
          reason: string | null;
          stock_item_id: string;
        };
        Insert: {
          business_id: string;
          cost_cents_snapshot?: number | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          kind: string;
          order_item_id?: string | null;
          qty: number;
          reason?: string | null;
          stock_item_id: string;
        };
        Update: {
          business_id?: string;
          cost_cents_snapshot?: number | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          kind?: string;
          order_item_id?: string | null;
          qty?: number;
          reason?: string | null;
          stock_item_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_movimientos_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movimientos_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movimientos_order_item_id_fkey";
            columns: ["order_item_id"];
            isOneToOne: false;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movimientos_stock_item_id_fkey";
            columns: ["stock_item_id"];
            isOneToOne: false;
            referencedRelation: "stock_items";
            referencedColumns: ["id"];
          },
        ];
      };
      super_categories: {
        Row: {
          business_id: string;
          color: string;
          created_at: string;
          icon: string;
          id: string;
          is_active: boolean;
          name: string;
          slug: string;
          sort_order: number;
        };
        Insert: {
          business_id: string;
          color?: string;
          created_at?: string;
          icon?: string;
          id?: string;
          is_active?: boolean;
          name: string;
          slug: string;
          sort_order?: number;
        };
        Update: {
          business_id?: string;
          color?: string;
          created_at?: string;
          icon?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          slug?: string;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "super_categories_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      supplier_ingredient_aliases: {
        Row: {
          alias_norm: string;
          alias_raw: string;
          business_id: string;
          confirmations: number;
          created_at: string;
          created_by: string | null;
          id: string;
          ingredient_id: string;
          last_confirmed_at: string;
          origen: string;
          presentation_id: string | null;
          supplier_id: string;
        };
        Insert: {
          alias_norm: string;
          alias_raw: string;
          business_id: string;
          confirmations?: number;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          ingredient_id: string;
          last_confirmed_at?: string;
          origen: string;
          presentation_id?: string | null;
          supplier_id: string;
        };
        Update: {
          alias_norm?: string;
          alias_raw?: string;
          business_id?: string;
          confirmations?: number;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          ingredient_id?: string;
          last_confirmed_at?: string;
          origen?: string;
          presentation_id?: string | null;
          supplier_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "supplier_ingredient_aliases_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "supplier_ingredient_aliases_ingredient_id_fkey";
            columns: ["ingredient_id"];
            isOneToOne: false;
            referencedRelation: "ingredients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "supplier_ingredient_aliases_presentation_id_fkey";
            columns: ["presentation_id"];
            isOneToOne: false;
            referencedRelation: "ingredient_presentations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "supplier_ingredient_aliases_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["id"];
          },
        ];
      };
      supplier_ingredients: {
        Row: {
          business_id: string;
          created_at: string;
          ingredient_id: string;
          supplier_id: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          ingredient_id: string;
          supplier_id: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          ingredient_id?: string;
          supplier_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "supplier_ingredients_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "supplier_ingredients_ingredient_id_fkey";
            columns: ["ingredient_id"];
            isOneToOne: false;
            referencedRelation: "ingredients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "supplier_ingredients_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["id"];
          },
        ];
      };
      supplier_invoice_items: {
        Row: {
          business_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          ingredient_id: string;
          invoice_id: string;
          match_source: string | null;
          presentation_id: string | null;
          quantity_base: number;
          source_text: string | null;
          unit_cost_cents: number;
          units: number;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          ingredient_id: string;
          invoice_id: string;
          match_source?: string | null;
          presentation_id?: string | null;
          quantity_base: number;
          source_text?: string | null;
          unit_cost_cents: number;
          units: number;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          ingredient_id?: string;
          invoice_id?: string;
          match_source?: string | null;
          presentation_id?: string | null;
          quantity_base?: number;
          source_text?: string | null;
          unit_cost_cents?: number;
          units?: number;
        };
        Relationships: [
          {
            foreignKeyName: "supplier_invoice_items_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "supplier_invoice_items_ingredient_id_fkey";
            columns: ["ingredient_id"];
            isOneToOne: false;
            referencedRelation: "ingredients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "supplier_invoice_items_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "supplier_invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "supplier_invoice_items_presentation_id_fkey";
            columns: ["presentation_id"];
            isOneToOne: false;
            referencedRelation: "ingredient_presentations";
            referencedColumns: ["id"];
          },
        ];
      };
      supplier_invoices: {
        Row: {
          business_id: string;
          cancelled_at: string | null;
          cancelled_by: string | null;
          cancelled_reason: string | null;
          created_at: string;
          created_by: string | null;
          document_type: string;
          due_date: string | null;
          expense_concept_id: string | null;
          id: string;
          invoice_date: string;
          invoice_number: string | null;
          notes: string | null;
          photo_url: string | null;
          photo_urls: string[];
          supplier_id: string;
          total_cents: number;
        };
        Insert: {
          business_id: string;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          cancelled_reason?: string | null;
          created_at?: string;
          created_by?: string | null;
          document_type?: string;
          due_date?: string | null;
          expense_concept_id?: string | null;
          id?: string;
          invoice_date: string;
          invoice_number?: string | null;
          notes?: string | null;
          photo_url?: string | null;
          photo_urls?: string[];
          supplier_id: string;
          total_cents: number;
        };
        Update: {
          business_id?: string;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          cancelled_reason?: string | null;
          created_at?: string;
          created_by?: string | null;
          document_type?: string;
          due_date?: string | null;
          expense_concept_id?: string | null;
          id?: string;
          invoice_date?: string;
          invoice_number?: string | null;
          notes?: string | null;
          photo_url?: string | null;
          photo_urls?: string[];
          supplier_id?: string;
          total_cents?: number;
        };
        Relationships: [
          {
            foreignKeyName: "supplier_invoices_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "supplier_invoices_expense_concept_id_fkey";
            columns: ["expense_concept_id"];
            isOneToOne: false;
            referencedRelation: "expense_concepts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "supplier_invoices_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["id"];
          },
        ];
      };
      supplier_payment_allocations: {
        Row: {
          amount_cents: number;
          business_id: string;
          created_at: string;
          id: string;
          invoice_id: string;
          payment_id: string;
        };
        Insert: {
          amount_cents: number;
          business_id: string;
          created_at?: string;
          id?: string;
          invoice_id: string;
          payment_id: string;
        };
        Update: {
          amount_cents?: number;
          business_id?: string;
          created_at?: string;
          id?: string;
          invoice_id?: string;
          payment_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "supplier_payment_allocations_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "supplier_payment_allocations_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "supplier_invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "supplier_payment_allocations_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "supplier_payments";
            referencedColumns: ["id"];
          },
        ];
      };
      supplier_payments: {
        Row: {
          amount_cents: number;
          business_id: string;
          caja_id: string | null;
          caja_movimiento_id: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          cancelled_reason: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          method: string;
          notes: string | null;
          numero: number | null;
          paid_at: string;
          supplier_id: string;
        };
        Insert: {
          amount_cents: number;
          business_id: string;
          caja_id?: string | null;
          caja_movimiento_id?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          cancelled_reason?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          method: string;
          notes?: string | null;
          numero?: number | null;
          paid_at?: string;
          supplier_id: string;
        };
        Update: {
          amount_cents?: number;
          business_id?: string;
          caja_id?: string | null;
          caja_movimiento_id?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          cancelled_reason?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          method?: string;
          notes?: string | null;
          numero?: number | null;
          paid_at?: string;
          supplier_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "supplier_payments_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "supplier_payments_caja_id_fkey";
            columns: ["caja_id"];
            isOneToOne: false;
            referencedRelation: "cajas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "supplier_payments_caja_movimiento_id_fkey";
            columns: ["caja_movimiento_id"];
            isOneToOne: false;
            referencedRelation: "caja_movimientos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "supplier_payments_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["id"];
          },
        ];
      };
      suppliers: {
        Row: {
          business_id: string;
          contact: string | null;
          created_at: string;
          cuit: string | null;
          default_expense_concept_id: string | null;
          email: string | null;
          id: string;
          is_active: boolean;
          name: string;
          notes: string | null;
          payment_terms_days: number;
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          contact?: string | null;
          created_at?: string;
          cuit?: string | null;
          default_expense_concept_id?: string | null;
          email?: string | null;
          id?: string;
          is_active?: boolean;
          name: string;
          notes?: string | null;
          payment_terms_days?: number;
          phone?: string | null;
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          contact?: string | null;
          created_at?: string;
          cuit?: string | null;
          default_expense_concept_id?: string | null;
          email?: string | null;
          id?: string;
          is_active?: boolean;
          name?: string;
          notes?: string | null;
          payment_terms_days?: number;
          phone?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "suppliers_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "suppliers_default_expense_concept_id_fkey";
            columns: ["default_expense_concept_id"];
            isOneToOne: false;
            referencedRelation: "expense_concepts";
            referencedColumns: ["id"];
          },
        ];
      };
      tables: {
        Row: {
          created_at: string;
          current_order_id: string | null;
          floor_plan_id: string;
          height: number;
          id: string;
          is_bar: boolean;
          label: string;
          mozo_id: string | null;
          opened_at: string | null;
          operational_status: string;
          rotation: number;
          seats: number;
          shape: string;
          status: string;
          width: number;
          x: number;
          y: number;
        };
        Insert: {
          created_at?: string;
          current_order_id?: string | null;
          floor_plan_id: string;
          height: number;
          id?: string;
          is_bar?: boolean;
          label: string;
          mozo_id?: string | null;
          opened_at?: string | null;
          operational_status?: string;
          rotation?: number;
          seats: number;
          shape: string;
          status?: string;
          width: number;
          x: number;
          y: number;
        };
        Update: {
          created_at?: string;
          current_order_id?: string | null;
          floor_plan_id?: string;
          height?: number;
          id?: string;
          is_bar?: boolean;
          label?: string;
          mozo_id?: string | null;
          opened_at?: string | null;
          operational_status?: string;
          rotation?: number;
          seats?: number;
          shape?: string;
          status?: string;
          width?: number;
          x?: number;
          y?: number;
        };
        Relationships: [
          {
            foreignKeyName: "tables_current_order_id_fkey";
            columns: ["current_order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tables_floor_plan_id_fkey";
            columns: ["floor_plan_id"];
            isOneToOne: false;
            referencedRelation: "floor_plans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tables_mozo_id_fkey";
            columns: ["mozo_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      tables_audit_log: {
        Row: {
          business_id: string;
          by_user_id: string | null;
          created_at: string;
          from_value: string | null;
          id: string;
          kind: string;
          reason: string | null;
          table_id: string;
          to_value: string | null;
        };
        Insert: {
          business_id: string;
          by_user_id?: string | null;
          created_at?: string;
          from_value?: string | null;
          id?: string;
          kind: string;
          reason?: string | null;
          table_id: string;
          to_value?: string | null;
        };
        Update: {
          business_id?: string;
          by_user_id?: string | null;
          created_at?: string;
          from_value?: string | null;
          id?: string;
          kind?: string;
          reason?: string | null;
          table_id?: string;
          to_value?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "tables_audit_log_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tables_audit_log_by_user_id_fkey";
            columns: ["by_user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tables_audit_log_table_id_fkey";
            columns: ["table_id"];
            isOneToOne: false;
            referencedRelation: "tables";
            referencedColumns: ["id"];
          },
        ];
      };
      users: {
        Row: {
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          is_platform_admin: boolean;
        };
        Insert: {
          created_at?: string;
          email: string;
          full_name?: string | null;
          id: string;
          is_platform_admin?: boolean;
        };
        Update: {
          created_at?: string;
          email?: string;
          full_name?: string | null;
          id?: string;
          is_platform_admin?: boolean;
        };
        Relationships: [];
      };
      whatsapp_credentials: {
        Row: {
          api_key: string | null;
          app_name: string | null;
          business_id: string;
          channel_id: string | null;
          created_at: string;
          from_phone: string | null;
          provider: string;
          updated_at: string;
          webhook_token: string | null;
        };
        Insert: {
          api_key?: string | null;
          app_name?: string | null;
          business_id: string;
          channel_id?: string | null;
          created_at?: string;
          from_phone?: string | null;
          provider?: string;
          updated_at?: string;
          webhook_token?: string | null;
        };
        Update: {
          api_key?: string | null;
          app_name?: string | null;
          business_id?: string;
          channel_id?: string | null;
          created_at?: string;
          from_phone?: string | null;
          provider?: string;
          updated_at?: string;
          webhook_token?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "whatsapp_credentials_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: true;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      whatsapp_inbound_events: {
        Row: {
          business_id: string;
          id: string;
          provider: string;
          provider_event_id: string;
          received_at: string;
          type: string;
        };
        Insert: {
          business_id: string;
          id?: string;
          provider: string;
          provider_event_id: string;
          received_at?: string;
          type: string;
        };
        Update: {
          business_id?: string;
          id?: string;
          provider?: string;
          provider_event_id?: string;
          received_at?: string;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "whatsapp_inbound_events_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      whatsapp_outbox: {
        Row: {
          body: string;
          business_id: string;
          created_at: string;
          error: string | null;
          id: string;
          kind: string;
          provider_message_id: string | null;
          ref_id: string | null;
          sent_at: string | null;
          status: string;
          to_phone: string | null;
        };
        Insert: {
          body: string;
          business_id: string;
          created_at?: string;
          error?: string | null;
          id?: string;
          kind: string;
          provider_message_id?: string | null;
          ref_id?: string | null;
          sent_at?: string | null;
          status?: string;
          to_phone?: string | null;
        };
        Update: {
          body?: string;
          business_id?: string;
          created_at?: string;
          error?: string | null;
          id?: string;
          kind?: string;
          provider_message_id?: string | null;
          ref_id?: string | null;
          sent_at?: string | null;
          status?: string;
          to_phone?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "whatsapp_outbox_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      whatsapp_template_map: {
        Row: {
          business_id: string;
          created_at: string;
          lang: string;
          provider: string;
          provider_template_id: string;
          template_name: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          lang?: string;
          provider: string;
          provider_template_id: string;
          template_name: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          lang?: string;
          provider?: string;
          provider_template_id?: string;
          template_name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "whatsapp_template_map_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      adjust_ingredient_stock: {
        Args: {
          p_business_id: string;
          p_cost_cents: number;
          p_created_by: string;
          p_delta: number;
          p_ingredient_id: string;
          p_kind: string;
          p_reason: string;
        };
        Returns: number;
      };
      adjust_stock_item: {
        Args: { p_delta: number; p_stock_item_id: string };
        Returns: number;
      };
      anular_comprobante_tx: {
        Args: {
          p_business_id: string;
          p_cancelled_by: string;
          p_invoice_id: string;
          p_reason: string;
        };
        Returns: undefined;
      };
      anular_pago_tx: {
        Args: {
          p_business_id: string;
          p_by_user_id: string;
          p_payment_id: string;
          p_reason: string;
        };
        Returns: {
          fully_paid: boolean;
          payment: Json;
        }[];
      };
      cerrar_caja_tx: {
        Args: {
          p_barrer_salon: boolean;
          p_business_id: string;
          p_caja_id: string;
          p_closing_cash_cents: number;
          p_closing_notes: string;
          p_denomination_count: Json;
          p_encargado_id: string;
          p_expected_cash_cents: number;
          p_resumen?: Json;
          p_retirar: boolean;
        };
        Returns: {
          corte: Json;
          mesas_liberadas: number;
          mozos_limpiados: number;
          print_job_id: string;
          retiro_id: string;
        }[];
      };
      corregir_movimiento_tx: {
        Args: {
          p_amount_cents: number;
          p_business_id: string;
          p_by_user_id: string;
          p_cancel: boolean;
          p_movimiento_id: string;
          p_reason: string;
        };
        Returns: {
          changed_fields: string[];
          movimiento: Json;
        }[];
      };
      corregir_pago_tx: {
        Args: {
          p_business_id: string;
          p_by_user_id: string;
          p_patch: Json;
          p_payment_id: string;
          p_reason: string;
        };
        Returns: {
          changed_fields: string[];
          fully_paid: boolean;
          payment: Json;
        }[];
      };
      editar_comprobante_tx: {
        Args: { p_business_id: string; p_campos: Json; p_invoice_id: string };
        Returns: undefined;
      };
      fn_explode_ingredient: {
        Args: { p_ingredient_id: string; p_quantity: number };
        Returns: {
          leaf_cost_per_unit: number;
          leaf_ingredient_id: string;
          leaf_quantity: number;
        }[];
      };
      fn_ingredient_cost_per_unit: {
        Args: { p_ingredient_id: string };
        Returns: number;
      };
      fn_stock_reversion_item: {
        Args: { p_order_item_id: string };
        Returns: undefined;
      };
      increment_promo_use: {
        Args: { p_business_id: string; p_promo_id: string };
        Returns: boolean;
      };
      is_business_admin: { Args: { bid: string }; Returns: boolean };
      is_business_manager: { Args: { bid: string }; Returns: boolean };
      is_business_member: { Args: { bid: string }; Returns: boolean };
      is_business_staff: { Args: { bid: string }; Returns: boolean };
      is_platform_admin: { Args: never; Returns: boolean };
      march_due_scheduled_orders: { Args: never; Returns: undefined };
      mark_overdue_reservations_no_show: { Args: never; Returns: number };
      normalizar_nombre_proveedor: { Args: { p: string }; Returns: string };
      normalizar_texto_insumo: { Args: { p: string }; Returns: string };
      operating_day: { Args: { ts: string }; Returns: string };
      proponer_insumos_para_lineas: {
        Args: { p_business_id: string; p_lineas: Json; p_supplier_id: string };
        Returns: Json;
      };
      proponer_proveedor_para_cabecera: {
        Args: { p_business_id: string; p_cuit: string; p_nombre: string };
        Returns: Json;
      };
      reconcile_pending_invoices: { Args: never; Returns: undefined };
      registrar_items_comprobante_tx: {
        Args: {
          p_business_id: string;
          p_created_by: string;
          p_invoice_id: string;
          p_items: Json;
        };
        Returns: number;
      };
      registrar_pago_proveedor_tx: {
        Args: {
          p_amount_cents: number;
          p_business_id: string;
          p_caja_id: string;
          p_caja_reason: string;
          p_created_by: string;
          p_imputaciones?: Json;
          p_method: string;
          p_notes: string;
          p_paid_at: string;
          p_supplier_id: string;
        };
        Returns: {
          caja_movimiento_id: string;
          payment_id: string;
        }[];
      };
      registrar_pago_tx: {
        Args: {
          p_adjustment_cents: number;
          p_adjustment_percent: number;
          p_amount_cents: number;
          p_attributed_mozo_id: string;
          p_business_id: string;
          p_caja_id: string;
          p_card_brand: string;
          p_credit_customer_id?: string;
          p_last_four: string;
          p_method: string;
          p_notes: string;
          p_operated_by: string;
          p_order_id: string;
          p_request_id: string;
          p_split_id: string;
          p_tip_cents: number;
        };
        Returns: {
          fully_paid: boolean;
          idempotent: boolean;
          payment: Json;
          split_done: boolean;
        }[];
      };
      revertir_items_comprobante_tx: {
        Args: { p_business_id: string; p_invoice_id: string };
        Returns: number;
      };
      saldo_caja_administrativa: {
        Args: { p_business_id: string };
        Returns: {
          caja_id: string;
          caja_name: string;
          movimientos: number;
          saldo_cents: number;
          ultimo_movimiento: string;
        }[];
      };
      seed_caja_administrativa: {
        Args: { p_business_id: string };
        Returns: undefined;
      };
      seed_expense_concepts: {
        Args: { p_business_id: string };
        Returns: undefined;
      };
      send_due_reservation_reminders: { Args: never; Returns: undefined };
      send_due_shift_summaries: { Args: never; Returns: undefined };
      trasladar_mesa_tx: {
        Args: {
          p_actor_user_id: string;
          p_business_id: string;
          p_expected_order_id: string;
          p_from_table_id: string;
          p_reason: string;
          p_to_table_id: string;
        };
        Returns: string;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
