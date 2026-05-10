--
-- PostgreSQL database dump
--

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.5

-- Started on 2026-05-09 00:35:06

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TOC entry 2 (class 3079 OID 16483)
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- TOC entry 5243 (class 0 OID 0)
-- Dependencies: 2
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- TOC entry 3 (class 3079 OID 16900)
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- TOC entry 5244 (class 0 OID 0)
-- Dependencies: 3
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- TOC entry 4 (class 3079 OID 19937)
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- TOC entry 5245 (class 0 OID 0)
-- Dependencies: 4
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


--
-- TOC entry 304 (class 1255 OID 19870)
-- Name: notify_stock_alert(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.notify_stock_alert() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_product_id UUID;
  v_available  INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_product_id := OLD.product_id;
  ELSE
    v_product_id := NEW.product_id;
  END IF;

  SELECT GREATEST(0, COALESCE(SUM(s.quantity), 0) - COALESCE(MAX(p.stock_reserva), 0))
  INTO v_available
  FROM stock s
  JOIN products p ON p.id = s.product_id
  WHERE s.product_id = v_product_id;

  IF v_available < 10 THEN
    INSERT INTO stock_alerts (product_id, available_stock, notified_at)
    VALUES (v_product_id, v_available, now())
    ON CONFLICT (product_id) DO NOTHING;

    IF FOUND THEN
      PERFORM pg_notify(
        'stock_alert',
        json_build_object('product_id', v_product_id, 'available_stock', v_available)::text
      );
    END IF;
  ELSE
    DELETE FROM stock_alerts WHERE product_id = v_product_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION public.notify_stock_alert() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 268 (class 1259 OID 19505)
-- Name: admin_conversations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.admin_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.admin_conversations OWNER TO postgres;

--
-- TOC entry 269 (class 1259 OID 19520)
-- Name: admin_messages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.admin_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    sender text NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    read_at timestamp with time zone,
    CONSTRAINT admin_messages_sender_check CHECK ((sender = ANY (ARRAY['admin'::text, 'seller'::text])))
);


ALTER TABLE public.admin_messages OWNER TO postgres;

--
-- TOC entry 267 (class 1259 OID 19494)
-- Name: admin_users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.admin_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    name text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.admin_users OWNER TO postgres;

--
-- TOC entry 232 (class 1259 OID 16662)
-- Name: cash_movements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cash_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type text NOT NULL,
    source text,
    reference_id uuid,
    amount numeric(12,2) NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    divisa text DEFAULT 'ARS'::text NOT NULL,
    warehouse_id uuid,
    negocio_id uuid NOT NULL,
    description text,
    CONSTRAINT cash_movements_divisa_check CHECK ((divisa = ANY (ARRAY['ARS'::text, 'USD'::text])))
);


ALTER TABLE public.cash_movements OWNER TO postgres;

--
-- TOC entry 224 (class 1259 OID 16540)
-- Name: categories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    parent_id uuid,
    negocio_id uuid NOT NULL
);


ALTER TABLE public.categories OWNER TO postgres;

--
-- TOC entry 239 (class 1259 OID 17054)
-- Name: cc_movimientos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cc_movimientos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cuenta_corriente_id uuid NOT NULL,
    tipo text NOT NULL,
    concepto text,
    monto numeric(12,2) NOT NULL,
    order_id uuid,
    created_at timestamp without time zone DEFAULT now(),
    metodo_pago text DEFAULT 'Efectivo'::text,
    divisa_cuenta text DEFAULT 'ARS'::text NOT NULL,
    divisa_cobro text DEFAULT 'ARS'::text NOT NULL,
    monto_original numeric(12,2),
    cotizacion_usada numeric(12,4),
    warehouse_id uuid,
    CONSTRAINT cc_movimientos_tipo_check CHECK ((tipo = ANY (ARRAY['debito'::text, 'pago'::text])))
);


ALTER TABLE public.cc_movimientos OWNER TO postgres;

--
-- TOC entry 246 (class 1259 OID 17673)
-- Name: cc_movimientos_prov; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cc_movimientos_prov (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cuenta_corriente_id uuid NOT NULL,
    tipo text NOT NULL,
    concepto text,
    monto numeric(12,2) NOT NULL,
    order_id uuid,
    created_at timestamp without time zone DEFAULT now(),
    metodo_pago text DEFAULT 'Efectivo'::text,
    divisa_cuenta text DEFAULT 'ARS'::text NOT NULL,
    divisa_cobro text DEFAULT 'ARS'::text NOT NULL,
    monto_original numeric(12,2),
    cotizacion_usada numeric(12,4),
    CONSTRAINT cc_movimientos_prov_tipo_check CHECK ((tipo = ANY (ARRAY['debito'::text, 'pago'::text])))
);


ALTER TABLE public.cc_movimientos_prov OWNER TO postgres;

--
-- TOC entry 279 (class 1259 OID 26666)
-- Name: combo_images; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.combo_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    combo_id uuid NOT NULL,
    seller_id uuid NOT NULL,
    key text NOT NULL,
    "order" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.combo_images OWNER TO postgres;

--
-- TOC entry 278 (class 1259 OID 26646)
-- Name: combo_products; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.combo_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    combo_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity integer DEFAULT 1 NOT NULL
);


ALTER TABLE public.combo_products OWNER TO postgres;

--
-- TOC entry 255 (class 1259 OID 18682)
-- Name: conversations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.conversations (
    id integer NOT NULL,
    seller_id uuid NOT NULL,
    customer_name character varying(100) NOT NULL,
    customer_email character varying(200),
    customer_phone character varying(30),
    access_token character varying(64) NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.conversations OWNER TO postgres;

--
-- TOC entry 254 (class 1259 OID 18681)
-- Name: conversations_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.conversations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.conversations_id_seq OWNER TO postgres;

--
-- TOC entry 5246 (class 0 OID 0)
-- Dependencies: 254
-- Name: conversations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.conversations_id_seq OWNED BY public.conversations.id;


--
-- TOC entry 238 (class 1259 OID 17038)
-- Name: cuentas_corrientes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cuentas_corrientes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    saldo numeric(12,2) DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    divisa text DEFAULT 'ARS'::text NOT NULL,
    CONSTRAINT cuentas_corrientes_divisa_check CHECK ((divisa = ANY (ARRAY['ARS'::text, 'USD'::text])))
);


ALTER TABLE public.cuentas_corrientes OWNER TO postgres;

--
-- TOC entry 245 (class 1259 OID 17659)
-- Name: cuentas_corrientes_prov; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cuentas_corrientes_prov (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    proveedor_id uuid NOT NULL,
    saldo numeric(12,2) DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    divisa text DEFAULT 'ARS'::text NOT NULL,
    CONSTRAINT cuentas_corrientes_prov_divisa_check CHECK ((divisa = ANY (ARRAY['ARS'::text, 'USD'::text])))
);


ALTER TABLE public.cuentas_corrientes_prov OWNER TO postgres;

--
-- TOC entry 223 (class 1259 OID 16531)
-- Name: customers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    type text,
    document text,
    phone text,
    email text,
    created_at timestamp without time zone DEFAULT now(),
    domicilio text,
    localidad text,
    provincia text,
    codigo_postal text,
    contacto text,
    descuento numeric(5,2),
    dias_plazo integer,
    transporte text,
    condicion_iva text,
    vendedor text,
    cuenta_pesos text,
    cuenta_dolares text,
    codigo text,
    divisa text DEFAULT 'ARS'::text NOT NULL,
    negocio_id uuid,
    CONSTRAINT customers_divisa_check CHECK ((divisa = ANY (ARRAY['ARS'::text, 'USD'::text])))
);


ALTER TABLE public.customers OWNER TO postgres;

--
-- TOC entry 243 (class 1259 OID 17622)
-- Name: favorites; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.favorites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    product_id uuid NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.favorites OWNER TO postgres;

