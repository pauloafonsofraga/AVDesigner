import { put, head } from "@vercel/blob";
import crypto from "node:crypto";
import zlib from "node:zlib";

const PROJECT_PREFIX = "avdesigner/projects";
const MAX_TITLE_LENGTH = 120;
const MAX_PASSWORD_LENGTH = 160;

function json(response, status, payload) {
  response.status(status).setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

function slugify(value) {
  return String(value || "project")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "project";
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return { salt, hash, iterations: 120000, digest: "sha256" };
}

function readBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");
  return {};
}

function inflateBase64(value) {
  if (!value) return "";
  return zlib.gunzipSync(Buffer.from(String(value), "base64")).toString("utf8");
}

function safeBlobPath(value, id, filename) {
  const path = String(value || "").trim();
  const expectedPrefix = `${PROJECT_PREFIX}/${id}/`;
  if (!path.startsWith(expectedPrefix) || !path.endsWith(`/${filename}`)) return "";
  return path;
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return json(response, 405, { error: "Method not allowed." });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return json(response, 500, { error: "Vercel Blob is not configured for this deployment." });
  }

  try {
    const body = readBody(request);
    const title = String(body.title || body.project?.projectName || "Untitled AV Wirechart").trim().slice(0, MAX_TITLE_LENGTH);
    const password = String(body.password || "");

    if (password.length < 4) return json(response, 400, { error: "Password must be at least 4 characters." });
    if (password.length > MAX_PASSWORD_LENGTH) return json(response, 400, { error: "Password is too long." });

    const id = String(body.id || `${slugify(title)}-${crypto.randomBytes(5).toString("hex")}`);
    const basePath = `${PROJECT_PREFIX}/${id}`;
    let projectPath = safeBlobPath(body.projectPath || body.projectBlob?.pathname, id, "project.json");
    let htmlPath = safeBlobPath(body.htmlPath || body.htmlBlob?.pathname, id, "viewer.html");

    if (!projectPath || !htmlPath) {
      const projectText = body.projectGzipBase64 ? inflateBase64(body.projectGzipBase64) : JSON.stringify(body.project || {});
      const project = JSON.parse(projectText || "{}");
      const html = body.htmlGzipBase64 ? inflateBase64(body.htmlGzipBase64) : String(body.html || "");
      if (!project || typeof project !== "object") return json(response, 400, { error: "Missing project data." });
      if (!html.trim()) return json(response, 400, { error: "Missing hosted viewer HTML." });
      projectPath = `${basePath}/project.json`;
      htmlPath = `${basePath}/viewer.html`;
      await Promise.all([
        put(projectPath, projectText, {
          access: "private",
          contentType: "application/json"
        }),
        put(htmlPath, html, {
          access: "private",
          contentType: "text/html; charset=utf-8"
        })
      ]);
    } else {
      await Promise.all([
        head(projectPath),
        head(htmlPath)
      ]);
    }

    const passwordRecord = hashPassword(password);
    const now = new Date().toISOString();
    const metadata = {
      id,
      title,
      projectName: title,
      createdAt: now,
      updatedAt: now,
      password: passwordRecord,
      projectPath,
      htmlPath,
      schema: 1
    };

    await put(`${basePath}/meta.json`, JSON.stringify(metadata), {
      access: "private",
      contentType: "application/json"
    });

    const origin = request.headers.origin || `https://${request.headers.host}`;
    return json(response, 200, {
      id,
      title,
      url: `${origin}/v/${encodeURIComponent(id)}`
    });
  } catch (error) {
    return json(response, 500, { error: error.message || "Publish failed." });
  }
}
