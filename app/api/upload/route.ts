import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File;
  const orgId = formData.get("orgId") as string;

  if (!file || !orgId) {
    return new Response(JSON.stringify({ error: "Missing file or orgId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const uploadDir = path.join(process.cwd(), "data", "uploads", orgId);
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const ext = path.extname(file.name);
  const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  const filePath = path.join(uploadDir, uniqueName);

  const bytes = await file.arrayBuffer();
  fs.writeFileSync(filePath, Buffer.from(bytes));

  const isImage = file.type.startsWith("image/");

  return new Response(
    JSON.stringify({
      filename: file.name,
      savedAs: uniqueName,
      path: filePath,
      type: file.type,
      isImage,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
}
