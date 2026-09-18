import { z } from "zod";

export const STYLES = ["minimal", "premium", "playful", "bold"] as const;
export type Style = (typeof STYLES)[number];

export const generateRequestSchema = z.object({
  prompt: z.string().trim().min(1, "Description is required").max(2000),
  style: z.enum(STYLES),
});

export type GenerateRequest = z.infer<typeof generateRequestSchema>;

const hexColor = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Must be a hex color");

export const featureSchema = z.object({
  title: z.string().min(1).max(80),
  description: z.string().min(1).max(240),
});

export const generatedSiteSchema = z.object({
  headline: z.string().min(1).max(120),
  subheadline: z.string().min(1).max(240),
  cta: z.string().min(1).max(40),
  features: z.array(featureSchema).length(3),
  testimonial: z.object({
    quote: z.string().min(1).max(320),
    author: z.string().min(1).max(80),
  }),
  colorPalette: z.object({
    primary: hexColor,
    secondary: hexColor,
    accent: hexColor,
    background: hexColor,
    text: hexColor,
  }),
});

export type GeneratedSite = z.infer<typeof generatedSiteSchema>;
