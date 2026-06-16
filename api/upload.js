import { handleUpload } from "@vercel/blob/client";

export default async function handler(request) {
  const body = await request.json();
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
    return Response.json(jsonResponse);
  } catch (error) {
    return Response.json(
      { error: error.message || "Upload failed." },
      { status: 400 }
    );
  }
}
