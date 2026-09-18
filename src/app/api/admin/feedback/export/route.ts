import { feedbackToCsv, listFeedback } from "@/lib/feedback";

export async function GET() {
  const csv = feedbackToCsv(listFeedback());
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=feedback-export.csv",
    },
  });
}
