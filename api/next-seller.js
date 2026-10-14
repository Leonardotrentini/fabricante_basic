/**
 * Rodízio global de vendedores da LP.
 * Contador atômico via Vercel KV / Upstash (INCR). Sem KV, o contador fica na instância.
 */

const VESTO_KEY = "vpk_93cf9b950d43873cf990fcef56eb174b"
const MESSAGE = "Vim do site, e gostaria de comprar no atacado!"
const OFFICIAL_SELLERS = [{ label: "Alexsander", phone: "5521980802382" }]
const CONFIG_URL =
  "https://backend-production-7a466.up.railway.app/api/public/meta/config?key=" +
  encodeURIComponent(VESTO_KEY)
const LP_ORIGIN = "https://fabricante-basic.vercel.app"
const SEQ_KEY = "lp_v3_lead_seller_seq"

let sellersCache = { at: 0, sellers: null }
let memorySeq = 0

function normalizeSeller(item) {
  if (!item || typeof item !== "object") return null
  const phone = String(item.phone || item.whatsapp || "").replace(/\D/g, "")
  if (!/^55\d{10,11}$/.test(phone)) return null
  return { label: String(item.label || item.name || "").trim(), phone }
}

function uniqueSellers(list) {
  const seen = new Set()
  const out = []
  for (const item of list) {
    const seller = normalizeSeller(item)
    if (!seller || seen.has(seller.phone)) continue
    seen.add(seller.phone)
    out.push(seller)
  }
  return out
}

async function loadSellers() {
  if (sellersCache.sellers && Date.now() - sellersCache.at < 60_000) {
    return sellersCache.sellers
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 800)
  try {
    const res = await fetch(CONFIG_URL, {
      headers: {
        Accept: "application/json",
        "X-Vesto-Key": VESTO_KEY,
        Origin: LP_ORIGIN,
      },
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error("config_" + res.status)
    const data = await res.json()
    const sellers = uniqueSellers(Array.isArray(data.sellers) ? data.sellers : [])
    if (!sellers.length) throw new Error("config_empty")
    sellersCache = { at: Date.now(), sellers }
    return sellers
  } catch {
    return OFFICIAL_SELLERS
  } finally {
    clearTimeout(timer)
  }
}

async function nextSeq() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  if (url && token) {
    const endpoint = String(url).replace(/\/$/, "") + "/incr/" + SEQ_KEY
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
    })
    if (res.ok) {
      const data = await res.json()
      const n = Number(data.result)
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  memorySeq += 1
  return memorySeq
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store")
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD")
    return res.status(405).json({ ok: false, error: "method_not_allowed" })
  }

  try {
    const sellers = await loadSellers()
    if (!sellers.length) {
      return res.status(503).json({ ok: false, error: "no_sellers" })
    }
    const seq = await nextSeq()
    const index = (seq - 1) % sellers.length
    const seller = sellers[index]
    return res.status(200).json({
      ok: true,
      phone: seller.phone,
      label: seller.label,
      index,
      total: sellers.length,
      seq,
      message: MESSAGE,
    })
  } catch (err) {
    console.error("[next-seller]", err && err.message ? err.message : err)
    return res.status(500).json({ ok: false, error: "next_seller_failed" })
  }
}
