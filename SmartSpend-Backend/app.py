from flask import Flask, request, jsonify
import joblib
import os
from supabase import create_client
import google.generativeai as genai
from dotenv import load_dotenv
import numpy as np
import pandas as pd
import re
import warnings

# Suppress sklearn warnings
warnings.filterwarnings('ignore', category=UserWarning, module='sklearn')

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
print("📋 Listing available Gemini models...")
for m in genai.list_models():
    print("-", m.name)

app = Flask(__name__)

# ML model
try:
    PACK = joblib.load("budget_model.pkl")
    MODEL = PACK["model"]
    FEATURES = PACK.get("features", ["Age", "Income"])
    print(f"✅ Model loaded successfully with features: {FEATURES}")
except Exception as e:
    print(f"❌ Failed to load model: {e}")
    MODEL = None
    FEATURES = ["Age", "Income"]


def _num(v, default=0.0):
    try:
        return float(v)
    except:
        return float(default)


# ---------- Clean response ----------
def clean_response(text: str) -> str:
    if not text:
        return ""

    out = str(text)

    # Remove code blocks
    out = re.sub(r"```[\s\S]*?```", "", out)
    out = re.sub(r"~~~[\s\S]*?~~~", "", out)
    out = re.sub(r"`([^`]+)`", r"\1", out)

    # Remove disclaimers / unwanted
    ban = [
        "not financial advice",
        "educational purposes",
        "consult a financial advisor",
        "general guidance",
        "json format",
        "benchmark",
        "assuming",
    ]
    out = "\n".join(
        line for line in out.splitlines()
        if not any(b.lower() in line.lower() for b in ban)
    )

    # Normalize bullets/numbers
    out = re.sub(r"^\s*[-*•]\s*", "- ", out, flags=re.M)
    out = re.sub(r"^\s*\d+\s*[\)\.]\s+", lambda m: f"{m.group(0).strip('.) ')}. ", out, flags=re.M)

    # Convert markdown headings into proper ## format
    out = re.sub(r"(?m)^#+\s*(.+)", r"## \1", out)
    out = re.sub(r"(?m)^Step\s*(\d+)", r"## Step \1", out)

    # Bold Rs + %
    out = re.sub(r"\b(?:LKR|Rs\.?)\s?\d[\d,]*(?:\.\d+)?\b",
                 lambda m: f"**{m.group(0)}**", out)
    out = re.sub(r"\b\d{1,3}(?:\.\d+)?\s?%\b",
                 lambda m: f"**{m.group(0)}**", out)

    # Compact blank lines
    out = re.sub(r"\n{3,}", "\n\n", out)

    return out.strip()


# ---------- Invalid input check ----------
def is_invalid_message(msg: str) -> bool:
    if not msg.strip():
        return True
    cleaned = re.sub(r"[^\w\s]", "", msg).strip()
    return len(cleaned) == 0


# ---------- Finance intent check ----------
FINANCE_KEYWORDS = [
    "save", "saving", "savings",
    "invest", "investment", "investing",
    "expense", "spending", "budget", "debt",
    "income", "salary", "loan", "finance", "financial",
    "target", "goal", "money",
    "මුදල්", "ඉතුරුම්", "ඉතුරුම් කිරීම", "වැය", "වියදම්",
    "ඇණවුම්", "ආදායම", "කැපවීම්", "වාරික", "ගෙවීම්", "ණය",
    "பணம்", "சம்பளம்", "சேமிப்பு", "முதலீடு", "செலவு",
    "பட்ஜெட்", "கடன்", "வருவாய்", "நிதி", "சம்பாதி"
]

def is_off_topic(msg: str) -> bool:
    text = msg.lower()
    return not any(word in text for word in FINANCE_KEYWORDS)


