/**
 * Real headlines, taken from the live panel on 2026-09-10/11 via
 * /api/pulse?sample=. Nothing here is invented: clustering can only be
 * judged against the way outlets actually write, and synthetic examples
 * flatter whatever the algorithm already does.
 *
 * SAME_STORY: groups that must end up as one cluster. Each is one event
 * covered more than once, with enough shared wording for a headline-only
 * matcher to have a fair chance.
 *
 * DIFFERENT_STORIES: groups whose members must NOT be merged with each
 * other. Mostly pieces that share a subject, a date or an institution while
 * being separate stories — which is exactly what over-merging looks like.
 */

export const SAME_STORY = {
  // Two newsrooms, near-identical headline: the easy case, and a regression
  // here means something is badly wrong.
  "civilian-protections": [
    ["Defense One", "US absent as western powers meet on wartime protections for civilians"],
    ["ProPublica", "Empty Seat: U.S. Absent as Western Powers Meet on Wartime Protections for Civilians"],
  ],

  // One decision, as the specialist and the two nationals wrote it. The
  // wordings barely overlap ("grants request to prevent Missouri from using"
  // against "again blocks Missouri from using"), which is what set the
  // similarity threshold.
  "missouri-decision": [
    ["SCOTUSblog", "Supreme Court grants request to prevent Missouri from using congressional map expected to aid Republicans"],
    ["The Washington Post", "Supreme Court again blocks new Missouri congressional map favoring GOP"],
    ["The Wall Street Journal", "Supreme Court again blocks Missouri from using GOP-friendly voting map"],
    ["The Wall Street Journal", "Supreme Court denies Missouri bid to use voting map that benefits Republicans"],
  ],

  // One court decision written up twice by one newsroom, with no word in
  // common but "Supreme Court", "Republicans" and "loss". At 0.468 this is
  // the weakest link the matcher is asked to hold, and it sits *below* the
  // highest-scoring pair that must not merge (0.497, two unrelated
  // Trump-administration filings) — so it only works because mutual
  // recognition, not the threshold alone, decides the close calls.
  "scotus-midterm-loss": [
    ["Vox", "Republicans suffered a stunning Supreme Court loss. It lasted minutes."],
    ["Vox", "The Supreme Court just handed Republicans a surprisingly decisive midterm loss"],
  ],

  // Reconstructed from the live cluster: the day's biggest world story, which
  // an earlier version split in two.
  houthis: [
    ["Financial Times", "Houthis capture Red Sea port in blow to Saudis"],
    ["BBC News", "Yemen's Houthis reportedly seize strategic Red Sea port of Mokha"],
    ["The New York Times", "Yemen's Houthis seize strategic Red Sea port, officials say"],
  ],
};

/**
 * Stories the copies of which cannot be joined from headlines alone, with
 * the reason. Recorded rather than quietly dropped: each is a real story
 * whose breadth is undercounted, and the test below pins the current
 * behaviour so that improving it is visible.
 */
export const KNOWN_LIMITS = {
  // Shares exactly one word — "Denisovan" — with nothing else in common.
  // Matching on a single shared word is what let CBC's "IN PHOTOS | TIFF
  // movies and moments" swallow the GOP convention coverage, so this stays
  // unmatched until there is a signal beyond the headline to use.
  denisovans: [
    ["Nature", "Ancient proteins identify various Denisovan remains from Southwest China"],
    ["Nature", "Denisovans from southwestern China and their subsistence strategies"],
    ["Science", "Denisovans were strong and agile hunters, fossil elbow and primitive tools suggest"],
  ],

};

