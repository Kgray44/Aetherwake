export function calculatorExpression(intent: string): string | undefined {
  const original = intent.normalize('NFKC').trim().toLowerCase()
    .replace(/^vela[,:]?\s+/u, '').replaceAll('’', "'").replace(/[?!.]+$/u, '').trim();
  const expression = original.replace(/^(?:(?:please|(?:can|could|would) you)\s+)+/u, '')
    .replace(/^(?:calculate|compute|evaluate|what(?: is|'s))\s+/u, '')
    .replaceAll('−', '-').replaceAll('×', '*').replaceAll('÷', '/').replaceAll('π', 'pi').replaceAll('**', '^')
    .replace(/\b(?:multiplied by|times)\b/gu, '*').replace(/\bdivided by\b/gu, '/')
    .replace(/\bplus\b/gu, '+').replace(/\bminus\b/gu, '-').replace(/%\s+of\s+/gu, '%*').trim();
  if (expression.length > 0 && expression.length <= 256 &&
      /^(?:\d|[+\-*/%^().\s]|sqrt|pi|e)+$/u.test(expression) &&
      (expression !== original || /[+\-*/%^()]|\bpi\b/u.test(expression)))
    return expression;
}

/** Parse a bounded grammar. No source text is evaluated as JavaScript. */
export function calculate(expression: string): number {
  if (expression.length > 256) throw Error('expression_too_long');
  const tokens = expression.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|sqrt|pi|e|[+\-*/%^()]|\S/gu) ?? [];
  let index = 0;
  const finite = (value: number) => {
    if (!Number.isFinite(value)) throw Error('result_out_of_range');
    return value;
  };
  const accept = (token: string) => {
    if (tokens[index] !== token) return false;
    index++;
    return true;
  };
  const expect = (token: string) => {
    if (!accept(token)) throw Error('invalid_expression');
  };
  const atom = (): number => {
    if (accept('(')) {
      const value = sum();
      expect(')');
      return value;
    }
    if (accept('sqrt')) {
      expect('(');
      const value = sum();
      expect(')');
      if (value < 0) throw Error('square_root_domain');
      return Math.sqrt(value);
    }
    if (accept('pi')) return Math.PI;
    if (accept('e')) return Math.E;
    const token = tokens[index++];
    if (!token || !/^[\d.]/u.test(token)) throw Error('invalid_expression');
    return finite(Number(token));
  };
  const unary = (): number => {
    if (accept('+')) return unary();
    if (accept('-')) return -unary();
    let value = atom();
    if (accept('%')) value /= 100;
    return accept('^') ? finite(value ** unary()) : value;
  };
  const product = (): number => {
    let value = unary();
    for (;;) {
      if (accept('*')) value = finite(value * unary());
      else if (accept('/')) {
        const divisor = unary();
        if (divisor === 0) throw Error('division_by_zero');
        value = finite(value / divisor);
      } else return value;
    }
  };
  const sum = (): number => {
    let value = product();
    for (;;) {
      if (accept('+')) value = finite(value + product());
      else if (accept('-')) value = finite(value - product());
      else return value;
    }
  };
  const result = sum();
  if (index !== tokens.length) throw Error('invalid_expression');
  return Object.is(result, -0) ? 0 : result;
}
