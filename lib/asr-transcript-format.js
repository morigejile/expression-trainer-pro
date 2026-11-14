'use strict';

const DIGITS = '零一二三四五六七八九';
const SMALL_UNITS = {十: 10, 百: 100, 千: 1000};
const NUMBER_RUN = /百分之[负零〇一二两三四五六七八九十百千万亿点0-9]+|(?:正负|负)?[零〇一二两三四五六七八九十百千万亿0-9]+(?:点[零〇一二两三四五六七八九十百千万亿0-9]+)?/gu;
const QUANTITY_UNIT = /^(?:英里|英尺|公里|千米|厘米|毫米|平方米|立方米|米(?!饭)|公斤|千克|克(?!拉|隆)|毫升|升(?!级)|块钱|元(?!化|素)|岁|个月|个人|次(?!元)|分钟|秒(?!表)|小时|天(?!地|下)|月(?!份)|日(?!常)|号|年(?!级|代)|度(?!空间))/u;
const APPROXIMATE_PREFIX = /^(?:多|几|来|余|左右|上下|分之)/u;

function digit(character) {
  if (character === '两') return 2;
  if (character === '〇') return 0;
  return DIGITS.indexOf(character);
}

function parseGroup(text) {
  if (/^[一二两三四五六七八九]$/u.test(text)) return digit(text);
  const groups = /^(?:([一二两三四五六七八九])千)?(?:([一二两三四五六七八九])百)?(?:([一二三四五六七八九]?)十)?([一二三四五六七八九])?$/u;
  const match = groups.exec(text.replace(/[零〇]/gu, ''));
  if (!match || !text) return null;
  const [, thousands, hundreds, tens, ones] = match;
  const parts = Object.entries({千: thousands, 百: hundreds, 十: tens})
    .filter(([, value]) => value !== undefined)
    .map(([unit, value]) => ({value: digit(value || '一') * SMALL_UNITS[unit], unit: SMALL_UNITS[unit], text: value + unit}));
  if (ones) parts.push({value: digit(ones), unit: 1, text: ones});
  if (!parts.length || (tens === '' && parts[0].unit > 10)) return null;
  // A skipped place needs an explicit zero. For example, 一百二 is ambiguous.
  const reconstructed = parts.map((part, index) => {
    const previous = parts[index - 1];
    return (previous && previous.unit / part.unit > 10 ? '零' : '') + part.text;
  }).join('');
  if (reconstructed !== text.replaceAll('〇', '零')) return null;
  return parts.reduce((sum, part) => sum + part.value, 0);
}

function parseInteger(text) {
  if (/^[零〇]$/u.test(text)) return 0;
  const match = /^(?:([零〇一二两三四五六七八九十百千]+)亿)?(?:([零〇一二两三四五六七八九十百千]+)万)?([零〇一二两三四五六七八九十百千]*)$/u.exec(text);
  if (!match || !text) return null;
  let total = 0;
  let previousUnit = null;
  const units = [100000000, 10000, 1];
  for (const [index, group] of match.slice(1).entries()) {
    if (!group) continue;
    const unit = units[index];
    const hasZero = /^[零〇]/u.test(group);
    const value = parseGroup(hasZero ? group.slice(1) : group);
    if (value === null || hasZero !== (previousUnit !== null && value * unit < previousUnit / 10)) return null;
    total += value * unit;
    previousUnit = unit;
  }
  return total;
}

