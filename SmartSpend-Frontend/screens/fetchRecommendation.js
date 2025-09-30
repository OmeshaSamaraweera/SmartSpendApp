// screens/fetchRecommendation.js
import axios from 'axios';
import { Alert } from 'react-native';
import { supabase } from '../services/supabase';
import Constants from 'expo-constants';

const appExtra =
  (Constants?.expoConfig && Constants.expoConfig.extra) ||
  (Constants?.manifest2 && Constants.manifest2.extra) ||
  (Constants?.manifest && Constants.manifest.extra) ||
  {};



const apiUrl = Constants.expoConfig.extra.apiUrl; //http://192.168.75.202:5050

/* ------------------------------------------------------------------ */
/*                              Session                                */
/* ------------------------------------------------------------------ */
export const getCurrentUserId = async () => {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  return session?.user?.id || null;
};

/* ------------------------------------------------------------------ */
/*                       Effective Budgeting Income                    */
/* ------------------------------------------------------------------ */
export async function getBudgetingIncome(uid) {
  const { data: profile, error: pErr } = await supabase
    .from('users')
    .select('monthly_income, age')
    .eq('id', uid)
    .maybeSingle();
  if (pErr) throw pErr;

  const base = Number(profile?.monthly_income || 0);

  const firstDay = new Date();
  firstDay.setDate(1);
  const firstDayStr = firstDay.toISOString().slice(0, 10);

  const BASE_SOURCE = 'BaseMonthly';

  // Prefer logical date
  let { data: rows, error: iErr } = await supabase
    .from('income')
    .select('amount, date, created_at, source, note')
    .eq('user_id', uid)
    .gte('date', firstDayStr)
    .neq('source', BASE_SOURCE);
  if (iErr) throw iErr;

  // Fallback to created_at
  if (!rows || rows.length === 0) {
    const { data: rows2, error: iErr2 } = await supabase
      .from('income')
      .select('amount, created_at, source, note')
      .eq('user_id', uid)
      .gte('created_at', firstDayStr)
      .neq('source', BASE_SOURCE);
    if (!iErr2 && rows2) rows = rows2;
  }

  const extra = (rows || []).reduce((s, r) => s + Number(r.amount || 0), 0);
  return { income: base + extra, age: profile?.age || null };
}

/* ------------------------------------------------------------------ */
/*                    This-month spend weights (by cat)                */
/* ------------------------------------------------------------------ */
async function getRecentSpendWeights(uid) {
  const firstDay = new Date();
  firstDay.setDate(1);
  const firstDayStr = firstDay.toISOString().slice(0, 10);

  // Build a local map id -> name
  const { data: catRows, error: catErr } = await supabase
    .from('categories')
    .select('id, name')
    .eq('user_id', uid)
    .eq('type', 'expense');
  if (catErr) throw catErr;
  const idToName = {};
  for (const c of catRows || []) idToName[c.id] = c.name;

  const cols = 'amount, date, created_at, category_id, categories(name)';

  // Prefer logical date
  let { data: rows, error } = await supabase
    .from('expenses')
    .select(cols)
    .eq('user_id', uid)
    .gte('date', firstDayStr);
  if (error) throw error;

  // Fallback to created_at
  if (!rows || rows.length === 0) {
    const { data: rows2, error: e2 } = await supabase
      .from('expenses')
      .select(cols)
      .eq('user_id', uid)
      .gte('created_at', firstDayStr);
    if (e2) throw e2;
    rows = rows2 || [];
  }

  const weights = {};
  for (const r of rows) {
    const nameFromJoin = r?.categories?.name;
    const nameFromMap  = idToName?.[r?.category_id];
    const name = (nameFromJoin || nameFromMap || '').trim();
    if (!name) continue;
    weights[name] = (weights[name] || 0) + Number(r.amount || 0);
  }
  return weights; // e.g. { Shopping: 12000, Food: 34000, ... }
}