--
-- TOC entry 272 (class 1259 OID 19874)
-- Name: integrations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.integrations (
    id integer NOT NULL,
    key character varying(50) NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    icon character varying(10),
    active boolean DEFAULT true NOT NULL
);


ALTER TABLE public.integrations OWNER TO postgres;

--
-- TOC entry 271 (class 1259 OID 19873)
-- Name: integrations_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.integrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.integrations_id_seq OWNER TO postgres;

--
-- TOC entry 5247 (class 0 OID 0)
-- Dependencies: 271
-- Name: integrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.integrations_id_seq OWNED BY public.integrations.id;


--
-- TOC entry 257 (class 1259 OID 18698)
-- Name: messages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.messages (
    id integer NOT NULL,
    conversation_id integer NOT NULL,
    sender character varying(10) NOT NULL,
    body text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    read_at timestamp without time zone,
    msg_type character varying(20) DEFAULT 'text'::character varying NOT NULL,
    quote_data jsonb,
    CONSTRAINT messages_sender_check CHECK (((sender)::text = ANY ((ARRAY['customer'::character varying, 'seller'::character varying])::text[])))
);


ALTER TABLE public.messages OWNER TO postgres;

--
-- TOC entry 256 (class 1259 OID 18697)
-- Name: messages_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.messages_id_seq OWNER TO postgres;

--
-- TOC entry 5248 (class 0 OID 0)
-- Dependencies: 256
-- Name: messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.messages_id_seq OWNED BY public.messages.id;


--
-- TOC entry 263 (class 1259 OID 19305)
-- Name: negocios; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.negocios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    razon_social text,
    cuit text,
    domicilio text,
    logo_key text,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.negocios OWNER TO postgres;

--
-- TOC entry 230 (class 1259 OID 16632)
-- Name: order_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity integer NOT NULL,
    unit_price numeric(12,2) NOT NULL,
    cost numeric(12,2)
);


ALTER TABLE public.order_items OWNER TO postgres;

--
-- TOC entry 264 (class 1259 OID 19416)
-- Name: order_shipping; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.order_shipping (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    web_order_id uuid,
    shipping_type character varying(20),
    postal_code character varying(10),
    province character varying(100),
    street character varying(255),
    street_number character varying(30),
    floor_apt character varying(50),
    city character varying(100),
    branch_id character varying(50),
    branch_name character varying(255),
    service_code character varying(50),
    service_name character varying(100),
    shipping_amount numeric DEFAULT 0,
    tracking_code character varying(100),
    created_at timestamp with time zone DEFAULT now(),
    transport_company_id uuid,
    transport_company_name character varying(100),
    contact_phone character varying(50)
);


ALTER TABLE public.order_shipping OWNER TO postgres;

--
-- TOC entry 229 (class 1259 OID 16612)
-- Name: orders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid,
    user_id uuid,
    total numeric(12,2),
    profit numeric(12,2),
    status text DEFAULT 'pending'::text,
    created_at timestamp without time zone DEFAULT now(),
    tipo text DEFAULT 'Presupuesto'::text,
    vendedor text,
    price_type text DEFAULT 'precio_1'::text,
    texto_libre text,
    escenario text,
    origen text,
    destino text,
    customer_id_remito uuid,
    supplier_id uuid,
    warehouse_id uuid,
    es_consumidor_final boolean DEFAULT false,
    consumidor_final_nombre text,
    divisa text DEFAULT 'ARS'::text,
    negocio_id uuid NOT NULL,
    recipient_user_id uuid,
    created_by_user_id uuid,
    created_by_name text,
    edited_by_user_id uuid,
    edited_by_name text,
    deleted_at timestamp without time zone,
    deleted_by_user_id uuid,
    deleted_by_name text
);


ALTER TABLE public.orders OWNER TO postgres;

--
-- TOC entry 277 (class 1259 OID 26623)
-- Name: page_combos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.page_combos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    page_id uuid NOT NULL,
    seller_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    custom_price numeric DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    free_shipping boolean DEFAULT false NOT NULL
);


ALTER TABLE public.page_combos OWNER TO postgres;

--
-- TOC entry 231 (class 1259 OID 16648)
-- Name: payments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    method text NOT NULL,
    amount numeric(12,2) NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.payments OWNER TO postgres;

--
-- TOC entry 241 (class 1259 OID 17575)
-- Name: price_config; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.price_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cotizacion_dolar numeric(12,4) DEFAULT 1000 NOT NULL,
    pct_1 numeric(8,4) DEFAULT 0 NOT NULL,
    pct_2 numeric(8,4) DEFAULT 0 NOT NULL,
    pct_3 numeric(8,4) DEFAULT 0 NOT NULL,
    pct_4 numeric(8,4) DEFAULT 0 NOT NULL,
    pct_5 numeric(8,4) DEFAULT 0 NOT NULL,
    updated_at timestamp without time zone DEFAULT now(),
    negocio_id uuid NOT NULL
);


ALTER TABLE public.price_config OWNER TO postgres;

--
-- TOC entry 233 (class 1259 OID 16671)
-- Name: product_costs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.product_costs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    cost numeric(10,2) NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.product_costs OWNER TO postgres;

--
-- TOC entry 237 (class 1259 OID 16952)
-- Name: product_images; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.product_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    key text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.product_images OWNER TO postgres;

--
-- TOC entry 276 (class 1259 OID 26550)
-- Name: product_price_overrides; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.product_price_overrides (
    product_id uuid NOT NULL,
    pct_1 numeric,
    pct_2 numeric,
    pct_3 numeric,
    pct_4 numeric,
    pct_5 numeric
);


ALTER TABLE public.product_price_overrides OWNER TO postgres;

--
-- TOC entry 226 (class 1259 OID 16570)
-- Name: product_prices; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.product_prices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    price_type text NOT NULL,
    currency text DEFAULT 'ARS'::text,
    price numeric(10,2) NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.product_prices OWNER TO postgres;

--
-- TOC entry 275 (class 1259 OID 19909)
-- Name: product_reviews; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.product_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    page_id uuid NOT NULL,
    seller_id uuid NOT NULL,
    author_name character varying(100) NOT NULL,
    rating smallint NOT NULL,
    comment text NOT NULL,
    source character varying(20) DEFAULT 'star_ai'::character varying,
    published boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT product_reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


ALTER TABLE public.product_reviews OWNER TO postgres;

--
-- TOC entry 225 (class 1259 OID 16553)
-- Name: products; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text,
    barcode text,
    name text NOT NULL,
    description text,
    category_id uuid,
    active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    box_code text,
    tasa_iva numeric(8,4),
    despacho text,
    aduana text,
    origen text,
    qxb integer,
    punto_pedido integer,
    video_url text,
    stock_reserva integer DEFAULT 0 NOT NULL,
    costo_usd numeric(12,4),
    negocio_id uuid NOT NULL,
    deleted_at timestamp without time zone,
    embedding public.vector(1536)
);


ALTER TABLE public.products OWNER TO postgres;

--
-- TOC entry 244 (class 1259 OID 17649)
-- Name: proveedores; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.proveedores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    type text,
    document text,
    phone text,
    email text,
    created_at timestamp without time zone DEFAULT now(),
    domicilio text,
    localidad text,
    provincia text,
    codigo_postal text,
    contacto text,
    descuento numeric(5,2),
    dias_plazo integer,
    transporte text,
    condicion_iva text,
    vendedor text,
    cuenta_pesos text,
    cuenta_dolares text,
    codigo text,
    divisa text DEFAULT 'ARS'::text NOT NULL,
    negocio_id uuid NOT NULL,
    CONSTRAINT proveedores_divisa_check CHECK ((divisa = ANY (ARRAY['ARS'::text, 'USD'::text])))
);


ALTER TABLE public.proveedores OWNER TO postgres;

