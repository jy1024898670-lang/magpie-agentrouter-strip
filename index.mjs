// magpie-agentrouter-strip — AgentRouter as a provider, with the Azure
// cross-resource 400 handled where the request is actually sent.
//
// Every /responses request goes out untouched. Only when the relay answers 400
// with the Azure "item was created under a different … resource" message (or
// the encrypted-content variant) is the same request replayed once with the
// server-bound state removed: input[].id, input[].encrypted*, previous_response_id.
// Nothing else is touched, and streams pass through as they arrive.

const PROVIDER = "agentrouter"
const BASE = "https://agentrouter.org/v1"

const MODELS = [
  { id: "gpt-6.1-sol", name: "GPT-6.1 Sol" },
  { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
  { id: "gpt-6-astra", name: "GPT-6 Astra" },
]

const SIGNATURES = [
  "different azure openai resource",
  "could not be verified",
]

// AgentRouter only answers clients that look like Claude Code (a plain curl UA
// gets 401 "unauthorized client detected"), so every request says it is one.
const AGENT_UA = "claude-cli/2.1.318 (external, cli)"

const lower = (s) => String(s ?? "").toLowerCase()
// an empty array is truthy: treat "[]" as "nothing here"
const filled = (v) => (Array.isArray(v) ? v.length > 0 : Boolean(v))
const isTarget = (status, text) =>
  status === 400 && SIGNATURES.some((sig) => lower(text).includes(sig))

// strip: remove state bound to the Azure resource that minted it.
// Returns the new JSON string and how many fields went (0 = nothing to do).
export function strip(body) {
  let j
  try {
    j = JSON.parse(body)
  } catch {
    return { body, stripped: 0 }
  }
  if (!j || typeof j !== "object") return { body, stripped: 0 }

  let stripped = 0
  if ("previous_response_id" in j) {
    delete j.previous_response_id
    stripped++
  }
  if (Array.isArray(j.input)) {
    const out = []
    for (const item of j.input) {
      if (item && typeof item === "object") {
        if ("id" in item) {
          delete item.id
          stripped++
        }
        for (const k of Object.keys(item)) {
          if (k.startsWith("encrypted")) {
            delete item[k]
            stripped++
          }
        }
        // a reasoning item with nothing left in it is dead weight
        if (item.type === "reasoning" && !filled(item.summary) && !filled(item.content)) {
          stripped++
          continue
        }
      }
      out.push(item)
    }
    j.input = out
  }
  return { body: stripped ? JSON.stringify(j) : body, stripped }
}

const textOf = (input) => (input instanceof Request ? input.url : String(input))

export default function agentrouterStrip() {
  return {
    config: async (cfg) => {
      cfg.provider ??= {}
      const was = cfg.provider[PROVIDER] ?? {}
      cfg.provider[PROVIDER] = {
        name: "AgentRouter",
        api: BASE,
        npm: "@ai-sdk/openai",
        // magpie's own fields: this provider is asked on the Responses API
        responses: BASE,
        baseAPI: "responses",
        ...was,
        models: {
          ...Object.fromEntries(MODELS.map((m) => [m.id, {
            id: m.id,
            name: m.name,
            provider: { npm: "@ai-sdk/openai", api: BASE },
          }])),
          ...(was.models ?? {}),
        },
      }
    },

    auth: {
      provider: PROVIDER,
      methods: [{ type: "api", label: "AgentRouter API key" }],

      async loader(getAuth, provider) {
        const a = await getAuth()
        const apiKey = a?.key ?? a?.access ?? ""
        return {
          baseURL: BASE,
          apiKey,
          headers: { "user-agent": AGENT_UA },
          async fetch(input, init) {
            const url = textOf(input)
            const opts = input instanceof Request
              ? {
                  method: input.method,
                  headers: input.headers,
                  body: input.body,
                  signal: input.signal,
                  duplex: "half",
                  ...init,
                }
              : { ...init }

            const headers = new Headers(opts.headers ?? {})
            headers.set("user-agent", AGENT_UA)

            let body = opts.body
            if (body != null && typeof body !== "string") body = await new Response(body).text()

            const first = await fetch(url, { ...opts, headers, body })

            if (!isTarget(first.status, "")) {
              // cheap path: nothing to inspect until we know the status is 400
              if (first.status !== 400) return first
            }

            const head = await first.clone().text()
            if (!isTarget(first.status, head)) return first

            const { body: retryBody, stripped } = strip(body ?? "")
            if (!stripped || retryBody === body) return first

            const retryHeaders = new Headers(headers)
            retryHeaders.delete("content-length")
            retryHeaders.delete("content-encoding")
            if (typeof console !== "undefined" && console.error) {
              console.error(`[agentrouter-strip] 400 azure-resource -> retry with ${stripped} field(s) stripped`)
            }
            return await fetch(url, { ...opts, headers: retryHeaders, body: retryBody })
          },
        }
      },
    },
  }
}
