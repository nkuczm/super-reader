import { clusterStories } from "./lib/cluster";
// The real Houthi headlines the live panel produced, plus the real bridge.
const real: [string,string][] = [
  ["ft","Houthis capture Red Sea port in blow to Saudis"],
  ["nyt","Yemen's Houthis seize strategic Red Sea port, officials say"],
  ["bbc","Yemen's Houthis reportedly seize strategic Red Sea port of Mokha"],
  ["guardian","Houthis seize key port Mocha in Yemen on Red Sea coast"],
  ["dw","Yemen Houthis take control of strategic Red Sea port city"],
  ["france24","Iran-backed Houthi rebels take strategic port city in Yemen, raising threat to Red Sea shipping"],
  ["wapo","Iranian-backed Houthis fight to block Red Sea passage for Saudi oil"],
  ["oil1","Oil prices climb on Red Sea shipping disruption"],
  ["oil2","Oil prices climb as Red Sea shipping is disrupted"],
];
console.log(clusterStories(real.map(([id,title])=>({id,title}))).map(c=>c.members.map(m=>m.id).join("+")));
const pulse: [string,string][] = [
  ["ap","Iran restarts ballistic missile production"],
  ["reuters","Iran resumes ballistic missile production, intelligence says"],
  ["bbc","Iran producing ballistic missiles again"],
  ["nyt","Iran is producing ballistic missiles again, officials say"],
  ["eng","The best USB-C cables we tested this year"],
];
console.log(clusterStories(pulse.map(([id,title])=>({id,title}))).map(c=>c.members.map(m=>m.id).join("+")));