--
-- TOC entry 258 (class 1259 OID 18714)
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.schema_migrations (
    filename text NOT NULL,
    ran_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.schema_migrations OWNER TO postgres;

--
-- TOC entry 262 (class 1259 OID 18770)
-- Name: seller_discount_tiers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.seller_discount_tiers (
    id integer NOT NULL,
    seller_id uuid NOT NULL,
    threshold numeric(14,2) NOT NULL,
    discount_pct numeric(5,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    discount_type character varying(10) DEFAULT 'quantity'::character varying NOT NULL,
    page_id uuid
);


ALTER TABLE public.seller_discount_tiers OWNER TO postgres;

--
-- TOC entry 261 (class 1259 OID 18769)
-- Name: seller_discount_tiers_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.seller_discount_tiers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.seller_discount_tiers_id_seq OWNER TO postgres;

--
-- TOC entry 5249 (class 0 OID 0)
-- Dependencies: 261
-- Name: seller_discount_tiers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.seller_discount_tiers_id_seq OWNED BY public.seller_discount_tiers.id;


--
-- TOC entry 260 (class 1259 OID 18751)
-- Name: seller_discounts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.seller_discounts (
    id integer NOT NULL,
    seller_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    discount_type character varying(10) DEFAULT 'quantity'::character varying NOT NULL,
    min_profit_pct numeric(5,2) DEFAULT 10 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    enabled_quantity boolean DEFAULT false NOT NULL,
    enabled_price boolean DEFAULT false NOT NULL,
    page_id uuid
);


ALTER TABLE public.seller_discounts OWNER TO postgres;

--
-- TOC entry 259 (class 1259 OID 18750)
-- Name: seller_discounts_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.seller_discounts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.seller_discounts_id_seq OWNER TO postgres;

--
-- TOC entry 5250 (class 0 OID 0)
-- Dependencies: 259
-- Name: seller_discounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.seller_discounts_id_seq OWNED BY public.seller_discounts.id;


--
-- TOC entry 266 (class 1259 OID 19445)
-- Name: seller_earnings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.seller_earnings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id uuid NOT NULL,
    web_order_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    status character varying(20) DEFAULT 'pending_approval'::character varying NOT NULL,
    payout_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.seller_earnings OWNER TO postgres;

--
-- TOC entry 250 (class 1259 OID 18595)
-- Name: seller_images; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.seller_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id uuid NOT NULL,
    product_id uuid NOT NULL,
    key text NOT NULL,
    "order" integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now(),
    page_id uuid
);


ALTER TABLE public.seller_images OWNER TO postgres;

--
-- TOC entry 274 (class 1259 OID 19886)
-- Name: seller_integrations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.seller_integrations (
    id integer NOT NULL,
    page_id uuid NOT NULL,
    integration_id integer NOT NULL,
    active boolean DEFAULT true NOT NULL,
    config jsonb DEFAULT '{}'::jsonb,
    activated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.seller_integrations OWNER TO postgres;

--
-- TOC entry 273 (class 1259 OID 19885)
-- Name: seller_integrations_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.seller_integrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.seller_integrations_id_seq OWNER TO postgres;

--
-- TOC entry 5251 (class 0 OID 0)
-- Dependencies: 273
-- Name: seller_integrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.seller_integrations_id_seq OWNED BY public.seller_integrations.id;


--
-- TOC entry 248 (class 1259 OID 18551)
-- Name: seller_pages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.seller_pages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id uuid NOT NULL,
    slug text NOT NULL,
    store_name text,
    store_description text,
    banner_color text DEFAULT '#6366f1'::text,
    logo_key text,
    pct_markup numeric(8,4) DEFAULT 0,
    active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    tagline character varying(160),
    whatsapp character varying(30),
    instagram character varying(60),
    facebook character varying(120),
    page_name character varying(80),
    logo_url character varying(500),
    font_family character varying(80),
    color_secondary character varying(7),
    color_bg character varying(7),
    color_text character varying(7),
    featured_categories jsonb,
    card_border_radius smallint DEFAULT 12,
    card_show_shadow boolean DEFAULT true,
    hero_headline text,
    hero_image_url text,
    promo_text text DEFAULT '🚀 Envíos a todo el país · 💳 Pago seguro · 📦 Stock disponible · ⭐ Los mejores precios'::text,
    show_promo_bar boolean DEFAULT true,
    theme_config jsonb DEFAULT '{}'::jsonb,
    hero_image_key character varying(500),
    costo_envio numeric DEFAULT 0 NOT NULL
);


ALTER TABLE public.seller_pages OWNER TO postgres;

--
-- TOC entry 265 (class 1259 OID 19432)
-- Name: seller_payouts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.seller_payouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    cvu character varying(22) NOT NULL,
    status character varying(20) DEFAULT 'en_proceso'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    transferred_at timestamp with time zone
);


ALTER TABLE public.seller_payouts OWNER TO postgres;

--
-- TOC entry 249 (class 1259 OID 18573)
-- Name: seller_products; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.seller_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id uuid NOT NULL,
    product_id uuid NOT NULL,
    active boolean DEFAULT true,
    custom_name text,
    custom_desc text,
    created_at timestamp without time zone DEFAULT now(),
    page_id uuid,
    custom_price numeric,
    free_shipping boolean DEFAULT false NOT NULL
);


ALTER TABLE public.seller_products OWNER TO postgres;

--
-- TOC entry 247 (class 1259 OID 18538)
-- Name: sellers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sellers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    password_hash text,
    name text,
    phone text,
    verified boolean DEFAULT false,
    verify_token text,
    reset_token text,
    reset_expires timestamp without time zone,
    active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    city character varying(100),
    age integer,
    how_found_us character varying(50),
    phone_verified boolean DEFAULT false,
    phone_otp character varying(6),
    phone_otp_expires_at timestamp without time zone,
    google_id text,
    cvu character varying(22),
    cvu_alias character varying(100),
    cvu_verified boolean DEFAULT false,
    cvu_holder_name character varying(200)
);


ALTER TABLE public.sellers OWNER TO postgres;

--
-- TOC entry 242 (class 1259 OID 17611)
-- Name: shop_users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.shop_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    name text,
    created_at timestamp without time zone DEFAULT now(),
    customer_id uuid
);


ALTER TABLE public.shop_users OWNER TO postgres;

--
-- TOC entry 228 (class 1259 OID 16593)
-- Name: stock; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stock (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    warehouse_id uuid NOT NULL,
    quantity integer DEFAULT 0
);


ALTER TABLE public.stock OWNER TO postgres;

--
-- TOC entry 270 (class 1259 OID 19859)
-- Name: stock_alerts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stock_alerts (
    product_id uuid NOT NULL,
    notified_at timestamp without time zone DEFAULT now(),
    available_stock integer
);


ALTER TABLE public.stock_alerts OWNER TO postgres;

--
-- TOC entry 253 (class 1259 OID 18645)
-- Name: transport_remitos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.transport_remitos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    numero integer NOT NULL,
    customer_id uuid,
    customer_name text,
    transporte_id uuid,
    envia text NOT NULL,
    bultos integer DEFAULT 1 NOT NULL,
    valor numeric(12,2),
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.transport_remitos OWNER TO postgres;

--
-- TOC entry 252 (class 1259 OID 18644)
-- Name: transport_remitos_numero_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.transport_remitos_numero_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.transport_remitos_numero_seq OWNER TO postgres;

--
-- TOC entry 5252 (class 0 OID 0)
-- Dependencies: 252
-- Name: transport_remitos_numero_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.transport_remitos_numero_seq OWNED BY public.transport_remitos.numero;


--
-- TOC entry 251 (class 1259 OID 18635)
-- Name: transportes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.transportes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    codigo text NOT NULL,
    razon_social text NOT NULL,
    domicilio text,
    telefono text NOT NULL,
    email text,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.transportes OWNER TO postgres;

--
-- TOC entry 222 (class 1259 OID 16520)
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    email text,
    password_hash text NOT NULL,
    role text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    warehouse_id uuid,
    active boolean DEFAULT true,
    pct_vendedor numeric(8,4) DEFAULT 0,
    negocio_id uuid NOT NULL
);


