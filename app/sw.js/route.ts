import { deploymentRevision, serviceWorkerScript } from "../../lib/serviceWorker";

export const dynamic = "force-dynamic";

export function GET() {
  return new Response(serviceWorkerScript(deploymentRevision()), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store, max-age=0, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}