function formatChineseNumbers(text) {
  return text.replace(NUMBER_RUN, (original, start) => {
    const before = text.slice(Math.max(0, start - 3), start);
    let after = text.slice(start + original.length, start + original.length + 8);
    const unitPrefix = original.endsWith('千') && /^[克米]/u.test(after) ? '千' : '';
    const match = unitPrefix ? original.slice(0, -1) : original;
    after = unitPrefix + after;
    const unit = QUANTITY_UNIT.exec(after)?.[0];
    if (/[0-9]/u.test(match) || /(?:分之|几)$/u.test(before) ||
      APPROXIMATE_PREFIX.test(after) || (unit && /^(?:左右|上下|出头|多一点)/u.test(after.slice(unit.length)))) return original;

    if (after.startsWith('年') && /^[一二][零〇一二三四五六七八九]{3}$/u.test(match)) {
      return Array.from(match, digit).join('');
    }

    const percent = match.startsWith('百分之');
    if (percent && (unit || /^(?:成|吨|个百分点)/u.test(after))) return original;
    const signed = percent ? match.slice(3) : match;
    const sign = signed.startsWith('正负') ? '±' : signed.startsWith('负') ? '-' : '';
    const number = signed.replace(/^(?:正负|负)/u, '');
    const [integer, fraction] = number.split('点');
    if (fraction !== undefined) {
      if (!/^[零〇一二三四五六七八九]+$/u.test(fraction)) return original;
      const hasDecimalContext = percent || sign || (unit && !['月', '日', '号', '年'].includes(unit)) ||
        ((!after || /^[\p{P}\s]/u.test(after)) && /(?:为|等于|读数是|数值是|价格是)$/u.test(before));
      if (!hasDecimalContext || (!percent && after.startsWith('分'))) return original;
    }
    if (!percent && fraction === undefined && !unit) return original;

    const value = parseInteger(integer);
    if (value === null) return original;
    const decimal = fraction === undefined ? '' : '.' + Array.from(fraction, digit).join('');
    return sign + value + decimal + (percent ? '%' : '') + unitPrefix;
  });
}

const INSERTED_PUNCTUATION = new Set('，。！？、；：,.!?;:'.split(''));
const NUMBER_CHARACTER = /[0-9零〇一二两三四五六七八九十百千万亿点.%％]/u;

function onlyAddsPunctuation(input, output) {
  if (typeof output !== 'string') return false;
  let offset = 0;
  for (const character of output) {
    if (input.startsWith(character, offset)) {
      offset += character.length;
    } else if (!INSERTED_PUNCTUATION.has(character) ||
      (NUMBER_CHARACTER.test(input[offset - 1] || '') && NUMBER_CHARACTER.test(input[offset] || ''))) {
      return false;
    }
  }
  return offset === input.length;
}

function createTranscriptFormatter({manager, modelId = 'ct-transformer-punctuation', canDownload = true,
  reportError = error => console.warn('[ASR] Punctuation unavailable:', error.message),
  loadSherpa = () => require('sherpa-onnx-node')} = {}) {
  let punctuation;
  let checking;
  let installing;
  const controller = new AbortController();

  function load(model) {
    const file = model?.files.find(entry => entry.role === 'model');
    if (!file) throw new Error('Punctuation model file is missing');
    if (controller.signal.aborted) return;
    const {OfflinePunctuation} = loadSherpa();
    punctuation = new OfflinePunctuation({model: {ctTransformer: file.path, provider: 'cpu', numThreads: 1}});
  }

  function warn(error) {
    if (!controller.signal.aborted) reportError(error);
  }

  function prepare() {
    if (punctuation || installing || controller.signal.aborted) return;
    if (checking) return checking;
    checking = (async () => {
      const active = await manager.getActive(modelId);
      if (controller.signal.aborted) return;
      if (active) {
        load(active);
      } else if (canDownload) {
        installing = manager.install(modelId, {activate: true, signal: controller.signal})
          .then(load).catch(warn).finally(() => { installing = null; });
      }
    })().catch(warn).finally(() => { checking = null; });
    return checking;
  }

  function format(text) {
    if (!text) return text;
    if (punctuation) {
      try {
        const candidate = punctuation.addPunct(text);
        if (onlyAddsPunctuation(text, candidate)) text = candidate;
      } catch (error) {
        warn(error);
        punctuation = null;
      }
    }
    return formatChineseNumbers(text);
  }

  async function dispose() {
    controller.abort();
    await checking;
    await installing;
    punctuation = null;
  }

  return {prepare, format, dispose};
}

function withFormattedAsrFinals(provider, formatter) {
  const formatFinal = event => event?.type === 'final'
    ? {...event, text: formatter.format(event.text)}
    : event;
  return {
    ...provider,
    async initialize() {
      await provider.initialize();
      await formatter.prepare();
    },
    async start(command) {
      await formatter.prepare();
      return provider.start(command);
    },
    async feed(command) {
      return formatFinal(await provider.feed(command));
    },
    async stop(command) {
      return (await provider.stop(command)).map(formatFinal);
    },
    async dispose() {
      await Promise.all([formatter.dispose(), provider.dispose()]);
    }
  };
}

module.exports = {formatChineseNumbers, createTranscriptFormatter, withFormattedAsrFinals};