# ---------- Budget recommendation logic ----------
def generate_budget_recommendation(age, income, categories, weights=None):
    """Generate budget recommendation using ML model and rules"""
    
    print(f"🎯 Generating recommendation for Age: {age}, Income: {income}")
    print(f"📊 Categories: {categories}")
    print(f"⚖️ Weights: {weights}")
    
    # Default category allocations (as percentages of income)
    default_allocations = {
        'food': 0.25,
        'transport': 0.15, 
        'housing': 0.20,
        'utilities': 0.08,
        'healthcare': 0.05,
        'education': 0.05,
        'entertainment': 0.08,
        'savings': 0.10,
        'emergency': 0.04
    }
    
    # Normalize category names for matching
    def normalize_name(name):
        return name.lower().strip()
    
    # Create recommendation dictionary
    recommendation = {}
    allocated_percentage = 0
    
    # Try ML model prediction for savings if available
    ml_savings_amount = None
    if MODEL is not None:
        try:
            # Create input with proper feature names
            if len(FEATURES) >= 2:
                input_data = pd.DataFrame({
                    FEATURES[0]: [age],
                    FEATURES[1]: [income]
                })
            else:
                input_data = np.array([[age, income]])
            
            ml_prediction = MODEL.predict(input_data)[0]
            ml_savings_amount = max(0, float(ml_prediction))
            print(f"🤖 ML predicted savings: Rs. {ml_savings_amount}")
        except Exception as e:
            print(f"⚠️ ML prediction failed: {e}")
            ml_savings_amount = None
    
    # Allocate based on categories provided
    for category in categories:
        norm_cat = normalize_name(category)
        
        # Find matching default allocation
        allocated_amount = 0
        for default_key, default_pct in default_allocations.items():
            if default_key in norm_cat or norm_cat in default_key:
                allocated_amount = income * default_pct
                allocated_percentage += default_pct
                break
        
        # If no match found, allocate based on weights or default small amount
        if allocated_amount == 0:
            if weights and category in weights and weights[category] > 0:
                # Use historical spending as basis
                weight_total = sum(weights.values())
                weight_pct = weights[category] / weight_total if weight_total > 0 else 0
                allocated_amount = min(income * 0.15, income * weight_pct * 2)  # Cap at 15%
            else:
                allocated_amount = income * 0.03  # 3% default
            
            allocated_percentage += allocated_amount / income
        
        recommendation[category] = round(allocated_amount, 2)
    
    # Handle savings specially if ML model provided a prediction
    savings_categories = [cat for cat in categories if 'saving' in normalize_name(cat)]
    if savings_categories and ml_savings_amount is not None:
        savings_cat = savings_categories[0]
        old_savings = recommendation.get(savings_cat, 0)
        recommendation[savings_cat] = round(ml_savings_amount, 2)
        
        # Adjust allocated percentage
        allocated_percentage += (ml_savings_amount - old_savings) / income
    
    # Ensure we don't exceed income
    total_allocated = sum(recommendation.values())
    if total_allocated > income:
        # Scale down proportionally
        scale_factor = income / total_allocated
        for cat in recommendation:
            recommendation[cat] = round(recommendation[cat] * scale_factor, 2)
        total_allocated = sum(recommendation.values())
    
    # Distribute remaining amount if any
    remaining = income - total_allocated
    if remaining > 1:  # More than Rs. 1 remaining
        # Add to savings if exists, otherwise distribute evenly
        savings_cats = [cat for cat in categories if 'saving' in normalize_name(cat)]
        if savings_cats:
            recommendation[savings_cats[0]] += round(remaining, 2)
        else:
            # Distribute evenly
            per_category = remaining / len(categories)
            for cat in recommendation:
                recommendation[cat] += round(per_category, 2)
    
    print(f"✅ Generated recommendation: {recommendation}")
    return recommendation


# ---------- Health check endpoint ----------
@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({
        "status": "healthy",
        "service": "SmartSpend AI",
        "model_loaded": MODEL is not None,
        "features": FEATURES
    })


