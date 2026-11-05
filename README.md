# magpie-agentrouter-strip

A [magpie](https://usemagpie.ai) provider plugin for **AgentRouter** that repairs the
Azure OpenAI cross-resource 400 where the request is actually sent.

> Relay returns `400 The requested item was created under a different Azure OpenAI
> resource` because the Responses API is stateful and the relay rotates between
> several Azure resources with no session affinity. This plugin forwards every
> request untouched, and only when that exact error comes back does it replay the
> same request once with the server-bound state removed.

中文说明见下方 [中文](#中文说明)。

## What it does

```
Claude Code ──(Anthropic)──▶ magpie :3425 ──(Responses)──▶ AgentRouter
                                    │
                                    └─ plugin fetch():
                                         1. send body as-is
                                         2. 400 + azure signature?
                                            → strip, retry once
                                         3. otherwise pass the response through
```

Stripped on retry only:

- top-level `previous_response_id`
- `input[].id` on every item
- every `input[].encrypted*` field (encrypted reasoning)
- reasoning items left with no `summary` and no `content`

Not touched: message text, `call_id`, tool definitions, tool arguments, streaming.
Streams pass through chunk by chunk, nothing is buffered.

## Install

```bash
magpie plugin add /path/to/magpie-agentrouter-strip
magpie plugin login agentrouter        # paste your AgentRouter API key
magpie provider test agentrouter-plugin # expect: ✓ responses
```

The plugin adds a provider whose **routing id is `agentrouter-plugin`**, so models are
addressed as `agentrouter-plugin/gpt-6.1-sol` (not `agentrouter/...`). Update any
model reference or routing group you already have.

## Removing

```bash
magpie plugin rm /path/to/magpie-agentrouter-strip
```

## Three things that will bite you

1. **The API shape comes from the model's `npm`, not from `baseAPI`.** Default
   `@ai-sdk/openai-compatible` means Chat Completions, which `gpt-6.x` rejects with 400.
   This plugin pins `@ai-sdk/openai` so requests go to `/responses`.
2. **AgentRouter fingerprints the client.** A plain `curl` UA gets
   `401 unauthorized client detected`; only `claude-cli/…` passes. The UA is forced in
   `auth.loader` and again on every fetch.
3. **A plugin provider shares its id with a same-named entry in `providers.json`**, and
   magpie exposes the plugin's models under `<id>-plugin`. Keys typed into the panel are
   not used for the plugin path: `magpie plugin login` stores its own auth.

## Test

```bash
node --test        # strip() unit tests, no network
```

## Caveats

- The retry is a second `POST`, so a request that hits the 400 pays for one extra round
  trip. Nothing else in the conversation is affected.
- Cross-turn reasoning continuity is lost on the retried turn (`previous_response_id` is
  gone by design). Prompt caching still applies.
- Only `/responses` traffic is touched. `/chat/completions` is passed through as-is.

## 中文说明

把 AgentRouter 变成 magpie 的一个 provider，并在请求真正发出的地方处理 Azure 跨资源 400：

- 每个 `/responses` 请求先**原样发出**，一个字节都不改；
- 只有当上游返回 400 且命中 `different azure openai resource` / `could not be verified`
  时，才剥掉 `input[].id`、`input[].encrypted*`、`previous_response_id` 重发一次；
- 其余情况（包括其它 400）一律原样回给客户端，不误伤；
- 流式响应按块透传，不缓冲。

相对独立的本地代理方案，它省掉了一个端口、一个常驻进程和一条开机自启。

安装后 provider 的路由 id 是 `agentrouter-plugin`，模型写作
`agentrouter-plugin/gpt-6.1-sol`。已有的路由分组（`auto-…`）成员也要改成这个前缀。

三个踩过的坑（接口类型由 `npm` 决定、AgentRouter 校验 `claude-cli` UA、插件 provider
会顶掉同 id 的 `providers.json` 条目）见上方英文第 1–3 条。

## License

MIT