ALTER TABLE public.users OWNER TO postgres;

--
-- TOC entry 240 (class 1259 OID 17214)
-- Name: vendedores; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vendedores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nombre text NOT NULL,
    email text,
    activo boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    negocio_id uuid NOT NULL
);


ALTER TABLE public.vendedores OWNER TO postgres;

--
-- TOC entry 227 (class 1259 OID 16585)
-- Name: warehouses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.warehouses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    negocio_id uuid NOT NULL
);


ALTER TABLE public.warehouses OWNER TO postgres;

--
-- TOC entry 236 (class 1259 OID 16931)
-- Name: web_order_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.web_order_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    web_order_id uuid NOT NULL,
    product_id uuid,
    code text,
    name text NOT NULL,
    quantity integer NOT NULL,
    unit_price numeric(12,2) DEFAULT 0
);


ALTER TABLE public.web_order_items OWNER TO postgres;

--
-- TOC entry 235 (class 1259 OID 16912)
-- Name: web_orders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.web_orders (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    numero integer NOT NULL,
    customer_name text,
    customer_email text,
    customer_phone text,
    customer_city text,
    observaciones text,
    color text DEFAULT 'pending'::text,
    reservado boolean DEFAULT false,
    total numeric(12,2) DEFAULT 0,
    order_id uuid,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    customer_id uuid,
    seller_id uuid,
    negocio_id uuid,
    mp_payment_id text,
    shipping_amount numeric DEFAULT 0,
    free_shipping_absorbed numeric DEFAULT 0 NOT NULL
);


ALTER TABLE public.web_orders OWNER TO postgres;

--
-- TOC entry 234 (class 1259 OID 16911)
-- Name: web_orders_numero_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.web_orders_numero_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.web_orders_numero_seq OWNER TO postgres;

--
-- TOC entry 5253 (class 0 OID 0)
-- Dependencies: 234
-- Name: web_orders_numero_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.web_orders_numero_seq OWNED BY public.web_orders.numero;


--
-- TOC entry 4754 (class 2604 OID 18685)
-- Name: conversations id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.conversations ALTER COLUMN id SET DEFAULT nextval('public.conversations_id_seq'::regclass);


--
-- TOC entry 4791 (class 2604 OID 19877)
-- Name: integrations id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.integrations ALTER COLUMN id SET DEFAULT nextval('public.integrations_id_seq'::regclass);


--
-- TOC entry 4757 (class 2604 OID 18701)
-- Name: messages id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages ALTER COLUMN id SET DEFAULT nextval('public.messages_id_seq'::regclass);


--
-- TOC entry 4769 (class 2604 OID 18773)
-- Name: seller_discount_tiers id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_discount_tiers ALTER COLUMN id SET DEFAULT nextval('public.seller_discount_tiers_id_seq'::regclass);


--
-- TOC entry 4761 (class 2604 OID 18754)
-- Name: seller_discounts id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_discounts ALTER COLUMN id SET DEFAULT nextval('public.seller_discounts_id_seq'::regclass);


--
-- TOC entry 4793 (class 2604 OID 19889)
-- Name: seller_integrations id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_integrations ALTER COLUMN id SET DEFAULT nextval('public.seller_integrations_id_seq'::regclass);


--
-- TOC entry 4751 (class 2604 OID 18649)
-- Name: transport_remitos numero; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transport_remitos ALTER COLUMN numero SET DEFAULT nextval('public.transport_remitos_numero_seq'::regclass);


--
-- TOC entry 4673 (class 2604 OID 16916)
-- Name: web_orders numero; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.web_orders ALTER COLUMN numero SET DEFAULT nextval('public.web_orders_numero_seq'::regclass);


--
-- TOC entry 4983 (class 2606 OID 19512)
-- Name: admin_conversations admin_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.admin_conversations
    ADD CONSTRAINT admin_conversations_pkey PRIMARY KEY (id);


--
-- TOC entry 4985 (class 2606 OID 19514)
-- Name: admin_conversations admin_conversations_seller_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.admin_conversations
    ADD CONSTRAINT admin_conversations_seller_id_key UNIQUE (seller_id);


--
-- TOC entry 4987 (class 2606 OID 19529)
-- Name: admin_messages admin_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.admin_messages
    ADD CONSTRAINT admin_messages_pkey PRIMARY KEY (id);


--
-- TOC entry 4979 (class 2606 OID 19504)
-- Name: admin_users admin_users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_email_key UNIQUE (email);


--
-- TOC entry 4981 (class 2606 OID 19502)
-- Name: admin_users admin_users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_pkey PRIMARY KEY (id);


--
-- TOC entry 4873 (class 2606 OID 16670)
-- Name: cash_movements cash_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cash_movements
    ADD CONSTRAINT cash_movements_pkey PRIMARY KEY (id);


--
-- TOC entry 4831 (class 2606 OID 16547)
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- TOC entry 4894 (class 2606 OID 17063)
-- Name: cc_movimientos cc_movimientos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cc_movimientos
    ADD CONSTRAINT cc_movimientos_pkey PRIMARY KEY (id);


--
-- TOC entry 4925 (class 2606 OID 17683)
-- Name: cc_movimientos_prov cc_movimientos_prov_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cc_movimientos_prov
    ADD CONSTRAINT cc_movimientos_prov_pkey PRIMARY KEY (id);


--
-- TOC entry 5013 (class 2606 OID 26675)
-- Name: combo_images combo_images_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.combo_images
    ADD CONSTRAINT combo_images_pkey PRIMARY KEY (id);


--
-- TOC entry 5007 (class 2606 OID 26654)
-- Name: combo_products combo_products_combo_id_product_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.combo_products
    ADD CONSTRAINT combo_products_combo_id_product_id_key UNIQUE (combo_id, product_id);


--
-- TOC entry 5010 (class 2606 OID 26652)
-- Name: combo_products combo_products_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.combo_products
    ADD CONSTRAINT combo_products_pkey PRIMARY KEY (id);


--
-- TOC entry 4953 (class 2606 OID 18691)
-- Name: conversations conversations_access_token_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_access_token_key UNIQUE (access_token);


--
-- TOC entry 4955 (class 2606 OID 18689)
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- TOC entry 4889 (class 2606 OID 17048)
-- Name: cuentas_corrientes cuentas_corrientes_customer_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cuentas_corrientes
    ADD CONSTRAINT cuentas_corrientes_customer_id_key UNIQUE (customer_id);


--
-- TOC entry 4891 (class 2606 OID 17046)
-- Name: cuentas_corrientes cuentas_corrientes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cuentas_corrientes
    ADD CONSTRAINT cuentas_corrientes_pkey PRIMARY KEY (id);


--
-- TOC entry 4923 (class 2606 OID 17667)
-- Name: cuentas_corrientes_prov cuentas_corrientes_prov_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cuentas_corrientes_prov
    ADD CONSTRAINT cuentas_corrientes_prov_pkey PRIMARY KEY (id);


--
-- TOC entry 4828 (class 2606 OID 16539)
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- TOC entry 4914 (class 2606 OID 17628)
-- Name: favorites favorites_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_pkey PRIMARY KEY (id);


--
-- TOC entry 4916 (class 2606 OID 17630)
-- Name: favorites favorites_user_id_product_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_user_id_product_id_key UNIQUE (user_id, product_id);


--
-- TOC entry 4992 (class 2606 OID 19884)
-- Name: integrations integrations_key_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_key_key UNIQUE (key);


--
-- TOC entry 4994 (class 2606 OID 19882)
-- Name: integrations integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_pkey PRIMARY KEY (id);


--
-- TOC entry 4959 (class 2606 OID 18707)
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- TOC entry 4969 (class 2606 OID 19313)
-- Name: negocios negocios_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.negocios
    ADD CONSTRAINT negocios_pkey PRIMARY KEY (id);