/* ------------------------------------------------------------------ */
/*                         Post-process helpers                        */
/* ------------------------------------------------------------------ */
const norm = (s = '') => s.trim().toLowerCase();
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

/** Essentials that must never be zero, case-insensitive */
const ESSENTIALS = ['utilities', 'food', 'transport', 'healthcare'];

/** Minimum floors for essentials as % of income */
const ESSENTIAL_MIN_PCT = {
  food: 0.18,
  transport: 0.05,
  utilities: 0.04,
  healthcare: 0.05,
};

const findKeyCI = (obj, target) => Object.keys(obj).find(k => norm(k) === norm(target));

/* ------------------------------------------------------------------ */
/*                  Category filtering (whitelist + heuristics)        */
/* ------------------------------------------------------------------ */
/** Hard whitelist (case-insensitive). Add/remove as you prefer. */
const KNOWN_CATEGORIES = [
  'Food','Transport','Housing','Utilities','Healthcare',
  'Education','Entertainment','Savings','Emergency','Buffer',
  'Clothing','Shopping','Subscriptions','Insurance','Gifts',
  'Charity','Personal Care','Pets','Debt'
];

/** Obvious junk names to reject quickly */
const BLOCKLIST_EXACT = ['blah','misc','test','tests','sample','stuff','random','unknown'];

function isValidCategory(name, weightsMap) {
  if (!name) return false;
  const n = norm(name);

  // 1) Hard blocklist
  if (BLOCKLIST_EXACT.includes(n)) return false;

  // 2) Hard whitelist
  if (KNOWN_CATEGORIES.some(k => norm(k) === n)) return true;

  // 3) Heuristics: at least 3 chars, must contain a letter
  if (n.length < 3 || !/[a-z]/.test(n)) return false;

  // 4) If user actually spent in it this month, keep it (user-specific)
  //    This lets reasonable custom names pass when they're used.
  if (weightsMap && Number(weightsMap[name]) > 0) return true;

  // 5) Otherwise reject by default (prevents nonsense buckets from taking money)
  return false;
}

