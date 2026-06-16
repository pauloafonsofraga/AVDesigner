import { get } from "@vercel/blob";
import crypto from "node:crypto";

const PROJECT_PREFIX = "avdesigner/projects";
const MAX_PASSWORD_LENGTH = 160;

function json(response, status, payload) {
  response.status(status).setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");
  return {};
}

function safeProjectId(value) {
  const id = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{2,90}$/.test(id)) return "";
  return id;
}

function verifyPassword(password, record) {
  if (!record?.salt || !record?.hash) return false;
  const iterations = Number(record.iterations) || 120000;
  const digest = record.digest || "sha256";
  const hash = crypto.pbkdf2Sync(password, record.salt, iterations, 32, digest).toString("hex");
  const expected = Buffer.from(record.hash, "hex");
  const actual = Buffer.from(hash, "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function blobText(pathname) {
  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) return "";
  return await new Response(result.stream).text();
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return json(response, 405, { error: "Method not allowed." });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return json(response, 500, { error: "Hosted viewer storage is not configured for this deployment." });
  }

  try {
    const body = readBody(request);
    const id = safeProjectId(body.id);
    const password = String(body.password || "");

    if (!id) return json(response, 400, { error: "Invalid viewer link." });
    if (!password) return json(response, 400, { error: "Enter the project password." });
    if (password.length > MAX_PASSWORD_LENGTH) return json(response, 400, { error: "Password is too long." });

    const metaText = await blobText(`${PROJECT_PREFIX}/${id}/meta.json`);
    if (!metaText) return json(response, 404, { error: "Project was not found." });

    const metadata = JSON.parse(metaText);
    if (!verifyPassword(password, metadata.password)) {
      return json(response, 401, { error: "Password is incorrect." });
    }

    const html = await blobText(metadata.htmlPath);
    if (!html) return json(response, 404, { error: "The hosted viewer file was not found." });

    return json(response, 200, {
      id,
      title: metadata.title,
      projectName: metadata.projectName,
      html
    });
  } catch (error) {
    return json(response, 500, { error: error.message || "Could not open project." });
  }
}