# ---------- Budget recommendation endpoint ----------
@app.route('/recommend', methods=['POST'])
@app.route('/api/recommend', methods=['POST'])
@app.route('/recommendation', methods=['POST'])
@app.route('/api/recommendation', methods=['POST'])
@app.route('/api/v1/recommend', methods=['POST'])
@app.route('/budget/recommend', methods=['POST'])
@app.route('/ai/recommend', methods=['POST'])
def recommend_budget():
    try:
        data = request.get_json(force=True)
        
        # Extract parameters
        age = _num(data.get("age", 25))
        income = _num(data.get("income", 0))
        categories = data.get("categories", [])
        weights = data.get("weights", {})
        
        print(f"📥 Recommendation request: age={age}, income={income}, categories={len(categories)}")
        
        # Validate input
        if income <= 0:
            return jsonify({"error": "Income must be greater than 0"}), 400
        
        if not categories:
            return jsonify({"error": "Categories list cannot be empty"}), 400
        
        # Generate recommendation
        recommendation = generate_budget_recommendation(age, income, categories, weights)
        
        return jsonify({
            "recommendation": recommendation,
            "total_allocated": sum(recommendation.values()),
            "income": income,
            "model_used": MODEL is not None
        })
        
    except Exception as e:
        print(f"❌ Recommendation error: {e}")
        return jsonify({"error": f"Failed to generate recommendation: {str(e)}"}), 500