/* ------------------------------------------------------------------ */
/*                         Post-process allocation                     */
/* ------------------------------------------------------------------ */
function postProcessRecommendation({ rawRec, income, categories, weights }) {
  const userCats = (categories || []).map(String);
  const namesLower = new Set(userCats.map(norm));
  const out = {};
  const reasons = {};

  // 1) Start with backend result
  for (const [k, v] of Object.entries(rawRec || {})) out[k] = Number(v) || 0;

  // 2) Ensure every user category exists
  for (const name of userCats) if (out[name] === undefined) out[name] = 0;

  // 3) Generic floors/caps
  const floorsPct = { healthcare: 0.05, education: 0.03 };
  const capsPct   = { savings: 0.20 };

  const hcKey = findKeyCI(out, 'Healthcare');
  if (hcKey && namesLower.has('healthcare')) {
    const min = income * floorsPct.healthcare;
    if ((out[hcKey] || 0) < min) out[hcKey] = min;
  }
  const eduKey = findKeyCI(out, 'Education');
  if (eduKey && namesLower.has('education')) {
    const min = income * floorsPct.education;
    if ((out[eduKey] || 0) < min) out[eduKey] = min;
  }

  // 3a) Essentials floors
  for (const [ess, pct] of Object.entries(ESSENTIAL_MIN_PCT)) {
    const key = findKeyCI(out, ess);
    if (!key || !namesLower.has(ess)) continue;
    const minAmt = income * pct;
    if ((out[key] || 0) < minAmt) out[key] = minAmt;
  }

  // 4) Cap savings
  let freedFromSavings = 0;
  const savKey = findKeyCI(out, 'Savings');
  if (savKey && namesLower.has('savings')) {
    const max = income * capsPct.savings;
    const before = out[savKey] || 0;
    if (before > max) {
      out[savKey] = max;
      freedFromSavings = before - max;
    }
  }

  const isEssential = (k) => ESSENTIALS.includes(norm(k));
  const isTarget = (k) => {
    const kN = norm(k);
    return namesLower.has(kN) && kN !== 'savings' && kN !== 'buffer';
  };
  const sumAll = (o) => Object.values(o).reduce((s, v) => s + Number(v || 0), 0);

  // 5) If over income, trim: non-essentials first, then essentials but not below floors
  let total = sumAll(out);
  if (total > income) {
    let excess = total - income;

    // A) trim non-essentials
    const nonEssKeys = Object.keys(out).filter(k => isTarget(k) && !isEssential(k) && (out[k] || 0) > 0);
    if (nonEssKeys.length) {
      const nonEssSum = nonEssKeys.reduce((s, k) => s + (out[k] || 0), 0);
      for (const k of nonEssKeys) {
        if (excess <= 0) break;
        const share = (out[k] / nonEssSum) * excess;
        const take = Math.min(out[k], share);
        out[k] = round2(out[k] - take);
      }
      total = sumAll(out);
      excess = Math.max(0, total - income);
    }

    // B) if still over, shave essentials but not below floor
    if (excess > 0.0001) {
      const essKeys = Object.keys(out).filter(k => isEssential(k) && (out[k] || 0) > 0);
      const floorByKey = {};
      for (const k of essKeys) {
        const floorPct = ESSENTIAL_MIN_PCT[norm(k)] || 0;
        floorByKey[k] = income * floorPct;
      }
      const headroom = essKeys.reduce((s, k) => s + Math.max(0, (out[k] || 0) - floorByKey[k]), 0);
      if (headroom > 0) {
        for (const k of essKeys) {
          if (excess <= 0) break;
          const capacity = Math.max(0, (out[k] || 0) - floorByKey[k]);
          if (capacity <= 0) continue;
          const take = Math.min(capacity, (capacity / headroom) * excess);
          out[k] = round2(out[k] - take);
        }
      }
    }
  }

  // 6) Reallocate any money freed from Savings using spend weights, else evenly
  if (freedFromSavings > 0.01) {
    const targets = Object.keys(out).filter(isTarget);
    const w = {};
    let wsum = 0;

    if (weights && typeof weights === 'object') {
      const wLower = {};
      for (const [n, v] of Object.entries(weights)) wLower[n.toLowerCase()] = Number(v) || 0;
      for (const t of targets) { w[t] = wLower[norm(t)] || 0; wsum += w[t]; }
    }
    if (wsum <= 0) {
      for (const t of targets) { w[t] = 1; }
      wsum = targets.length;
    }
    for (const t of targets) out[t] = (out[t] || 0) + (w[t] / wsum) * freedFromSavings;
  }

  // 7) If UNDER income, top up using weights or evenly (includes zero categories!)
  total = sumAll(out);
  let leftover = income - total;
  if (leftover > 0.01) {
    const targets = Object.keys(out).filter(isTarget);
    if (targets.length) {
      const w = {};
      let wsum = 0;

      if (weights && typeof weights === 'object') {
        const wLower = {};
        for (const [n, v] of Object.entries(weights)) wLower[n.toLowerCase()] = Number(v) || 0;
        for (const t of targets) { w[t] = wLower[norm(t)] || 0; wsum += w[t]; }
      }
      if (wsum <= 0) {
        for (const t of targets) { w[t] = 1; }
        wsum = targets.length;
      }

      for (const t of targets) {
        const add = (w[t] / wsum) * leftover;
        out[t] = (out[t] || 0) + add;
      }
    } else if (namesLower.has('emergency')) {
      const emKey = findKeyCI(out, 'Emergency');
      if (emKey) out[emKey] = (out[emKey] || 0) + leftover;
    }
  }

  // 8) Round
  const rounded = {};
  for (const [k, v] of Object.entries(out)) rounded[k] = round2(v);

  // 9) Reasons for zeros (non-essentials only)
  for (const [k, v] of Object.entries(rounded)) {
    if (!isEssential(k) && namesLower.has(norm(k)) && v <= 0) {
      reasons[k] =
        'Set to Rs. 0 to keep the plan within income after covering essentials and required minimums.';
    }
  }

  // 10) Final tiny remainder into Emergency (or first)
  const after = Object.values(rounded).reduce((s, v) => s + v, 0);
  const rem = round2(income - after);
  if (Math.abs(rem) >= 0.01) {
    const bumpPref = ['Emergency','Food','Transport','Utilities','Education','Entertainment','Healthcare'];
    let bumpKey = null;
    for (const label of bumpPref) {
      const candidate = findKeyCI(rounded, label);
      if (candidate) { bumpKey = candidate; break; }
    }
    if (!bumpKey) bumpKey = Object.keys(rounded)[0];
    rounded[bumpKey] = round2((rounded[bumpKey] || 0) + rem);
  }

  return { rounded, reasons };
}

