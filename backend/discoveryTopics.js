/**
 * discoveryTopics.js
 *
 * Shared deterministic topic bank used by the Local Reasoning Engine. This
 * used to live only inside MockProvider.js, which meant it only ever ran
 * for stages OTHER than 'discover' - DiscoveryLocalProvider intercepts the
 * 'discover' stage's two narrow LLM contracts (EXTRACT_EVIDENCE,
 * PHRASE_QUESTION) before MockProvider.generate() is ever reached, and had
 * its own much cruder 4-keyword extraction instead. Extracting this bank
 * to its own module lets both providers share one real implementation.
 *
 * Each topic: keywords to detect it in the owner's own words, which business
 * layer it belongs to, what evidence status it deserves, and optionally a
 * signal and/or knowledge gap it should raise. Uncertainty words route to
 * HYPOTHESIS, never to a confident fact - "I don't know" stays meaningful.
 */
const UNCERTAIN_WORDS = ["don't know the exact", "dont know the exact", "not sure", "approximately", "roughly", "i'd guess", "i guess", "maybe", "i think", "not totally sure", "no fixed", "go by feel", "not tracked", "don't track", "dont track"];

const TOPICS = [
  {
    key: 'cash_visibility',
    kws: ['money is going', "don't know where the money", 'dont know where the money', 'not sure where the money'],
    layer: 'commercial', status: 'OWNER-PROVIDED',
    meaning: 'Sales are happening, but the owner cannot clearly trace where the resulting cash ends up.',
    signal: { text: 'Cash visibility gap despite normal sales activity', type: 'commercial', severity: 'high' },
    gap: { q: 'Roughly how much cash do you usually have on hand at the end of a typical week?', imp: 'high', why: 'Knowing the actual cash position separates a real shortage from money that\u2019s simply tied up elsewhere.' },
  },
  {
    key: 'customer_credit',
    kws: ['credit', 'ask for credit', 'buy on credit', 'udhaar'],
    layer: 'customer', status: 'OWNER-PROVIDED',
    meaning: 'Customers regularly buy on credit rather than paying at the time of sale.',
    signal: { text: 'A meaningful share of revenue is tied up in customer credit', type: 'commercial', severity: 'medium' },
    gap: null,
  },
  {
    key: 'partial_collections',
    kws: ['pay within a month', 'pay me back', 'pay within'],
    layer: 'revenue', status: 'OWNER-PROVIDED',
    meaning: 'Some customers do pay back within roughly a month.',
    signal: null, gap: null,
  },
  {
    key: 'overdue_receivables',
    kws: ['three to six months', "haven't paid", "havent paid", 'months overdue', 'not paid for', "haven't paid for", "havent paid for"],
    layer: 'finance', status: 'OWNER-PROVIDED',
    meaning: 'A portion of customer receivables are three to six months overdue.',
    signal: { text: 'Aging receivables are tying up cash for months at a time', type: 'commercial', severity: 'high' },
    gap: { q: 'About how much, in total, is overdue by more than three months?', imp: 'high', why: 'The scale of what\u2019s overdue changes whether this is a minor timing issue or a real constraint.' },
  },
  {
    key: 'amount_uncertain',
    kws: ["don't know the exact amount", 'dont know the exact amount', 'not sure of the amount'],
    layer: 'finance', status: 'HYPOTHESIS',
    meaning: 'The exact amount customers currently owe is not precisely tracked - only estimated.',
    signal: null,
    gap: { q: 'Would it help to do a quick tally of what each regular customer currently owes?', imp: 'high', why: 'An estimate is useful, but a real number would let DLSMirror actually verify this instead of treating it as a guess.' },
    verificationQuestion: 'Would it help to do a quick tally of what each regular customer currently owes?',
  },
  {
    key: 'supplier_pressure',
    kws: ['i owe', 'owe suppliers', 'owe my supplier', 'owe them money', 'supplier', 'suppliers'],
    layer: 'finance', status: 'OWNER-PROVIDED',
    meaning: 'The business itself owes a meaningful amount to its own suppliers.',
    signal: { text: 'Supplier obligations are adding pressure alongside slow customer collections', type: 'commercial', severity: 'medium' },
    gap: null,
  },
  {
    key: 'record_keeping',
    kws: ["don't update", 'dont update', 'not tracked regularly', 'records inconsistently', "don't update the records"],
    layer: 'commercial', status: 'OWNER-PROVIDED',
    meaning: 'Business records are not updated on a regular, reliable basis.',
    signal: { text: 'Weak record-keeping is limiting visibility into the business', type: 'operational', severity: 'medium' },
    gap: null,
  },
  {
    key: 'fear_of_losing_customer',
    kws: ['may go somewhere else', 'stop buying', 'go somewhere else', 'otherwise they'],
    layer: 'customer', status: 'OWNER-PROVIDED',
    meaning: 'The owner keeps extending credit partly out of fear of losing the customer to a competitor.',
    signal: { text: 'Credit decisions are driven by relationship fear rather than a set policy', type: 'organizational', severity: 'medium' },
    gap: null,
  },
  {
    key: 'no_credit_limit',
    kws: ["don't have a fixed credit limit", "dont have a fixed credit limit", 'no fixed credit limit', 'go by feel', 'no credit limit'],
    layer: 'organization', status: 'OWNER-PROVIDED',
    meaning: 'There is no fixed credit limit - decisions are made case by case, by feel.',
    signal: { text: 'Credit decisions are informal and inconsistent from customer to customer', type: 'organizational', severity: 'medium' },
    gap: null,
  },
  {
    key: 'owner_dependency',
    kws: ['handle the money myself', 'important customers myself', "don't trust others", 'dont trust others', 'come back to me', 'when i\u2019m away', 'when im away', 'have to approve everything'],
    layer: 'owner', status: 'OWNER-PROVIDED',
    meaning: 'The owner personally handles money and key customer relationships, without delegating.',
    signal: { text: 'The owner is a single point of dependency for cash and customer decisions', type: 'organizational', severity: 'medium' },
    gap: null,
  },
  {
    key: 'past_default',
    kws: ['defaulted', 'write some money off', 'wrote off', 'write off', 'write-off'],
    layer: 'external', status: 'OWNER-PROVIDED',
    meaning: 'A past customer defaulted and the business had to write off part of what was owed.',
    signal: { text: 'There is a history of at least one uncollected bad debt', type: 'commercial', severity: 'medium' },
    gap: null,
  },
  {
    key: 'avoidance_behavior',
    kws: ['quiet now', 'bad feeling', "haven't followed up", "havent followed up", "don't know what to say", "dont know what to say", 'awkward'],
    layer: 'customer', status: 'INFERRED',
    meaning: 'The owner suspects a couple of customers may be at risk, but has been avoiding following up with them.',
    signal: { text: 'A known risk signal with specific customers is being avoided, not investigated', type: 'organizational', severity: 'high' },
    gap: { q: 'What is it that makes you hesitate to reach out to those customers directly?', imp: 'high', why: 'What\u2019s actually stopping the conversation matters more here than the accounts themselves.' },
  },
];