--
-- TOC entry 4868 (class 2606 OID 16637)
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- TOC entry 4971 (class 2606 OID 19425)
-- Name: order_shipping order_shipping_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_shipping
    ADD CONSTRAINT order_shipping_pkey PRIMARY KEY (id);


--
-- TOC entry 4865 (class 2606 OID 16621)
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- TOC entry 5005 (class 2606 OID 26634)
-- Name: page_combos page_combos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.page_combos
    ADD CONSTRAINT page_combos_pkey PRIMARY KEY (id);


--
-- TOC entry 4871 (class 2606 OID 16656)
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- TOC entry 4904 (class 2606 OID 19365)
-- Name: price_config price_config_negocio_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.price_config
    ADD CONSTRAINT price_config_negocio_unique UNIQUE (negocio_id);


--
-- TOC entry 4906 (class 2606 OID 17587)
-- Name: price_config price_config_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.price_config
    ADD CONSTRAINT price_config_pkey PRIMARY KEY (id);


--
-- TOC entry 4876 (class 2606 OID 16677)
-- Name: product_costs product_costs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_costs
    ADD CONSTRAINT product_costs_pkey PRIMARY KEY (id);


--
-- TOC entry 4887 (class 2606 OID 16960)
-- Name: product_images product_images_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_pkey PRIMARY KEY (id);


--
-- TOC entry 5002 (class 2606 OID 26556)
-- Name: product_price_overrides product_price_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_price_overrides
    ADD CONSTRAINT product_price_overrides_pkey PRIMARY KEY (product_id);


--
-- TOC entry 4844 (class 2606 OID 16579)
-- Name: product_prices product_prices_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_prices
    ADD CONSTRAINT product_prices_pkey PRIMARY KEY (id);


--
-- TOC entry 4846 (class 2606 OID 17032)
-- Name: product_prices product_prices_product_id_price_type_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_prices
    ADD CONSTRAINT product_prices_product_id_price_type_key UNIQUE (product_id, price_type);


--
-- TOC entry 5000 (class 2606 OID 19920)
-- Name: product_reviews product_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_reviews
    ADD CONSTRAINT product_reviews_pkey PRIMARY KEY (id);


--
-- TOC entry 4839 (class 2606 OID 16564)
-- Name: products products_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_code_key UNIQUE (code);


--
-- TOC entry 4842 (class 2606 OID 16562)
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- TOC entry 4921 (class 2606 OID 17657)
-- Name: proveedores proveedores_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.proveedores
    ADD CONSTRAINT proveedores_pkey PRIMARY KEY (id);


--
-- TOC entry 4961 (class 2606 OID 18721)
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (filename);


--
-- TOC entry 4967 (class 2606 OID 18776)
-- Name: seller_discount_tiers seller_discount_tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_discount_tiers
    ADD CONSTRAINT seller_discount_tiers_pkey PRIMARY KEY (id);


--
-- TOC entry 4964 (class 2606 OID 18761)
-- Name: seller_discounts seller_discounts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_discounts
    ADD CONSTRAINT seller_discounts_pkey PRIMARY KEY (id);


--
-- TOC entry 4975 (class 2606 OID 19452)
-- Name: seller_earnings seller_earnings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_earnings
    ADD CONSTRAINT seller_earnings_pkey PRIMARY KEY (id);


--
-- TOC entry 4977 (class 2606 OID 19454)
-- Name: seller_earnings seller_earnings_web_order_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_earnings
    ADD CONSTRAINT seller_earnings_web_order_id_key UNIQUE (web_order_id);


--
-- TOC entry 4945 (class 2606 OID 18604)
-- Name: seller_images seller_images_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_images
    ADD CONSTRAINT seller_images_pkey PRIMARY KEY (id);


--
-- TOC entry 4996 (class 2606 OID 19898)
-- Name: seller_integrations seller_integrations_page_id_integration_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_integrations
    ADD CONSTRAINT seller_integrations_page_id_integration_id_key UNIQUE (page_id, integration_id);


--
-- TOC entry 4998 (class 2606 OID 19896)
-- Name: seller_integrations seller_integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_integrations
    ADD CONSTRAINT seller_integrations_pkey PRIMARY KEY (id);


--
-- TOC entry 4936 (class 2606 OID 18563)
-- Name: seller_pages seller_pages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_pages
    ADD CONSTRAINT seller_pages_pkey PRIMARY KEY (id);


--
-- TOC entry 4938 (class 2606 OID 18565)
-- Name: seller_pages seller_pages_slug_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_pages
    ADD CONSTRAINT seller_pages_slug_key UNIQUE (slug);


--
-- TOC entry 4973 (class 2606 OID 19439)
-- Name: seller_payouts seller_payouts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_payouts
    ADD CONSTRAINT seller_payouts_pkey PRIMARY KEY (id);


--
-- TOC entry 4942 (class 2606 OID 18582)
-- Name: seller_products seller_products_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_products
    ADD CONSTRAINT seller_products_pkey PRIMARY KEY (id);


--
-- TOC entry 4929 (class 2606 OID 18550)
-- Name: sellers sellers_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sellers
    ADD CONSTRAINT sellers_email_key UNIQUE (email);


--
-- TOC entry 4931 (class 2606 OID 19407)
-- Name: sellers sellers_google_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sellers
    ADD CONSTRAINT sellers_google_id_key UNIQUE (google_id);


--
-- TOC entry 4933 (class 2606 OID 18548)
-- Name: sellers sellers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sellers
    ADD CONSTRAINT sellers_pkey PRIMARY KEY (id);


--
-- TOC entry 4910 (class 2606 OID 17621)
-- Name: shop_users shop_users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shop_users
    ADD CONSTRAINT shop_users_email_key UNIQUE (email);


--
-- TOC entry 4912 (class 2606 OID 17619)
-- Name: shop_users shop_users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shop_users
    ADD CONSTRAINT shop_users_pkey PRIMARY KEY (id);


--
-- TOC entry 4990 (class 2606 OID 19864)
-- Name: stock_alerts stock_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_alerts
    ADD CONSTRAINT stock_alerts_pkey PRIMARY KEY (product_id);


--
-- TOC entry 4856 (class 2606 OID 16599)
-- Name: stock stock_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock
    ADD CONSTRAINT stock_pkey PRIMARY KEY (id);


--
-- TOC entry 4858 (class 2606 OID 16601)
-- Name: stock stock_product_id_warehouse_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock
    ADD CONSTRAINT stock_product_id_warehouse_id_key UNIQUE (product_id, warehouse_id);


--
-- TOC entry 4860 (class 2606 OID 17591)
-- Name: stock stock_product_warehouse_uq; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock
    ADD CONSTRAINT stock_product_warehouse_uq UNIQUE (product_id, warehouse_id);


--
-- TOC entry 4951 (class 2606 OID 18655)
-- Name: transport_remitos transport_remitos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transport_remitos
    ADD CONSTRAINT transport_remitos_pkey PRIMARY KEY (id);


--
-- TOC entry 4947 (class 2606 OID 18643)
-- Name: transportes transportes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transportes
    ADD CONSTRAINT transportes_pkey PRIMARY KEY (id);


--
-- TOC entry 4824 (class 2606 OID 16530)
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- TOC entry 4826 (class 2606 OID 16528)
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- TOC entry 4902 (class 2606 OID 17223)
-- Name: vendedores vendedores_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendedores
    ADD CONSTRAINT vendedores_pkey PRIMARY KEY (id);


--
-- TOC entry 4849 (class 2606 OID 17607)
-- Name: warehouses warehouses_name_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.warehouses
    ADD CONSTRAINT warehouses_name_unique UNIQUE (name);


--
-- TOC entry 4851 (class 2606 OID 19367)
-- Name: warehouses warehouses_negocio_name_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.warehouses
    ADD CONSTRAINT warehouses_negocio_name_unique UNIQUE (negocio_id, name);


--
-- TOC entry 4853 (class 2606 OID 16592)
-- Name: warehouses warehouses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.warehouses
    ADD CONSTRAINT warehouses_pkey PRIMARY KEY (id);