export const DIFFERENT_STORIES = {
  // Eight separate pieces in one anniversary package. They share "9/11" and
  // nothing else, and merging them would be the classic failure.
  "sept-11-package": [
    ["The Atlantic", "What the Aftermath of 9/11 Taught Me"],
    ["The Atlantic", "What Colin Powell Did on 9/11"],
    ["The Atlantic", "Inside the White House on 9/11"],
    ["The Atlantic", "All the Places Trump Was on 9/11"],
    ["The Atlantic", "New York, 25 Years Later"],
    ["ProPublica", "25 Years After 9/11, Questions About the FBI’s Pursuit of Saudi Suspects in the Case Have Only Grown"],
  ],

  // The run-up to the Missouri decision: separate events in the same
  // dispute, days apart. Labelling these as one story with the decision was
  // my own error when this fixture was first written — the headlines report
  // different things happening, and treating a dispute's every filing as
  // one story would make the count of "newsrooms covering it" mean less.
  "missouri-filings": [
    ["SCOTUSblog", "Missouri urges Supreme Court to allow for use of congressional map expected to aid Republicans"],
    ["SCOTUSblog", "Missouri organizer urges Supreme Court to leave ruling in place preventing use of congressional map expected to benefit Republicans"],
    ["SCOTUSblog", "Elections dispute continues after Justice Kavanaugh turns down request from Missouri to use congressional map expected to aid Republicans"],
    ["SCOTUSblog", "Missouri congressional redistricting dispute returns to the Supreme Court"],
  ],

  // Same court, same term, different cases — the Missouri map must not
  // absorb them.
  "other-scotus-business": [
    ["SCOTUSblog", "Trump administration again appeals mail-in ballot dispute to the Supreme Court"],
    ["SCOTUSblog", "Court announces cases it will hear in December, including challenges to the constitutionality of bans on AR-15s"],
    ["SCOTUSblog", "Citing election-fraud concerns, Trump administration brings dispute over voter database to the Supreme Court"],
    ["SCOTUSblog", "In final scheduled summer order list, Supreme Court again declines to weigh in on COVID-19 vaccine mandate case"],
    ["SCOTUSblog", "Court grants request from Republican groups to pause ruling, for now, on political broadcasting rates"],
  ],

  // The consequence of a story is not the story: this is checked against the
  // Red Sea port group above, which it was chained into.
  "oil-price": [
    ["The Wall Street Journal", "Oil Rises on Escalating Supply-Disruption Concerns"],
    ["The Wall Street Journal", "Kalshi Looks to Expand a Rapidly Growing Universe of Risky Trading"],
  ],

  // One newsroom's beat output in a single day. Every one of these shares
  // "pentagon", "ai" or "cyber" with another.
  "pentagon-beat": [
    ["Defense One", "‘We have to throw technology at the cyber problem,’ Pentagon CIO says"],
    ["Defense One", "Pentagon cyber strategy expected as soon as next week, sources say"],
    ["Defense One", "Maven is becoming the Pentagon’s everything app"],
    ["Defense One", "NSA wants AI to help analysts sift vast data troves"],
    ["Defense One", "AI-powered biowarfare is coming; the Army lays plans to ‘fight through’ it"],
    ["Defense One", "The US military gets its own ChatGPT today"],
  ],

  // Journal research titles: dense, technical, and full of shared vocabulary
  // that means nothing about being the same paper.
  "nature-papers": [
    ["Nature", "Integrated signatures define mutational processes in prostate cancer"],
    ["Nature", "PLA2G2D in tumour-draining lymph nodes regulates anti-tumour immunity"],
    ["Nature", "A serpin–myeloid axis in pancreatic cancer heterogeneity and immune evasion"],
    ["Nature", "The neurons that can put a brake on a nervous-system cancer"],
    ["Nature", "Bacteria recruited to treat cancer"],
  ],

  // Separate investigations that share "school", "voting" or "Texas".
  "propublica-desk": [
    ["ProPublica", "Several States Rejected This Private School Chain as a Charter. Now It’s Eligible for Texas’ Taxpayer-Funded Vouchers."],
    ["ProPublica", "California Lawmakers Pass Bill to Punish Administrators Who Fail to Vet Teachers for Misconduct"],
    ["ProPublica", "New Mail Voting Rules Moved Forward Despite USPS Officials’ Concerns About Mass Disenfranchisement"],
    ["ProPublica", "U.S. Postal Service Failed to Properly Handle Some Ballots During This Year’s Primary Elections, Audit Finds"],
    ["ProPublica", "Homeland Security Opens Child Exploitation Probe Into Banned Texas Volleyball Coach"],
  ],

  // Trump in every headline, five different stories.
  "trump-everywhere": [
    ["The Atlantic", "Does Trump Want Republicans to Win the Midterms?"],
    ["The Atlantic", "Why Trump Has It Out for Canada"],
    ["The Atlantic", "Trump Is Preparing for a Long War"],
    ["The Atlantic", "Trump’s Dream World in Dallas"],
    ["The Atlantic", "What Bush Understood That Trump Doesn’t"],
  ],
};

/** Every fixture headline, as the corpus a real sweep would cluster. */
export function allHeadlines() {
  const out = [];
  let n = 0;
  for (const [label, group] of Object.entries(SAME_STORY)) {
    for (const [newsroom, title] of group) {
      out.push({ id: `same-${label}-${n++}`, title, outlet: newsroom, label });
    }
  }
  for (const [label, group] of Object.entries(KNOWN_LIMITS)) {
    for (const [newsroom, title] of group) {
      out.push({ id: `limit-${label}-${n++}`, title, outlet: newsroom, label: null });
    }
  }
  for (const [label, group] of Object.entries(DIFFERENT_STORIES)) {
    for (const [newsroom, title] of group) {
      out.push({ id: `diff-${label}-${n++}`, title, outlet: newsroom, label: null });
    }
  }
  return out;
}