// Pairs of topics that, once BOTH have surfaced as real signals already on
// file, describe a genuine, specific connection worth naming as a
// relationship - not just "two things happened to come up". Used by
// DiscoveryLocalProvider's EXTRACT_RELATIONSHIP handler so local/offline
// mode can honestly test relationships too, not just leave them
// permanently unset.
const RELATIONSHIP_PAIRS = [
  { keys: ['customer_credit', 'overdue_receivables'], relationship: 'Credit extended to customers is what becomes the receivables that are now overdue', type: 'CONTRIBUTES_TO' },
  { keys: ['overdue_receivables', 'supplier_pressure'], relationship: 'Slow collection from customers is making it harder to pay suppliers on time', type: 'CONTRIBUTES_TO' },
  { keys: ['cash_visibility', 'customer_credit'], relationship: 'Cash is hard to trace partly because so much of it is sitting in customer credit rather than collected', type: 'CONTRIBUTES_TO' },
  { keys: ['no_credit_limit', 'overdue_receivables'], relationship: 'The lack of a fixed credit limit is a plausible reason receivables have grown large enough to go overdue', type: 'CONTRIBUTES_TO' },
  { keys: ['owner_dependency', 'customer_credit'], relationship: 'Because the owner personally decides every credit case, there is no consistent policy limiting how much credit builds up', type: 'CAUSES' },
  { keys: ['avoidance_behavior', 'overdue_receivables'], relationship: 'The customers being avoided are a plausible source of the receivables that have gone overdue', type: 'CORRELATES_WITH' },
];

const CONTRADICTION_PAIRS = [
  { a: ['always pay', 'pay quickly', 'pay on time', 'never late', 'no problem paying'], b: ['60 days', 'takes a while', 'pay late', 'overdue', 'months to pay', "haven't paid", "havent paid"] },
  { a: ['customers love', 'customers are happy', 'no complaints'], b: ['stopped coming', 'stop buying', 'churn', 'leaving'] },
];

function detectTopicKeys(text) {
  const lower = (text || '').toLowerCase();
  const hits = new Set();
  TOPICS.forEach((t) => { if (t.kws.some((k) => lower.includes(k))) hits.add(t.key); });
  return hits;
}
function isUncertain(text) {
  const lower = (text || '').toLowerCase();
  return UNCERTAIN_WORDS.some((w) => lower.includes(w));
}
function findContradiction(priorText, latestText) {
  const priorLower = (priorText || '').toLowerCase();
  const latestLower = (latestText || '').toLowerCase();
  for (const pair of CONTRADICTION_PAIRS) {
    const priorHasA = pair.a.some((w) => priorLower.includes(w));
    const priorHasB = pair.b.some((w) => priorLower.includes(w));
    const latestHasA = pair.a.some((w) => latestLower.includes(w));
    const latestHasB = pair.b.some((w) => latestLower.includes(w));
    if ((priorHasA && latestHasB) || (priorHasB && latestHasA)) {
      const statementA = pair.a.find((w) => priorLower.includes(w) || latestLower.includes(w));
      const statementB = pair.b.find((w) => priorLower.includes(w) || latestLower.includes(w));
      return { statementA, statementB, note: `earlier this sounded like "${statementA}", but now it sounds more like "${statementB}"` };
    }
  }
  return null;
}

module.exports = { TOPICS, RELATIONSHIP_PAIRS, CONTRADICTION_PAIRS, UNCERTAIN_WORDS, detectTopicKeys, isUncertain, findContradiction };