--
-- TOC entry 4885 (class 2606 OID 16939)
-- Name: web_order_items web_order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.web_order_items
    ADD CONSTRAINT web_order_items_pkey PRIMARY KEY (id);


--
-- TOC entry 4882 (class 2606 OID 16925)
-- Name: web_orders web_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.web_orders
    ADD CONSTRAINT web_orders_pkey PRIMARY KEY (id);


--
-- TOC entry 5011 (class 1259 OID 26686)
-- Name: combo_images_combo_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX combo_images_combo_idx ON public.combo_images USING btree (combo_id);


--
-- TOC entry 5008 (class 1259 OID 26665)
-- Name: combo_products_combo_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX combo_products_combo_idx ON public.combo_products USING btree (combo_id);


--
-- TOC entry 4988 (class 1259 OID 19535)
-- Name: idx_admin_messages_conv; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_admin_messages_conv ON public.admin_messages USING btree (conversation_id, created_at);


--
-- TOC entry 4874 (class 1259 OID 19376)
-- Name: idx_cash_movements_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cash_movements_negocio ON public.cash_movements USING btree (negocio_id);


--
-- TOC entry 4832 (class 1259 OID 19374)
-- Name: idx_categories_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_categories_negocio ON public.categories USING btree (negocio_id);


--
-- TOC entry 4895 (class 1259 OID 17074)
-- Name: idx_cc_movimientos_cuenta; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cc_movimientos_cuenta ON public.cc_movimientos USING btree (cuenta_corriente_id);


--
-- TOC entry 4896 (class 1259 OID 19403)
-- Name: idx_cc_movimientos_cuenta_tipo_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cc_movimientos_cuenta_tipo_date ON public.cc_movimientos USING btree (cuenta_corriente_id, tipo, created_at DESC);


--
-- TOC entry 4897 (class 1259 OID 18536)
-- Name: idx_cc_movimientos_divisa_cobro; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cc_movimientos_divisa_cobro ON public.cc_movimientos USING btree (divisa_cobro);


--
-- TOC entry 4898 (class 1259 OID 17075)
-- Name: idx_cc_movimientos_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cc_movimientos_order ON public.cc_movimientos USING btree (order_id);


--
-- TOC entry 4926 (class 1259 OID 18537)
-- Name: idx_cc_movimientos_prov_divisa_cobro; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cc_movimientos_prov_divisa_cobro ON public.cc_movimientos_prov USING btree (divisa_cobro);


--
-- TOC entry 4956 (class 1259 OID 19267)
-- Name: idx_conversations_seller; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_conversations_seller ON public.conversations USING btree (seller_id);


--
-- TOC entry 4892 (class 1259 OID 19404)
-- Name: idx_cuentas_corrientes_nonzero_saldo; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cuentas_corrientes_nonzero_saldo ON public.cuentas_corrientes USING btree (id) WHERE (saldo <> (0)::numeric);


--
-- TOC entry 4829 (class 1259 OID 19370)
-- Name: idx_customers_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_customers_negocio ON public.customers USING btree (negocio_id);


--
-- TOC entry 4917 (class 1259 OID 17641)
-- Name: idx_favorites_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_favorites_user_id ON public.favorites USING btree (user_id);


--
-- TOC entry 4957 (class 1259 OID 19268)
-- Name: idx_messages_conversation; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_messages_conversation ON public.messages USING btree (conversation_id);


--
-- TOC entry 4866 (class 1259 OID 16686)
-- Name: idx_order_items_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_order_items_order ON public.order_items USING btree (order_id);


--
-- TOC entry 4861 (class 1259 OID 16684)
-- Name: idx_orders_customer; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_orders_customer ON public.orders USING btree (customer_id);


--
-- TOC entry 4862 (class 1259 OID 19375)
-- Name: idx_orders_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_orders_negocio ON public.orders USING btree (negocio_id);


--
-- TOC entry 4863 (class 1259 OID 16685)
-- Name: idx_orders_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_orders_user ON public.orders USING btree (user_id);


--
-- TOC entry 4869 (class 1259 OID 16687)
-- Name: idx_payments_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_payments_order ON public.payments USING btree (order_id);


--
-- TOC entry 4833 (class 1259 OID 19401)
-- Name: idx_products_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_products_active ON public.products USING btree (negocio_id, name) WHERE (deleted_at IS NULL);


--
-- TOC entry 4834 (class 1259 OID 16683)
-- Name: idx_products_category; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_products_category ON public.products USING btree (category_id);


--
-- TOC entry 4835 (class 1259 OID 19402)
-- Name: idx_products_code_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_products_code_negocio ON public.products USING btree (code, negocio_id) WHERE (code IS NOT NULL);


--
-- TOC entry 4836 (class 1259 OID 17589)
-- Name: idx_products_costo_usd; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_products_costo_usd ON public.products USING btree (costo_usd);


--
-- TOC entry 4837 (class 1259 OID 19373)
-- Name: idx_products_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_products_negocio ON public.products USING btree (negocio_id);


--
-- TOC entry 4918 (class 1259 OID 17658)
-- Name: idx_proveedores_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_proveedores_name ON public.proveedores USING btree (name);


--
-- TOC entry 4919 (class 1259 OID 19371)
-- Name: idx_proveedores_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_proveedores_negocio ON public.proveedores USING btree (negocio_id);


--
-- TOC entry 4965 (class 1259 OID 18782)
-- Name: idx_seller_discount_tiers_seller; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_seller_discount_tiers_seller ON public.seller_discount_tiers USING btree (seller_id, threshold);


--
-- TOC entry 4943 (class 1259 OID 18623)
-- Name: idx_seller_images_sid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_seller_images_sid ON public.seller_images USING btree (seller_id, product_id);


--
-- TOC entry 4934 (class 1259 OID 18621)
-- Name: idx_seller_pages_slug; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_seller_pages_slug ON public.seller_pages USING btree (slug);


--
-- TOC entry 4939 (class 1259 OID 18622)
-- Name: idx_seller_products_sid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_seller_products_sid ON public.seller_products USING btree (seller_id);


--
-- TOC entry 4927 (class 1259 OID 18620)
-- Name: idx_sellers_email; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sellers_email ON public.sellers USING btree (email);


--
-- TOC entry 4907 (class 1259 OID 17648)
-- Name: idx_shop_users_customer_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_shop_users_customer_id ON public.shop_users USING btree (customer_id);


--
-- TOC entry 4908 (class 1259 OID 17642)
-- Name: idx_shop_users_email; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_shop_users_email ON public.shop_users USING btree (email);


--
-- TOC entry 4854 (class 1259 OID 16688)
-- Name: idx_stock_product; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_stock_product ON public.stock USING btree (product_id);


--
-- TOC entry 4948 (class 1259 OID 18666)
-- Name: idx_transport_remitos_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_transport_remitos_created_at ON public.transport_remitos USING btree (created_at DESC);


--
-- TOC entry 4949 (class 1259 OID 18667)
-- Name: idx_transport_remitos_customer_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_transport_remitos_customer_id ON public.transport_remitos USING btree (customer_id);


--
-- TOC entry 4822 (class 1259 OID 19368)
-- Name: idx_users_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_negocio ON public.users USING btree (negocio_id);


--
-- TOC entry 4899 (class 1259 OID 19372)
-- Name: idx_vendedores_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vendedores_negocio ON public.vendedores USING btree (negocio_id);


--
-- TOC entry 4900 (class 1259 OID 17224)
-- Name: idx_vendedores_nombre; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vendedores_nombre ON public.vendedores USING btree (nombre);


--
-- TOC entry 4847 (class 1259 OID 19369)
-- Name: idx_warehouses_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_warehouses_negocio ON public.warehouses USING btree (negocio_id);


--
-- TOC entry 4883 (class 1259 OID 16951)
-- Name: idx_web_order_items_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_web_order_items_order ON public.web_order_items USING btree (web_order_id);


