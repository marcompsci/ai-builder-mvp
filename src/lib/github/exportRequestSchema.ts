import { z } from "zod";

// `confirm: true` is a literal, not a boolean - this is the enforcement
// point for requirement #10 ("clear user approval immediately before
// creating a GitHub repository or pushing commits"). Omitting it, or
// sending false, fails validation before any GitHub API call is made.
export const exportRequestSchema = z.object({
  confirm: z.literal(true),
  mode: z.enum(["existing", "create_new"]),
  repoFullName: z.string().min(1).optional(),
  newRepoName: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9._-]+$/, "Repository names may only contain letters, numbers, dots, hyphens, and underscores.")
    .optional(),
  branch: z.string().trim().min(1).max(200),
});

export type ExportRequest = z.infer<typeof exportRequestSchema>;
