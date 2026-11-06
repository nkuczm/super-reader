/**
 * The spending cap for super-reader's Google Cloud project (docs/HOSTING.md,
 * step 6). It is not part of the app and is not built with it: Cloud Build
 * builds this folder on its own, with Google's buildpacks (`npm ci`, then
 * `npm start`), and deploys it as a second Cloud Run service on every merge
 * that changes it.
 *
 * Google has no hard spending limit, only budgets that report. A budget
 * publishes the month's running cost to a Pub/Sub topic several times a
 * day; this reads each report, and once the cost has passed the budget it
 * detaches the project from its billing account. Everything in the project
 * stops — the reader included — and nothing more can be charged until
 * billing is attached again in the console.
 *
 * Reports arrive hours after the spending, so the bill can end a little
 * over the budget. Set the budget below what you would actually mind.
 */

const functions = require("@google-cloud/functions-framework");
const { CloudBillingClient } = require("@google-cloud/billing");

const billing = new CloudBillingClient();

/** The budget's own numbers: act only when this month's cost is past it. */
function overBudget(report) {
  return (
    typeof report.costAmount === "number" &&
    typeof report.budgetAmount === "number" &&
    report.costAmount > report.budgetAmount
  );
}

functions.cloudEvent("stopBilling", async (event) => {
  const report = JSON.parse(Buffer.from(event.data.message.data, "base64").toString());
  const spent = `${report.costAmount} of ${report.budgetAmount} ${report.currencyCode ?? ""}`.trim();
  if (!overBudget(report)) {
    console.log(`Under budget (${spent}); nothing to do.`);
    return;
  }

  const name = `projects/${await billing.getProjectId()}`;
  try {
    const [info] = await billing.getProjectBillingInfo({ name });
    if (!info.billingEnabled) {
      console.log(`Over budget (${spent}), and billing is already off.`);
      return;
    }
  } catch (error) {
    // Reading needs more than the one permission this function is given
    // (Project Billing Manager); detaching does not. Detach regardless.
    console.warn(`Could not read billing status (${error.message}); detaching anyway.`);
  }
  await billing.updateProjectBillingInfo({ name, projectBillingInfo: { billingAccountName: "" } });
  console.log(`Over budget (${spent}): billing detached from ${name}. Reattach it in Billing to bring the reader back.`);
});

module.exports = { overBudget };
