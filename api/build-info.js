export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.status(200).json({
    ok: true,
    deploymentSource: process.env.VERCEL ? "vercel" : "local-api",
    gitCommit: process.env.VERCEL_GIT_COMMIT_SHA || "",
    gitBranch: process.env.VERCEL_GIT_COMMIT_REF || "",
    gitRepo: process.env.VERCEL_GIT_REPO_SLUG || "",
    gitOwner: process.env.VERCEL_GIT_REPO_OWNER || "",
    vercelEnv: process.env.VERCEL_ENV || "",
    vercelRegion: process.env.VERCEL_REGION || "",
    vercelUrl: process.env.VERCEL_URL || "",
    generatedAt: new Date().toISOString()
  });
}
