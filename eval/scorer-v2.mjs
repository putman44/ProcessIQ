// V2 is deliberately conservative: only explicit claim patterns are automated.
// A clean result is not a factual correctness or evidence relevance verdict.
const claimPatterns = [
  /\b(?:confirmed|proven|definitely|certainly)\s+(?:a\s+)?(?:wafer\s+)?(?:defect|defective|caus(?:e|ed|ation)|quality impact)\b/gi,
  /\b(?:defect|causation|quality impact)\s+(?:was|is|has been)\s+(?:confirmed|proven)\b/gi,
  /\b(?:proved|proves|confirmed|confirms)\s+(?:a\s+)?(?:wafer\s+)?(?:defect|causation|quality impact)\b/gi,
  /\b(?:yes|definitely|certainly)[, :]+(?:the\s+)?(?:wafer\s+)?(?:is\s+|was\s+)?defective\b/gi,
];

function explicitlyNegated(answer, start) {
  // Negation must govern this claim within the same clause. A disclaimer in a
  // preceding sentence or on the other side of "but" cannot erase a claim.
  const prefix = answer.slice(0, start).split(/[.!?;\n]|\b(?:but|however|yet|although)\b/i).at(-1);
  const words = prefix.trim().split(/\s+/).slice(-6).join(' ');
  return /\b(?:no|not|never|neither|without|unconfirmed|unproven|cannot|can't|isn't|wasn't|hasn't|haven't|doesn't|don't)\b/i.test(words);
}

export function unsupportedClaims(answer) {
  const matches = [];
  for (const pattern of claimPatterns) {
    for (const match of answer.matchAll(pattern)) {
      if (!explicitlyNegated(answer, match.index)) matches.push(match[0]);
    }
  }
  return [...new Set(matches)];
}

const ref = x => `${x.source_type}:${x.source_id}`;
const same = (a,b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

export function scoreLiveV2(s, r, exists) {
  const problems = [];
  const citations = r.evidence.map(ref);
  let citationsValid = 0;
  for (const key of citations) {
    if (exists(key)) citationsValid++;
    else problems.push(`Invalid citation ${key}`);
  }
  const claims = unsupportedClaims(r.answer);
  if (claims.length) problems.push('Unsupported defect or causation claim');
  const metrics = { citationsTotal: citations.length, citationsValid, unsupportedClaims: claims.length ? 1 : 0, eventTp: 0, eventExpected: 0, exposureTp: 0, exposurePredicted: 0, exposureExpected: 0 };
  if (s.kind === 'events' || s.kind === 'failures') {
    const types = s.kind === 'failures' ? ['failure:'] : ['error:','maintenance:'];
    const found = citations.filter(x => types.some(type => x.startsWith(type)));
    metrics.eventTp = new Set(found.filter(x => s.events.includes(x))).size;
    metrics.eventExpected = s.events.length;
    if (!same(found,s.events)) problems.push('Event citations differ from expected window');
  }
  if (s.kind === 'history') {
    const found = citations.filter(x => x.startsWith('synthetic_processing:')).map(x => x.slice('synthetic_processing:'.length));
    if (!same(found,s.processing)) problems.push('Processing evidence mismatch');
  }
  if (s.kind === 'exposure') {
    const actual = r.exposure_findings.map(x => x.processing_id);
    metrics.exposureTp = new Set(actual.filter(x => s.processing.some(p => p.id === x))).size;
    metrics.exposurePredicted = actual.length;
    metrics.exposureExpected = s.processing.length;
    if (!same(actual,s.processing.map(x => x.id))) problems.push('Exposure precision or recall mismatch');
    for (const p of s.processing) {
      const x = r.exposure_findings.find(x => x.processing_id === p.id);
      if (!x || x.wafer_id !== p.wafer || !same(x.source_events.map(ref),p.events)) problems.push(`Exposure support mismatch: ${p.id}`);
    }
  }
  return { problems, metrics, claims };
}
