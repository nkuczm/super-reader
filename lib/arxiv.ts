/**
 * arXiv's categories by name, for naming a category someone follows. Kept
 * apart so the API directory (lib/apis.ts) and link recognition
 * (lib/scholarly.ts) can both read it.
 */

/** arXiv's categories, by their names — the ones people follow most, and every archive. */
export const ARXIV_CATEGORIES: Record<string, string> = {
  "cs.AI": "Artificial Intelligence", "cs.CL": "Computation and Language", "cs.CV": "Computer Vision",
  "cs.LG": "Machine Learning", "cs.NE": "Neural and Evolutionary Computing", "cs.RO": "Robotics",
  "cs.HC": "Human-Computer Interaction", "cs.CY": "Computers and Society", "cs.CR": "Cryptography and Security",
  "cs.IR": "Information Retrieval", "cs.SE": "Software Engineering", "cs.DS": "Data Structures and Algorithms",
  "cs.MA": "Multiagent Systems", "cs.GT": "Computer Science and Game Theory", "cs.SI": "Social and Information Networks",
  "cs.LO": "Logic in Computer Science", "cs.PL": "Programming Languages", "cs.DC": "Distributed Computing",
  "stat.ML": "Machine Learning (Statistics)", "stat.ME": "Statistical Methodology", "stat.AP": "Statistics Applications",
  "q-bio.NC": "Neurons and Cognition", "q-bio.QM": "Quantitative Methods", "q-bio.GN": "Genomics",
  "q-bio.BM": "Biomolecules", "q-bio.PE": "Populations and Evolution", "q-bio.MN": "Molecular Networks",
  "physics.hist-ph": "History and Philosophy of Physics", "physics.soc-ph": "Physics and Society",
  "physics.bio-ph": "Biological Physics", "physics.data-an": "Data Analysis and Statistics",
  "quant-ph": "Quantum Physics", "gr-qc": "General Relativity and Quantum Cosmology", "hep-th": "High Energy Physics – Theory",
  "astro-ph": "Astrophysics", "astro-ph.CO": "Cosmology", "astro-ph.GA": "Astrophysics of Galaxies",
  "astro-ph.EP": "Earth and Planetary Astrophysics", "cond-mat": "Condensed Matter",
  "cond-mat.dis-nn": "Disordered Systems and Neural Networks", "cond-mat.stat-mech": "Statistical Mechanics",
  "nlin.AO": "Adaptation and Self-Organizing Systems", "math.LO": "Logic", "math.PR": "Probability",
  "math.ST": "Statistics Theory", "math.OC": "Optimization and Control", "math.HO": "History and Overview",
  "econ.GN": "General Economics", "econ.TH": "Theoretical Economics", "econ.EM": "Econometrics",
  "q-fin.GN": "General Finance", "eess.SP": "Signal Processing", "eess.AS": "Audio and Speech Processing",
  "eess.IV": "Image and Video Processing", "eess.SY": "Systems and Control",
  "astro-ph.HE": "High Energy Astrophysical Phenomena", "astro-ph.SR": "Solar and Stellar Astrophysics",
  "astro-ph.IM": "Instrumentation and Methods for Astrophysics", "math.NT": "Number Theory", "math.CO": "Combinatorics",
  "math.AG": "Algebraic Geometry", "hep-ph": "High Energy Physics – Phenomenology",
  "astro-ph.*": "Astrophysics", "cond-mat.*": "Condensed Matter", "math.*": "Mathematics", "physics.*": "Physics",
  cs: "Computer Science", math: "Mathematics", physics: "Physics", "q-bio": "Quantitative Biology",
  "q-fin": "Quantitative Finance", stat: "Statistics", eess: "Electrical Engineering and Systems Science", econ: "Economics",
};


/**
 * Archives that are only ever filed under their subcategories. arXiv's
 * search reads `cat:astro-ph` as the pre-2009 archive itself, so following it
 * that way returned papers from 2019 and nothing since (measured 12 Oct
 * 2026); `cat:astro-ph.*` is every subcategory, and current.
 */
const SUBDIVIDED = new Set(["astro-ph", "cond-mat", "cs", "math", "physics", "q-bio", "q-fin", "stat", "eess", "econ", "nlin"]);

/** The search that follows a category: a whole archive as all of its subcategories. */
export function arxivQuery(cat: string): string {
  return SUBDIVIDED.has(cat) ? `cat:${cat}.*` : `cat:${cat}`;
}