# ---------- Chatbot endpoint ----------
# ---------- Chatbot endpoint ----------
@app.route("/chatbot", methods=["POST"])
def chatbot():
    data = request.get_json(force=True)
    user_id = data.get("user_id")
    user_msg = (data.get("message") or "").strip()

    if not user_id:
        return jsonify({"message": "⚠️ No user ID provided."})

    if is_invalid_message(user_msg):
        return jsonify({
            "message": (
                "❌ I am unable to respond to this type of message.\n\n"
                "👉 Please ask a question related to **finance**, such as:\n"
                "- Savings\n"
                "- Investment advice\n"
                "- Financial planning"
            )
        })

    if is_off_topic(user_msg):
        return jsonify({
            "message": (
                "❌ Sorry, I can only help with **finance-related questions**.\n\n"
                "👉 Try asking about:\n"
                "- Savings target\n"
                "- Investments\n"
                "- Spending cuts\n"
                "- Budgeting"
            )
        })

    # -------------------------
    # 1. Fetch user profile
    # -------------------------
    try:
        user_row = supabase.table("users").select(
            "id, age, monthly_income").eq("id", user_id).execute()
        age = _num(user_row.data[0].get("age", 0)) if user_row.data else 0
        main_income = _num(user_row.data[0].get("monthly_income", 0)) if user_row.data else 0
    except Exception as e:
        print(f"❌ Failed to fetch user profile: {e}")
        age, main_income = 0, 0

    # -------------------------
    # 2. Fetch other tables
    # -------------------------
    try:
        income_records = supabase.table("income").select("*").eq("user_id", user_id).execute().data or []
        expense_records = supabase.table("expenses").select("*").eq("user_id", user_id).execute().data or []
        accounts = supabase.table("accounts").select("*").eq("user_id", user_id).execute().data or []
        transactions = supabase.table("transactions").select("*").eq("user_id", user_id).execute().data or []
        sms_records = supabase.table("sms_records").select("*").eq("user_id", user_id).execute().data or []
        categories = supabase.table("categories").select("*").eq("user_id", user_id).execute().data or []
    except Exception as e:
        print(f"❌ Failed to fetch user data: {e}")
        income_records = expense_records = accounts = transactions = sms_records = categories = []

    # Income & expenses
    category_lookup = {cat["id"]: cat.get("name", "Other") for cat in categories}

    income_breakdown = {"main_income": main_income, "extras": [], "total": main_income}
    for inc in income_records:
        if inc.get("source") == "BaseMonthly":
            continue
        amt = _num(inc.get("amount", 0))
        income_breakdown["extras"].append({"source": inc.get("source", "Other"), "amount": amt})
        income_breakdown["total"] += amt

    expense_breakdown = {"items": [], "total": 0.0}
    for exp in expense_records:
        amt = _num(exp.get("amount", 0))
        cat_id = exp.get("category_id")
        cat_name = category_lookup.get(cat_id, exp.get("name", "Other"))
        expense_breakdown["items"].append({"name": cat_name, "amount": amt})
        expense_breakdown["total"] += amt

    total_income = income_breakdown["total"]
    total_expenses = expense_breakdown["total"]
    savings = total_income - total_expenses
    savings_rate = (savings / total_income * 100) if total_income > 0 else 0

    # Benchmark
    try:
        bm_rows = supabase.table("benchmarks").select("*").execute().data or []
        best_row, best_diff = None, float("inf")
        for row in bm_rows:
            diff = abs(total_income - _num(row.get("mean_income")))
            if diff < best_diff:
                best_row, best_diff = row, diff
        benchmark = best_row or {}
    except Exception as e:
        print(f"❌ Failed to fetch benchmarks: {e}")
        benchmark = {}

    # ML prediction (safe unwrap)
    pred_savings = None
    if MODEL is not None:
        try:
            if len(FEATURES) >= 2:
                input_data = pd.DataFrame({
                    FEATURES[0]: [age],
                    FEATURES[1]: [total_income]
                })
            else:
                input_data = np.array([[age, total_income]])

            raw_pred = MODEL.predict(input_data)
            if isinstance(raw_pred, (list, np.ndarray, pd.Series)):
                pred_savings = float(np.ravel(raw_pred)[0])
            else:
                pred_savings = float(raw_pred)

            print(f"🤖 ML predicted savings (chatbot): Rs. {pred_savings}")
        except Exception as e:
            print(f"❌ ML prediction failed in chatbot: {e}")
            pred_savings = None

    # -------------------------
    # Fallback: no user data
    # -------------------------
    user_has_data = (
        total_income > 0 or total_expenses > 0 or accounts or transactions or sms_records or categories
    )

    if not user_has_data:
        fallback_prompt = f"""
        You are SmartSpend's Finance Assistant 🤖💰.

        The user asked: "{user_msg}"
        
        Please provide helpful financial advice and tips since they haven't set up their financial data yet.
        Keep the response friendly, practical, and encouraging them to track their finances.
        """
        try:
            model = genai.GenerativeModel("models/gemini-2.5-flash")
            resp = model.generate_content([fallback_prompt])


            response_text = getattr(resp, "text", None)
            if not response_text:
                raise ValueError("Gemini returned no text")

            return jsonify({
                "message": clean_response(response_text),
                "grounding_used": {"benchmark": benchmark}
            })
        except Exception as e:
            print(f"❌ Gemini call failed (fallback): {e}")
            return jsonify({
                "message": "⚠️ Something went wrong while generating fallback advice."
            }), 500

    # -------------------------
    # Main Gemini prompt
    # -------------------------
    grounding = {
        "age": age,
        "income": income_breakdown,
        "expenses": expense_breakdown,
        "accounts": accounts,
        "transactions": transactions,
        "sms_records": sms_records,
        "categories": categories,
        "savings": savings,
        "savings_rate": savings_rate,
        "benchmark": benchmark,
        "model_suggestion": pred_savings,
    }

    exp_list = "\n".join(
        [f"- {item['name']}: Rs. {item['amount']}" for item in expense_breakdown["items"]]
    ) if expense_breakdown["items"] else "No detailed expense items available."

    prompt = f"""
    You are SmartSpend's friendly Finance Assistant 🤖💰.

    User's Financial Summary:
    - Age: {age} years
    - Total Monthly Income: Rs. {total_income:,.2f}
    - Total Monthly Expenses: Rs. {total_expenses:,.2f}
    - Current Savings: Rs. {savings:,.2f}
    - Savings Rate: {savings_rate:.1f}%

    Recent Expenses:
    {exp_list}

    The user has asked: "{user_msg}"

    Please provide personalized financial advice based on their actual data.
    Be specific, actionable, and reference their numbers when relevant.
    """

    try:
        model = genai.GenerativeModel("models/gemini-2.5-flash")
        resp = model.generate_content([prompt])


        response_text = getattr(resp, "text", None)
        if not response_text:
            raise ValueError("Gemini returned no text")

        return jsonify({
            "message": clean_response(response_text),
            "grounding_used": grounding
        })
    except Exception as e:
        print(f"❌ Gemini call failed (main): {e}")
        return jsonify({
            "message": "⚠️ Something went wrong while processing your request."
        }), 500



if __name__ == "__main__":
    print("🚀 Starting SmartSpend AI Service...")
    print(f"📊 Model loaded: {MODEL is not None}")
    print(f"🔧 Features: {FEATURES}")
    app.run(host="0.0.0.0", port=5050, debug=False)
    