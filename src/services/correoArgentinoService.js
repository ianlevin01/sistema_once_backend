const DEFAULT_DIMS = { height: 15, width: 20, length: 25 };

let _token        = null;
let _tokenExpires = null;
let _renewTimer   = null;

function cfg() {
  return {
    BASE_URL:       process.env.MICORREO_BASE_URL ?? "https://api.correoargentino.com.ar/micorreo/v1",
    USER:           process.env.MICORREO_USER,
    PASS:           process.env.MICORREO_PASS,
    CUSTOMER_ID:    process.env.MICORREO_CUSTOMER_ID,
    ORIGIN_CP:      process.env.MICORREO_ORIGIN_CP,
    DEFAULT_WEIGHT: parseInt(process.env.MICORREO_WEIGHT_GRAMS ?? "500"),
  };
}

function formatCustomerId(id) {
  return String(id).padStart(10, "0");
}

async function authenticate() {
  const { BASE_URL, USER, PASS } = cfg();
  if (!USER || !PASS) throw new Error("Correo Argentino credentials not configured (MICORREO_USER / MICORREO_PASS)");
  const creds = Buffer.from(`${USER}:${PASS}`).toString("base64");
  const res   = await fetch(`${BASE_URL}/token`, {
    method:  "POST",
    headers: { Authorization: `Basic ${creds}` },
  });
  if (!res.ok) throw new Error(`Correo auth failed: ${res.status}`);
  const data = await res.json();
  _token = data.token ?? data.access_token ?? data.accessToken;
  if (!_token) throw new Error(`Correo auth: no token in response (keys: ${Object.keys(data).join(", ")})`);

  const expiresRaw = data.expires ?? data.expiration ?? data.expiresAt ?? data.expire ?? null;
  if (typeof expiresRaw === "string") {
    _tokenExpires = new Date(expiresRaw.replace(" ", "T") + "-03:00");
  } else if (typeof expiresRaw === "number") {
    _tokenExpires = new Date(Date.now() + expiresRaw * 1000);
  } else {
    _tokenExpires = new Date(Date.now() + 55 * 60 * 1000);
  }

  if (_renewTimer) clearTimeout(_renewTimer);
  const renewIn = _tokenExpires.getTime() - Date.now() - 2 * 60 * 1000;
  if (renewIn > 0) _renewTimer = setTimeout(authenticate, renewIn);
  return _token;
}

async function getToken() {
  const twoMinFromNow = Date.now() + 2 * 60 * 1000;
  if (!_token || !_tokenExpires || _tokenExpires.getTime() <= twoMinFromNow) {
    await authenticate();
  }
  return _token;
}

// ── /rates ────────────────────────────────────────────────────────────────────
export async function getRates(postalCodeDestination, dimensions = {}) {
  const { BASE_URL, CUSTOMER_ID, ORIGIN_CP, DEFAULT_WEIGHT } = cfg();
  if (!CUSTOMER_ID || !ORIGIN_CP) throw new Error("Correo Argentino not fully configured");
  const token = await getToken();
  const body  = {
    customerId:             formatCustomerId(CUSTOMER_ID),
    postalCodeOrigin:       ORIGIN_CP,
    postalCodeDestination,
    dimensions: {
      weight: dimensions.weight ?? DEFAULT_WEIGHT,
      height: dimensions.height ?? DEFAULT_DIMS.height,
      width:  dimensions.width  ?? DEFAULT_DIMS.width,
      length: dimensions.length ?? DEFAULT_DIMS.length,
    },
  };
  const res  = await fetch(`${BASE_URL}/rates`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Correo rates failed: ${res.status}`);
  const data  = await res.json();
  const rates = Array.isArray(data) ? data : (data.rates ?? []);
  return rates.filter((r) => Number(r.price) > 0);
}

// ── /agencies ─────────────────────────────────────────────────────────────────
export async function getAgencies(provinceCode) {
  const { BASE_URL, CUSTOMER_ID } = cfg();
  if (!CUSTOMER_ID) throw new Error("Correo Argentino not fully configured");
  const token  = await getToken();
  const params = new URLSearchParams({ customerId: formatCustomerId(CUSTOMER_ID), provinceCode });
  const res    = await fetch(`${BASE_URL}/agencies?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Correo agencies failed: ${res.status}`);
  return res.json();
}

// ── /shipping/import ──────────────────────────────────────────────────────────
export async function importShipping({ orderId, orderNumber, recipient, shipping, declaredValue }) {
  const { BASE_URL, CUSTOMER_ID, DEFAULT_WEIGHT } = cfg();
  if (!CUSTOMER_ID) throw new Error("Correo Argentino not fully configured");
  const token  = await getToken();
  const isHome = shipping.deliveryType === "D";
  const body   = {
    customerId:  formatCustomerId(CUSTOMER_ID),
    extOrderId:  String(orderId),
    orderNumber: String(orderNumber),
    recipient: {
      name:      recipient.name      || "",
      phone:     recipient.phone     || "",
      cellPhone: recipient.cellPhone || "",
      email:     recipient.email     || "",
    },
    shipping: {
      deliveryType: shipping.deliveryType,
      productType:  shipping.productType ?? "CP",
      agency:       shipping.agency      ?? null,
      address: {
        streetName:   isHome ? (shipping.streetName   ?? "") : "",
        streetNumber: isHome ? (shipping.streetNumber ?? "") : "",
        floor:        shipping.floor      ?? "",
        apartment:    shipping.apartment  ?? "",
        city:         isHome ? (shipping.city ?? "") : "",
        provinceCode: shipping.provinceCode ?? "",
        postalCode:   shipping.postalCode   ?? "",
      },
      weight:        shipping.weight  ?? DEFAULT_WEIGHT,
      declaredValue: Math.round(declaredValue ?? 0),
      height:        shipping.height  ?? DEFAULT_DIMS.height,
      length:        shipping.length  ?? DEFAULT_DIMS.length,
      width:         shipping.width   ?? DEFAULT_DIMS.width,
    },
  };
  const res  = await fetch(`${BASE_URL}/shipping/import`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Correo import failed: ${res.status}`);
  return data;
}