--
-- TOC entry 4877 (class 1259 OID 16950)
-- Name: idx_web_orders_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_web_orders_created ON public.web_orders USING btree (created_at);


--
-- TOC entry 4878 (class 1259 OID 17076)
-- Name: idx_web_orders_customer; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_web_orders_customer ON public.web_orders USING btree (customer_id);


--
-- TOC entry 4879 (class 1259 OID 19390)
-- Name: idx_web_orders_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_web_orders_negocio ON public.web_orders USING btree (negocio_id);


--
-- TOC entry 4880 (class 1259 OID 18624)
-- Name: idx_web_orders_seller; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_web_orders_seller ON public.web_orders USING btree (seller_id);


--
-- TOC entry 5003 (class 1259 OID 26645)
-- Name: page_combos_page_active_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX page_combos_page_active_idx ON public.page_combos USING btree (page_id, active);


--
-- TOC entry 4840 (class 1259 OID 20265)
-- Name: products_embedding_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX products_embedding_idx ON public.products USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='100');


--
-- TOC entry 4962 (class 1259 OID 19278)
-- Name: seller_discounts_page_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX seller_discounts_page_id_key ON public.seller_discounts USING btree (page_id);


--
-- TOC entry 4940 (class 1259 OID 19289)
-- Name: seller_products_page_id_product_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX seller_products_page_id_product_id_key ON public.seller_products USING btree (page_id, product_id);


--
-- TOC entry 5092 (class 2620 OID 19871)
-- Name: stock trg_stock_alert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_stock_alert AFTER INSERT OR DELETE OR UPDATE ON public.stock FOR EACH ROW EXECUTE FUNCTION public.notify_stock_alert();


--
-- TOC entry 5077 (class 2606 OID 19515)
-- Name: admin_conversations admin_conversations_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.admin_conversations
    ADD CONSTRAINT admin_conversations_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.sellers(id) ON DELETE CASCADE;


--
-- TOC entry 5078 (class 2606 OID 19530)
-- Name: admin_messages admin_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.admin_messages
    ADD CONSTRAINT admin_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.admin_conversations(id) ON DELETE CASCADE;


--
-- TOC entry 5034 (class 2606 OID 19354)
-- Name: cash_movements cash_movements_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cash_movements
    ADD CONSTRAINT cash_movements_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id);


--
-- TOC entry 5035 (class 2606 OID 18630)
-- Name: cash_movements cash_movements_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cash_movements
    ADD CONSTRAINT cash_movements_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id);


--
-- TOC entry 5017 (class 2606 OID 19344)
-- Name: categories categories_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id);


--
-- TOC entry 5018 (class 2606 OID 16548)
-- Name: categories categories_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.categories(id) ON DELETE SET NULL;


--
-- TOC entry 5045 (class 2606 OID 17064)
-- Name: cc_movimientos cc_movimientos_cuenta_corriente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cc_movimientos
    ADD CONSTRAINT cc_movimientos_cuenta_corriente_id_fkey FOREIGN KEY (cuenta_corriente_id) REFERENCES public.cuentas_corrientes(id) ON DELETE CASCADE;


--
-- TOC entry 5046 (class 2606 OID 17069)
-- Name: cc_movimientos cc_movimientos_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cc_movimientos
    ADD CONSTRAINT cc_movimientos_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- TOC entry 5055 (class 2606 OID 17684)
-- Name: cc_movimientos_prov cc_movimientos_prov_cuenta_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cc_movimientos_prov
    ADD CONSTRAINT cc_movimientos_prov_cuenta_fkey FOREIGN KEY (cuenta_corriente_id) REFERENCES public.cuentas_corrientes_prov(id) ON DELETE CASCADE;


--
-- TOC entry 5056 (class 2606 OID 17689)
-- Name: cc_movimientos_prov cc_movimientos_prov_order_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cc_movimientos_prov
    ADD CONSTRAINT cc_movimientos_prov_order_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- TOC entry 5047 (class 2606 OID 19391)
-- Name: cc_movimientos cc_movimientos_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cc_movimientos
    ADD CONSTRAINT cc_movimientos_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id);


--
-- TOC entry 5090 (class 2606 OID 26676)
-- Name: combo_images combo_images_combo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.combo_images
    ADD CONSTRAINT combo_images_combo_id_fkey FOREIGN KEY (combo_id) REFERENCES public.page_combos(id) ON DELETE CASCADE;


--
-- TOC entry 5091 (class 2606 OID 26681)
-- Name: combo_images combo_images_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.combo_images
    ADD CONSTRAINT combo_images_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.sellers(id);


--
-- TOC entry 5088 (class 2606 OID 26655)
-- Name: combo_products combo_products_combo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.combo_products
    ADD CONSTRAINT combo_products_combo_id_fkey FOREIGN KEY (combo_id) REFERENCES public.page_combos(id) ON DELETE CASCADE;


--
-- TOC entry 5089 (class 2606 OID 26660)
-- Name: combo_products combo_products_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.combo_products
    ADD CONSTRAINT combo_products_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- TOC entry 5066 (class 2606 OID 18692)
-- Name: conversations conversations_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.sellers(id);


--
-- TOC entry 5044 (class 2606 OID 17049)
-- Name: cuentas_corrientes cuentas_corrientes_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cuentas_corrientes
    ADD CONSTRAINT cuentas_corrientes_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- TOC entry 5054 (class 2606 OID 17668)
-- Name: cuentas_corrientes_prov cuentas_corrientes_prov_proveedor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cuentas_corrientes_prov
    ADD CONSTRAINT cuentas_corrientes_prov_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES public.proveedores(id) ON DELETE CASCADE;


--
-- TOC entry 5016 (class 2606 OID 19324)
-- Name: customers customers_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id);


--
-- TOC entry 5051 (class 2606 OID 17636)
-- Name: favorites favorites_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- TOC entry 5052 (class 2606 OID 17631)
-- Name: favorites favorites_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.shop_users(id) ON DELETE CASCADE;


--
-- TOC entry 5067 (class 2606 OID 18708)
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id);


--
-- TOC entry 5031 (class 2606 OID 16638)
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- TOC entry 5032 (class 2606 OID 16643)
-- Name: order_items order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- TOC entry 5072 (class 2606 OID 19426)
-- Name: order_shipping order_shipping_web_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_shipping
    ADD CONSTRAINT order_shipping_web_order_id_fkey FOREIGN KEY (web_order_id) REFERENCES public.web_orders(id) ON DELETE CASCADE;


--
-- TOC entry 5025 (class 2606 OID 16622)
-- Name: orders orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- TOC entry 5026 (class 2606 OID 19349)
-- Name: orders orders_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id);


--
-- TOC entry 5027 (class 2606 OID 19396)
-- Name: orders orders_recipient_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES public.users(id);


--
-- TOC entry 5028 (class 2606 OID 17694)
-- Name: orders orders_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.proveedores(id) ON DELETE SET NULL;


--
-- TOC entry 5029 (class 2606 OID 16627)
-- Name: orders orders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- TOC entry 5030 (class 2606 OID 17699)
-- Name: orders orders_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE SET NULL;


--
-- TOC entry 5086 (class 2606 OID 26635)
-- Name: page_combos page_combos_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.page_combos
    ADD CONSTRAINT page_combos_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.seller_pages(id) ON DELETE CASCADE;


--
-- TOC entry 5087 (class 2606 OID 26640)
-- Name: page_combos page_combos_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.page_combos
    ADD CONSTRAINT page_combos_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.sellers(id) ON DELETE CASCADE;


--
-- TOC entry 5033 (class 2606 OID 16657)
-- Name: payments payments_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- TOC entry 5049 (class 2606 OID 19359)
-- Name: price_config price_config_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.price_config
    ADD CONSTRAINT price_config_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id);


--
-- TOC entry 5036 (class 2606 OID 16678)
-- Name: product_costs product_costs_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_costs
    ADD CONSTRAINT product_costs_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- TOC entry 5043 (class 2606 OID 16961)
