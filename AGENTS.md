<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Deployment

- For Vercel operations, use the Vercel MCP connector as the default path.
- Before any deploy, rollback, deployment-status check, or protection check, discover/load the Vercel MCP tools first.
- Do not use `vercel` CLI or `npx vercel` for deployment unless the Vercel MCP lacks the required capability or the user explicitly asks for CLI use.
