function json(response, status, payload) {
  response.status(status).setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

export default async function handler(request, response) {
  return json(response, 200, {
    ok: true,
    blobConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    method: request.method
  });
}