-- Name: product_images product_images_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- TOC entry 5085 (class 2606 OID 26557)
-- Name: product_price_overrides product_price_overrides_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_price_overrides
    ADD CONSTRAINT product_price_overrides_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- TOC entry 5021 (class 2606 OID 16580)
-- Name: product_prices product_prices_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_prices
    ADD CONSTRAINT product_prices_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- TOC entry 5082 (class 2606 OID 19926)
-- Name: product_reviews product_reviews_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_reviews
    ADD CONSTRAINT product_reviews_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.seller_pages(id) ON DELETE CASCADE;


--
-- TOC entry 5083 (class 2606 OID 19921)
-- Name: product_reviews product_reviews_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_reviews
    ADD CONSTRAINT product_reviews_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- TOC entry 5084 (class 2606 OID 19931)
-- Name: product_reviews product_reviews_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_reviews
    ADD CONSTRAINT product_reviews_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.sellers(id) ON DELETE CASCADE;


--
-- TOC entry 5019 (class 2606 OID 16565)
-- Name: products products_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);


--
-- TOC entry 5020 (class 2606 OID 19339)
-- Name: products products_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id);


--
-- TOC entry 5053 (class 2606 OID 19329)
-- Name: proveedores proveedores_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.proveedores
    ADD CONSTRAINT proveedores_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id);


--
-- TOC entry 5070 (class 2606 OID 19279)
-- Name: seller_discount_tiers seller_discount_tiers_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_discount_tiers
    ADD CONSTRAINT seller_discount_tiers_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.seller_pages(id) ON DELETE CASCADE;


--
-- TOC entry 5071 (class 2606 OID 18777)
-- Name: seller_discount_tiers seller_discount_tiers_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_discount_tiers
    ADD CONSTRAINT seller_discount_tiers_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.sellers(id) ON DELETE CASCADE;


--
-- TOC entry 5068 (class 2606 OID 19273)
-- Name: seller_discounts seller_discounts_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_discounts
    ADD CONSTRAINT seller_discounts_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.seller_pages(id) ON DELETE CASCADE;


--
-- TOC entry 5069 (class 2606 OID 18764)
-- Name: seller_discounts seller_discounts_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_discounts
    ADD CONSTRAINT seller_discounts_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.sellers(id) ON DELETE CASCADE;


--
-- TOC entry 5074 (class 2606 OID 19465)
-- Name: seller_earnings seller_earnings_payout_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_earnings
    ADD CONSTRAINT seller_earnings_payout_id_fkey FOREIGN KEY (payout_id) REFERENCES public.seller_payouts(id);


--
-- TOC entry 5075 (class 2606 OID 19455)
-- Name: seller_earnings seller_earnings_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_earnings
    ADD CONSTRAINT seller_earnings_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.sellers(id);


--
-- TOC entry 5076 (class 2606 OID 19460)
-- Name: seller_earnings seller_earnings_web_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_earnings
    ADD CONSTRAINT seller_earnings_web_order_id_fkey FOREIGN KEY (web_order_id) REFERENCES public.web_orders(id);


--
-- TOC entry 5061 (class 2606 OID 19410)
-- Name: seller_images seller_images_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_images
    ADD CONSTRAINT seller_images_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.seller_pages(id) ON DELETE CASCADE;


--
-- TOC entry 5062 (class 2606 OID 18610)
-- Name: seller_images seller_images_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_images
    ADD CONSTRAINT seller_images_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- TOC entry 5063 (class 2606 OID 18605)
-- Name: seller_images seller_images_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_images
    ADD CONSTRAINT seller_images_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.sellers(id) ON DELETE CASCADE;


--
-- TOC entry 5080 (class 2606 OID 19904)
-- Name: seller_integrations seller_integrations_integration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_integrations
    ADD CONSTRAINT seller_integrations_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES public.integrations(id);


--
-- TOC entry 5081 (class 2606 OID 19899)
-- Name: seller_integrations seller_integrations_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_integrations
    ADD CONSTRAINT seller_integrations_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.seller_pages(id) ON DELETE CASCADE;


--
-- TOC entry 5057 (class 2606 OID 18568)
-- Name: seller_pages seller_pages_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_pages
    ADD CONSTRAINT seller_pages_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.sellers(id) ON DELETE CASCADE;


--
-- TOC entry 5073 (class 2606 OID 19440)
-- Name: seller_payouts seller_payouts_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_payouts
    ADD CONSTRAINT seller_payouts_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.sellers(id);


--
-- TOC entry 5058 (class 2606 OID 19284)
-- Name: seller_products seller_products_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_products
    ADD CONSTRAINT seller_products_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.seller_pages(id) ON DELETE CASCADE;


--
-- TOC entry 5059 (class 2606 OID 18590)
-- Name: seller_products seller_products_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_products
    ADD CONSTRAINT seller_products_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- TOC entry 5060 (class 2606 OID 18585)
-- Name: seller_products seller_products_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_products
    ADD CONSTRAINT seller_products_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.sellers(id) ON DELETE CASCADE;


--
-- TOC entry 5050 (class 2606 OID 17643)
-- Name: shop_users shop_users_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shop_users
    ADD CONSTRAINT shop_users_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- TOC entry 5079 (class 2606 OID 19865)
-- Name: stock_alerts stock_alerts_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_alerts
    ADD CONSTRAINT stock_alerts_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- TOC entry 5023 (class 2606 OID 16602)
-- Name: stock stock_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock
    ADD CONSTRAINT stock_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- TOC entry 5024 (class 2606 OID 16607)
-- Name: stock stock_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock
    ADD CONSTRAINT stock_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE CASCADE;


--
-- TOC entry 5064 (class 2606 OID 18656)
-- Name: transport_remitos transport_remitos_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transport_remitos
    ADD CONSTRAINT transport_remitos_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- TOC entry 5065 (class 2606 OID 18661)
-- Name: transport_remitos transport_remitos_transporte_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transport_remitos
    ADD CONSTRAINT transport_remitos_transporte_id_fkey FOREIGN KEY (transporte_id) REFERENCES public.transportes(id) ON DELETE SET NULL;


--
-- TOC entry 5014 (class 2606 OID 19314)
-- Name: users users_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id);


--
-- TOC entry 5015 (class 2606 OID 17704)
-- Name: users users_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE SET NULL;


--
-- TOC entry 5048 (class 2606 OID 19334)
-- Name: vendedores vendedores_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendedores
    ADD CONSTRAINT vendedores_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id);


--
-- TOC entry 5022 (class 2606 OID 19319)
-- Name: warehouses warehouses_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.warehouses
    ADD CONSTRAINT warehouses_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id);


--
-- TOC entry 5041 (class 2606 OID 16945)
-- Name: web_order_items web_order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.web_order_items
    ADD CONSTRAINT web_order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- TOC entry 5042 (class 2606 OID 16940)
-- Name: web_order_items web_order_items_web_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.web_order_items
    ADD CONSTRAINT web_order_items_web_order_id_fkey FOREIGN KEY (web_order_id) REFERENCES public.web_orders(id) ON DELETE CASCADE;


--
-- TOC entry 5037 (class 2606 OID 17033)
-- Name: web_orders web_orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.web_orders
    ADD CONSTRAINT web_orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- TOC entry 5038 (class 2606 OID 19385)
-- Name: web_orders web_orders_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.web_orders
    ADD CONSTRAINT web_orders_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id);


--
-- TOC entry 5039 (class 2606 OID 16926)
-- Name: web_orders web_orders_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.web_orders
    ADD CONSTRAINT web_orders_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- TOC entry 5040 (class 2606 OID 18615)
-- Name: web_orders web_orders_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.web_orders
    ADD CONSTRAINT web_orders_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.sellers(id) ON DELETE SET NULL;


-- Completed on 2026-05-09 00:35:11

--
-- PostgreSQL database dump complete
--

