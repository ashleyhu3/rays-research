'use strict';

const STANCE_SCORES = {
  confident: 0.8,
  transparent: 0.55,
  careful: -0.1,
  overly_optimistic: 0.05,
  avoidant: -0.7,
  defensive: -0.65,
};

function clamp(value, min = -1, max = 1) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function emotionSignal(emotion) {
  const scores = emotion?.scores || {};
  return clamp(
    (scores.joy || 0) * 0.8
    + (scores.neutral || 0) * 0.1
    + (scores.surprise || 0) * 0.05
    - (scores.fear || 0) * 0.9
    - (scores.sadness || 0) * 0.55
    - (scores.anger || 0) * 0.7
    - (scores.disgust || 0) * 0.5,
  );
}

function mergeToneSignals({ finbert, emotion, llm }) {
  const financial = clamp(finbert?.score);
  const emotional = emotionSignal(emotion);
  const stance = llm ? clamp(llm.score ?? STANCE_SCORES[llm.stance]) : null;
  const weights = stance == null
    ? { financial: 0.65, emotional: 0.35, llm: 0 }
    : { financial: 0.45, emotional: 0.25, llm: 0.30 };
  const score = clamp(
    financial * weights.financial
    + emotional * weights.emotional
    + (stance || 0) * weights.llm,
  );
  const investorConfidence = Math.round((score + 1) * 50);
  const label = investorConfidence >= 72
    ? 'Highly confident'
    : investorConfidence >= 58
    ? 'Confident'
    : investorConfidence >= 43
    ? 'Measured'
    : investorConfidence >= 28
    ? 'Concerned'
    : 'Defensive / uncertain';
  const signals = [financial, emotional, ...(stance == null ? [] : [stance])];

  return {
    score: Number(score.toFixed(3)),
    investorConfidence,
    label,
    financial: Number(financial.toFixed(3)),
    emotional: Number(emotional.toFixed(3)),
    llm: stance == null ? null : Number(stance.toFixed(3)),
    disagreement: Number((Math.max(...signals) - Math.min(...signals)).toFixed(3)),
    weights,
  };
}

function attachCompositeTone(enrichment) {
  for (const chunk of enrichment.chunks || []) {
    if (!chunk.tone?.finbert || !chunk.tone?.emotion) continue;
    chunk.tone.composite = mergeToneSignals(chunk.tone);
  }
  const analyzed = (enrichment.chunks || []).filter(chunk => chunk.tone?.composite);
  const average = analyzed.length
    ? analyzed.reduce((sum, chunk) => sum + chunk.tone.composite.investorConfidence, 0) / analyzed.length
    : null;
  enrichment.toneSummary = {
    chunks: analyzed.length,
    llmInterpreted: analyzed.filter(chunk => chunk.tone.llm).length,
    averageInvestorConfidence: average == null ? null : Number(average.toFixed(1)),
    confident: analyzed.filter(chunk => chunk.tone.composite.investorConfidence >= 58).length,
    concerned: analyzed.filter(chunk => chunk.tone.composite.investorConfidence < 43).length,
    highDisagreement: analyzed.filter(chunk => chunk.tone.composite.disagreement >= 0.8).length,
    models: {
      financial: analyzed[0]?.tone?.finbert?.model || null,
      emotion: analyzed[0]?.tone?.emotion?.model || null,
      llm: analyzed.find(chunk => chunk.tone.llm)?.tone?.llm?.model || null,
    },
  };
  return enrichment;
}

module.exports = {
  STANCE_SCORES,
  attachCompositeTone,
  emotionSignal,
  mergeToneSignals,
};
