import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const GenerateFigureInput = z.object({
  prompt: z.string().min(1).max(2000),
  aspectRatio: z.enum(["1:1", "16:9", "4:3", "3:4"]).default("4:3"),
});

export const generateFigureImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => GenerateFigureInput.parse(d))
  .handler(async ({ data }) => {
    const { generateImage } = await import("ai");
    const { figureImageModel } = await import("./ai-gateway.server");

    const { image } = await generateImage({
      model: figureImageModel(),
      prompt: `Academic figure for a written document. Render any labels, axis text, or captions clearly and accurately spelled. Clean, neutral, textbook-diagram style — no watermarks, no surrounding chrome. Subject: ${data.prompt}`,
      aspectRatio: data.aspectRatio,
    });

    return { base64: image.base64, mediaType: image.mediaType };
  });
