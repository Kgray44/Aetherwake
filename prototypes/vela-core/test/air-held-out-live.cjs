const exact = (...values) => text => {
  const answer = text.toLowerCase().trim().replace(/^["`*]+|["`*.!]+$/gu, '').replace(/\s+/gu, ' ');
  return values.includes(answer);
};
const contains = (...patterns) => text => patterns.every(pattern => pattern.test(text));

exports.cases = [
  ['everyday', 'My bus was due at 8:45 and is 20 minutes late. What time should I expect it? Give just the time.', exact('9:05', '9:05 am', '9:05 a.m')],
  ['everyday', 'I am facing west and turn right once. Which direction am I facing? One word.', exact('north')],
  ['everyday', 'Put this list in reverse order: cocoa, tea, juice. Use commas.', contains(/^\s*juice\s*,\s*tea\s*,\s*cocoa[.\s]*$/iu)],
  ['everyday', 'What is the adjective in “The narrow bridge crosses the river”? One word.', exact('narrow')],
  ['everyday', 'Sam can meet Monday or Thursday. Priya can meet Wednesday or Thursday. Give the one weekday that works.', exact('thursday')],
  ['everyday', 'A recipe needs three eggs per batch. I am making four batches. Reply with just the number of eggs.', exact('12', 'twelve')],
  ['everyday', 'What is the third letter in the word garden? Answer with the letter.', exact('r')],
  ['everyday', 'Put 9.01, 9.1, and 9.001 in ascending order. Use commas.', contains(/^\s*9\.001\s*,\s*9\.01\s*,\s*9\.1[.\s]*$/u)],
  ['technical', 'What does HTTP 304 mean? Use the standard two-word reason phrase.', exact('not modified')],
  ['technical', 'In a database, what does the I in ACID stand for? One word.', exact('isolation')],
  ['technical', 'Explain in one sentence why a diode across a relay coil helps when power is switched off.', contains(/voltage (?:spike|transient)|back emf|inductive kick/iu, /current|energy|clamp|suppress|protect/iu)],
  ['technical', 'Explain in one sentence what a differential gear lets the two wheels do in a turn.', contains(/different speeds|different rates|different angular velocit/iu)],
  ['technical', 'For a digital audio signal sampled at 48 kHz, name the Nyquist frequency in kHz. Give the number only.', exact('24')],
  ['technical', 'What SI unit measures electrical conductance? One word.', exact('siemens')],
  ['technical', 'What is the name of the DNS record type for an IPv6 address? Answer with just the type.', exact('aaaa')],
  ['technical', 'Explain the difference between latency and throughput in two short sentences.', contains(/delay|time (?:it takes|to)|elapsed/iu, /per (?:second|unit|time)|rate|amount.*time/iu)],
  ['reasoning', 'Prove that the product of two consecutive integers is always even. Give a one-sentence reason.', contains(/one.*even|even.*one/iu)],
  ['reasoning', 'Derive the voltage gain of an ideal inverting op amp with a 2 kΩ input resistor and a 10 kΩ feedback resistor. State the signed gain and why.', contains(/[-−]\s*5\b/u, /feedback|resistor|virtual ground/iu)],
  ['reasoning', 'Derive the equivalent resistance of a 6-ohm and a 3-ohm resistor in parallel. Include the reciprocal rule and result.', contains(/\b2\s*(?:Ω|ohms?)/iu, /reciprocal|1\s*\//iu)],
  ['reasoning', 'Prove that a square integer divisible by 3 has a root divisible by 3. Use residues modulo 3 and state the possible square residues.', contains(/mod(?:ulo)?\s*3|residue/iu, /\b0\b/u, /\b1\b/u)],
  ['reasoning', 'Derive the expected number of heads from six independent fair coin flips. Include the answer and the principle you used.', contains(/\b3\b|\bthree\b/iu, /linearity|sum.*expect|expect.*sum/iu)],
  ['reasoning', 'Derive the steady-state current from a 12 V ideal DC source through two series resistors of 2 Ω and 4 Ω. Include the equivalent resistance.', contains(/\b2\s*(?:A\b|amps?|amperes?)/iu, /\b6\s*(?:Ω|ohms?)/iu)],
  ['reasoning', 'Prove that the difference of two even integers is even. Use the factor 2 in your reason.', contains(/\b2\b/u, /factor|multiple|divisible/iu)],
  ['reasoning', 'Derive the cutoff frequency of a one-pole RC low-pass filter in terms of R and C. Explain the magnitude at cutoff.', contains(/2\s*\\?pi|2\s*π|2\s*\\pi/iu, /(?:3\s*dB|sqrt\s*\{?2|√2|0\.707|\\sqrt\s*\{?2)/iu)],
];
