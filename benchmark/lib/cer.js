function calculateCer(referenceTokens, hypothesisTokens) {
  if (!Array.isArray(referenceTokens) || !Array.isArray(hypothesisTokens)) {
    throw new TypeError('CER inputs must be token arrays');
  }

  const previous = Array.from({ length: hypothesisTokens.length + 1 }, (_, index) => index);
  for (let referenceIndex = 1; referenceIndex <= referenceTokens.length; referenceIndex += 1) {
    const current = [referenceIndex];
    for (let hypothesisIndex = 1; hypothesisIndex <= hypothesisTokens.length; hypothesisIndex += 1) {
      const substitutionCost = referenceTokens[referenceIndex - 1] === hypothesisTokens[hypothesisIndex - 1] ? 0 : 1;
      current.push(Math.min(
        previous[hypothesisIndex] + 1,
        current[hypothesisIndex - 1] + 1,
        previous[hypothesisIndex - 1] + substitutionCost
      ));
    }
    previous.splice(0, previous.length, ...current);
  }

  const distance = previous[hypothesisTokens.length];
  if (referenceTokens.length === 0) {
    return { distance, referenceLength: 0, cer: null, invalidReference: true };
  }
  return { distance, referenceLength: referenceTokens.length, cer: distance / referenceTokens.length };
}

module.exports = { calculateCer };
