import { handleUpload } from "@vercel/blob/client";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed." });
  }
  const body = request.body;
  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async pathname => {
        if (!String(pathname || "").startsWith("avdesigner/projects/")) {
          throw new Error("Invalid upload path.");
        }
        return {
          allowedContentTypes: [
            "application/json",
            "text/html",
            "text/html;charset=utf-8",
            "text/html; charset=utf-8"
          ],
          addRandomSuffix: false
        };
      },
      onUploadCompleted: async () => {}
    });
    return response.status(200).json(jsonResponse);
  } catch (error) {
    return response.status(400).json({ error: error.message || "Upload failed." });
  }
}
