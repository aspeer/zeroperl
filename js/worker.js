// Backward-compatible Cloudflare entrypoint. New integrations should import
// the explicit provider export, while existing consumers can keep `/worker`.
export { createCloudflareWorker, createCloudflareWorker as createWebDyneWorker } from "./provider/cloudflare.js";
export { buildPagiScope } from "./transport/fetch-pagi.js";
