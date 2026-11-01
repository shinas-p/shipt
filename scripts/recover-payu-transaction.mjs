/**
 * Shipz Mart — Secure PayU Transaction Verification & Recovery Utility
 *
 * Transaction Reference:
 *   Order Number: QM-20261030-C11D00AA
 *   Order ID:     222bac54-ccb1-473e-944c-989b729bf315
 *   Merchant Txn: TXN_QM_20261030_C11D00AA_B5AA2F
 *   PayU MIHPay:  31567169332
 *   Amount:       INR 1.00
 *
 * Usage:
 *   PAYU_MERCHANT_KEY="<KEY>" PAYU_MERCHANT_SALT="<SALT>" node scripts/recover-payu-transaction.mjs
 */

import crypto from "node:crypto";

const ORDER_ID = "222bac54-ccb1-473e-944c-989b729bf315";
const ORDER_NUMBER = "QM-20261030-C11D00AA";
const TXN_ID = "TXN_QM_20261030_C11D00AA_B5AA2F";
const EXPECTED_AMOUNT = 1.00;
const KNOWN_MIHPAYID = "31567169332";

const merchantKey = process.env.PAYU_MERCHANT_KEY;
const merchantSalt = process.env.PAYU_MERCHANT_SALT;
const payuEnv = (process.env.PAYU_ENV || "production").toLowerCase();

if (!merchantKey || !merchantSalt) {
  console.error("Error: PAYU_MERCHANT_KEY and PAYU_MERCHANT_SALT environment variables are required.");
  console.error("Refusing recovery: Payment verification requires authentic gateway credentials.");
  process.exit(1);
}

function sha512(str) {
  return crypto.createHash("sha512").update(str, "utf8").digest("hex");
}

async function verifyAndRecover() {
  console.log("==================================================================");
  console.log("Shipz Mart — PayU Server-Side Payment Verification & Recovery");
  console.log("==================================================================");
  console.log(`Checking Transaction: ${TXN_ID}`);
  console.log(`Order Number:         ${ORDER_NUMBER}`);
  console.log(`Order UUID:           ${ORDER_ID}`);
  console.log(`Expected Total:       INR ${EXPECTED_AMOUNT.toFixed(2)}`);
  console.log("------------------------------------------------------------------");

  const verifyUrl = payuEnv === "production"
    ? "https://info.payu.in/merchant/postservice.php?form=2"
    : "https://test.payu.in/merchant/postservice.php?form=2";

  const hashString = `${merchantKey}|verify_payment|${TXN_ID}|${merchantSalt}`;
  const hash = sha512(hashString);

  const form = new URLSearchParams();
  form.append("key", merchantKey);
  form.append("command", "verify_payment");
  form.append("var1", TXN_ID);
  form.append("hash", hash);

  console.log("Step 1: Contacting PayU Verify Payment API...");
  const response = await fetch(verifyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  if (!response.ok) {
    throw new Error(`PayU API returned HTTP ${response.status}`);
  }

  const json = await response.json();

  if (json.status !== 1 || !json.transaction_details) {
    console.error("Verification Result: Gateway reported transaction not available or command failed (status 0).");
    console.error(JSON.stringify(json, null, 2));
    process.exit(1);
  }

  // Strict lookup by target transaction ID only — never fallback to an arbitrary entry
  const details = json.transaction_details[TXN_ID];
  if (!details) {
    console.error(`Verification Result: Transaction details block for '${TXN_ID}' not found in PayU response.`);
    process.exit(1);
  }

  // Strict verification of txnid and mihpayid
  if (details.txnid && String(details.txnid).trim() !== TXN_ID) {
    console.error(`Validation FAILED: Transaction ID mismatch (expected ${TXN_ID}, got ${details.txnid}).`);
    process.exit(1);
  }

  if (String(details.mihpayid).trim() !== KNOWN_MIHPAYID) {
    console.error(`Validation FAILED: PayU Payment ID mismatch (expected ${KNOWN_MIHPAYID}, got ${details.mihpayid}).`);
    process.exit(1);
  }

  console.log("\nStep 2: Gateway Response Received & Validated:");
  console.log(`- Gateway Status:    ${details.status}`);
  console.log(`- Unmapped Status:   ${details.unmappedstatus}`);
  console.log(`- PayU Payment ID:   ${details.mihpayid}`);
  console.log(`- Verified Amount:   INR ${details.amt || details.transaction_amount}`);
  console.log(`- Payment Mode:      ${details.mode}`);
  console.log(`- Bank Reference:    ${details.bank_ref_num || "N/A"}`);

  const statusLower = (details.status || "").toLowerCase().trim();
  const unmappedLower = (details.unmappedstatus || "").toLowerCase().trim();

  const isCaptured = statusLower === "success" && (unmappedLower === "captured" || unmappedLower === "success");
  const verifiedAmt = parseFloat(details.amt || details.transaction_amount || "0");

  if (!isCaptured) {
    console.error(`\nValidation FAILED: Payment is not captured (status='${details.status}', unmappedstatus='${details.unmappedstatus}'). Refusing recovery.`);
    process.exit(1);
  }

  if (verifiedAmt !== EXPECTED_AMOUNT) {
    console.error(`\nValidation FAILED: Amount mismatch. Order expects INR ${EXPECTED_AMOUNT}, gateway verified INR ${verifiedAmt}. Refusing recovery.`);
    process.exit(1);
  }

  console.log("\nStep 3: Verification PASSED with 100% gateway confirmation.");

  const isConfirmedMode = process.argv.includes("--confirm");
  if (!isConfirmedMode) {
    console.log("\n[READ-ONLY MODE] All gateway parameters matched 100%.");
    console.log("To generate the executable SQL confirmation snippet, re-run with: --confirm");
    return;
  }

  printSqlSnippet(details.mihpayid, details.mode || "UPI", details);
}

function printSqlSnippet(mihpayid, mode, rawPayload) {
  console.log("\n==================================================================");
  console.log("EXECUTE THIS ATOMIC CONFIRMATION IN SUPABASE SQL EDITOR:");
  console.log("==================================================================");
  console.log(`
-- 1. Pre-check: Ensure order is in pending_payment status
SELECT id, order_number, total_amount, status, payment_status, payu_txnid
FROM public.orders
WHERE id = '${ORDER_ID}'::uuid;

-- 2. Execute Atomic Idempotent Confirmation (Leaves inventory intact)
SELECT public.verify_payu_payment_transaction(
  p_order_id := '${ORDER_ID}'::uuid,
  p_txnid := '${TXN_ID}',
  p_mihpayid := '${mihpayid}',
  p_amount := ${EXPECTED_AMOUNT.toFixed(2)},
  p_status := 'success',
  p_mode := '${mode}',
  p_response_payload := '${JSON.stringify(rawPayload).replace(/'/g, "''")}'::jsonb,
  p_verified_via := 'server_verify_api'
);

-- 3. Post-check: Confirm order is placed and payment is paid
SELECT id, order_number, total_amount, status, payment_status, payu_txnid
FROM public.orders
WHERE id = '${ORDER_ID}'::uuid;
  `);
}

verifyAndRecover().catch((err) => {
  console.error("Recovery script execution failed:", err.message);
  process.exit(1);
});

