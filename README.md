# Grok3 API Cloudflare Worker

A Cloudflare Worker implementation for the Grok3 API.


## Deployment

```bash
npx wrangler deploy
npx wrangler secret put AUTH_TOKEN
npx wrangler secret put GROK3_COOKIE
```

### Explain

- `AUTH_TOKEN`: The token you will be using like an OPENAI API token, see below in the curl command
- `GROK3_COOKIE`: It looks like `sso=ey...; sso-rw=ey...`, you can copy it from your browser

## Usage

```bash
curl -H "Authorization: Bearer AUTH_TOKEN" \
-X POST 'https://your-worker-url.workers.dev/v1/chat/completions' \
-H 'Content-Type: application/json' \
-d '{"messages": [{"role": "user", "content": "Hello"}], "model": "grok-3"}'
```

## Special Thanks

- [mem0ai/grok3-api: Unofficial Grok 3 API](https://github.com/mem0ai/grok3-api)

## License

MIT