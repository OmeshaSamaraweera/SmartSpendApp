// SmartSpend-Frontend/services/chatApi.js
import { supabase } from "./supabase";
import Constants from "expo-constants";

// ✅ Centralized backend URL from app.json
const apiUrl = Constants.expoConfig.extra.apiUrl;

export async function askInvestAssistant({ messages, targetLang, grounding }) {
  try {
    // ✅ Always get logged in user id from Supabase
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) throw new Error("No logged in user. Please log in.");

    const latestMessage = messages[messages.length - 1]?.content || "";

    // ✅ Detect if the user is explicitly asking about budgets
    const lowerMsg = latestMessage.toLowerCase();
    const isBudgetQuery =
      lowerMsg.includes("budget") || lowerMsg.includes("limit");

    let res;
    try {
      res = await fetch(`${apiUrl}/chatbot`, {   // 👈 use apiUrl here
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: user.id,
          message: latestMessage,
          grounding,
          targetLang,
          // 🔒 Stronger control instructions for Gemini
          control_instructions: [
            "CRITICAL RULES:",
            "• NEVER generate lines like 'Your X budget is ...' or 'Your expenses are ...'.",
            "• NEVER show 'Current Expenses' or 'Total Expenses'.",
            "• ONLY use SmartPlan values as the single source of truth.",
            "• Phrase as: 'Your budget limit for <category> this month is Rs. XXXX'.",
            "• If user asks for one category → show only that category.",
            "• If user asks for all budgets → show clean bullet list, each category once, no duplicates.",
            "• DO NOT invent expenses, totals, or extra budget lines.",
            "• DO NOT mix budget limits with spending or expenses.",
            isBudgetQuery
              ? "• IMPORTANT: If the user asks for budget limits, DO NOT add savings suggestions, surplus analysis, or commentary. Reply with ONLY the requested budget limit(s)."
              : "• If the user asks for financial advice (not budgets), you may include savings or investment suggestions.",
            "• Respond clearly and concisely in the user’s requested language.",
          ].join(" "),
        }),
      });
    } catch (netErr) {
      // 🚫 No network / backend not reachable
      throw new Error("Network request failed. Is your backend running?");
    }

    // 🚫 Handle unreachable server responses
    if (!res || typeof res.status !== "number") {
      throw new Error("Invalid response from backend (no status).");
    }

    if (res.status === 0) {
      throw new Error(
        "Network error: Backend unreachable (status 0). Check apiUrl."
      );
    }

    if (!res.ok) {
      // ✅ Special handling for quota exceeded (429)
      if (res.status === 429) {
        throw new Error(
          "⚠️ Sorry, the daily request limit has been reached for the Finance Assistant. " +
            "Please try again tomorrow, and I’ll be ready to help you again with your financial planning."
        );
      }

      // ✅ For all other errors → show only clean message, not raw JSON
      const text = await res.text().catch(() => "");
      throw new Error(
        `⚠️ The Finance Assistant service returned an error (status ${res.status}). ` +
          (text ? "Please try again later." : "")
      );
    }

    // ✅ Parse JSON safely
    return await res.json();
  } catch (err) {
    console.error("askInvestAssistant error:", err.message || err);
    return {
      message:
        err?.message ||
        "⚠️ Sorry, something went wrong with the Finance Assistant. Please try again later.",
    };
  }
}