/* ------------------------------------------------------------------ */
/*                     Test Multiple Endpoints                         */
/* ------------------------------------------------------------------ */
const testEndpoints = async (requestData) => {
  const endpoints = [
    '/recommend',
    '/api/recommend', 
    '/recommendation',
    '/api/recommendation',
    '/api/v1/recommend',
    '/budget/recommend',
    '/ai/recommend'
  ];

  console.log('🔍 Testing endpoints for AI service...');

  for (const endpoint of endpoints) {
    try {
      const fullUrl = `${apiUrl}${endpoint}`;   // ✅ use apiUrl
      console.log(`Testing: ${fullUrl}`);
      
      const response = await axios.post(fullUrl, requestData, {
        timeout: 8000,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });
      
      console.log(`✅ SUCCESS: ${endpoint}`, response.status);
      console.log('Response data:', response.data);
      return response; // Return the first successful response
      
    } catch (error) {
      const status = error.response?.status;
      console.log(`❌ Failed: ${endpoint} - Status: ${status || 'Network Error'}`);
    }
  }
  
  throw new Error('All endpoints failed - check backend deployment and routes');
};



/* ------------------------------------------------------------------ */
/*                           Main function                             */
/* ------------------------------------------------------------------ */
export const fetchRecommendation = async () => {
  try {
    console.log('🚀 Starting fetchRecommendation...');
    
    const uid = await getCurrentUserId();
    if (!uid) {
      Alert.alert('Authentication Required', 'Please log in first.');
      return null;
    }
    console.log('✅ User ID obtained:', uid);

    const { income, age } = await getBudgetingIncome(uid);
    if (!(income > 0)) {
      Alert.alert('Income Missing', 'Please add your monthly income first in settings.');
      return null;
    }
    console.log('✅ Income and age obtained:', { income, age });

    // Pull categories (ids + names)
    const { data: cats, error: cErr } = await supabase
      .from('categories')
      .select('id, name')
      .eq('user_id', uid)
      .eq('type', 'expense');
    if (cErr) throw cErr;

    const allNames = (cats || []).map(c => c.name);
    const nameToId = Object.fromEntries((cats || []).map(c => [norm(c.name), c.id]));
    console.log('✅ Categories loaded:', allNames);

    // Recent spend weights (used both for allocation and for validating custom cats)
    const weights = await getRecentSpendWeights(uid);
    console.log('✅ Spending weights calculated:', weights);

    // ---- Filter categories (skip junk like "blah") ----
    const validNames = [];
    const skipped = [];
    for (const nm of allNames) {
      if (isValidCategory(nm, weights)) validNames.push(nm);
      else skipped.push(nm);
    }

    console.log('✅ Valid categories:', validNames);
    console.log('⚠️ Skipped categories:', skipped);

    if (validNames.length === 0) {
      Alert.alert(
        'No Valid Categories',
        'Your categories look invalid for budgeting. Please add sensible categories like Food, Transport, Utilities, Entertainment and try again.'
      );
      return null;
    }

    // Prepare request data
    const requestData = { 
      age: age || 25, // fallback age if not provided
      income, 
      categories: validNames, 
      weights 
    };
    
    console.log('📤 Request data prepared:', requestData);

    // Call AI service with endpoint testing
    console.log('🌐 Calling AI service...');
    const res = await testEndpoints(requestData);

    const recRaw = res.data?.recommendation || res.data;
    if (!recRaw || typeof recRaw !== 'object') {
      console.error('❌ Invalid AI response:', res.data);
      Alert.alert('AI Service Error', 'Invalid response format from AI service.');
      return null;
    }

    console.log('✅ AI recommendation received:', recRaw);

    // Post-process the recommendation
    const { rounded: rec, reasons } = postProcessRecommendation({
      rawRec: recRaw,
      income,
      categories: validNames,
      weights,
    });

    console.log('✅ Processed recommendation:', rec);

    // Persist ONLY valid categories to database
    console.log('💾 Updating category limits in database...');
    const updatePromises = Object.entries(rec).map(async ([name, amount]) => {
      const id = nameToId[norm(name)];
      if (!id) {
        console.warn(`⚠️ No ID found for category: ${name}`);
        return;
      }
      
      try {
        await supabase
          .from('categories')
          .update({ limit_: Number(amount) })
          .eq('id', id);
        console.log(`✅ Updated ${name}: Rs. ${amount}`);
      } catch (err) {
        console.error(`❌ Failed to update ${name}:`, err);
      }
    });

    await Promise.all(updatePromises);
    console.log('✅ Database updates completed');

    // Show appropriate alerts
    if (skipped.length > 0) {
      const shown = skipped.slice(0, 6).join(', ') + (skipped.length > 6 ? '…' : '');
      Alert.alert(
        'Categories Skipped',
        `These categories were ignored because they appear invalid or unused:\n\n${shown}\n\nTip: Rename them to something meaningful (e.g., "Subscriptions", "Gifts") or remove them.`
      );
    }

    const zeroCats = Object.keys(reasons);
    if (zeroCats.length > 0) {
      const list = zeroCats.slice(0, 6).join(', ') + (zeroCats.length > 6 ? '…' : '');
      Alert.alert(
        'Budget Adjusted',
        `Some categories were set to Rs. 0 to fit your Rs. ${income.toLocaleString()} income after covering essentials:\n\n${list}\n\nYou can manually adjust any limits in the budget screen.`
      );
    } else if (skipped.length === 0) {
      Alert.alert(
        'Smart Budget Created! 🎯', 
        'Your personalized budget plan has been created successfully. All categories have been assigned optimal amounts based on your income and spending patterns.\n\nGo to "Budgets" to view and fine-tune your plan.'
      );
    }

    console.log('✅ fetchRecommendation completed successfully');
    return rec;

  } catch (error) {
    console.error('❌ fetchRecommendation error:', error);
    
    // More specific error handling
    if (error.message?.includes('All endpoints failed')) {
      Alert.alert(
        'AI Service Unavailable', 
        'Cannot connect to the AI budgeting service. Please check:\n\n• Your internet connection\n• Try again in a few moments\n\nIf the problem persists, contact support.'
      );
    } else if (error.code === 'ENOTFOUND') {
      Alert.alert(
        'Connection Error', 
        'Cannot reach the AI service. Please check your internet connection and try again.'
      );
    } else if (error.response?.status >= 500) {
      Alert.alert(
        'Service Error', 
        'The AI service is temporarily unavailable. Please try again in a few minutes.'
      );
    } else {
      Alert.alert('Error', error.message || 'An unexpected error occurred. Please try again.');
    }
    
    return null;
  }
};