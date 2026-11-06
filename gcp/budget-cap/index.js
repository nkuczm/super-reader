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

const DETACH = "resourcemanager.projects.deleteBillingAssignment";

/**
 * Whether the cap would work, without using it. Publish {"check": true} to
 * the topic (a field no budget report carries) and the log says Ready, or
 * what is missing — the one test that does not take the site down.
 */
async function check(name) {
  try {
    const client = await billing.auth.getClient();
    const { data } = await client.request({
      url: `https://cloudresourcemanager.googleapis.com/v3/${name}:testIamPermissions`,
      method: "POST",
      data: { permissions: [DETACH] },
    });
    if ((data.permissions ?? []).includes(DETACH)) {
      console.log(`Ready: past the budget, this would detach billing from ${name}.`);
    } else {
      console.error(`NOT READY: this function's service account cannot detach billing. Give it the Project Billing Manager role (IAM → Grant access).`);
    }
  } catch (error) {
    console.error(`Could not check (${error.message}). If it names the Cloud Resource Manager API, enable that API and publish the check again.`);
  }
}

functions.cloudEvent("stopBilling", async (event) => {
  const report = JSON.parse(Buffer.from(event.data.message.data, "base64").toString());
  if (report.check === true) {
    await check(`projects/${await billing.getProjectId()}`);
    return;
  }
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
