import tzLookup from '@photostructure/tz-lookup';

type Interval = { start: number; end: number };
type Rule = { days: number[]; intervals: Interval[]; closed: boolean };
type Schedule = { rules: Rule[]; allDayEveryDay: boolean; hasExceptions: boolean };
type HoursStation = {
  hours: string;
  lat: number;
  lon: number;
  timeZone?: string | null;
  status?: string;
  name?: string;
  network?: string;
  access?: string;
  power?: number | null;
};
export type HoursInfo = {
  state: 'open' | 'closed' | 'unknown' | 'unavailable';
  is24Hours: boolean;
  label: string;
  explanation: string;
  timeZone: string | null;
  timeZoneEstimated: boolean;
};
const weekdays = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const dayNumbers = Object.fromEntries(weekdays.map((day, index) => [day.toLowerCase(), index]));
const scheduleCache = new Map<string, Schedule | null>();
const zoneCache = new Map<string, string | null>();
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function selectedDays(value?: string): number[] | null {
  if (!value) return [0, 1, 2, 3, 4, 5, 6];
  const days = new Set<number>();
  for (const part of value.toLowerCase().split(',')) {
    const [first, last = first] = part.split('-');
    const start = dayNumbers[first], end = dayNumbers[last];
    if (start === undefined || end === undefined) return null;
    for (let day = start; ; day = (day + 1) % 7) {
      days.add(day);
      if (day === end) break;
    }
  }
  return [...days];
}

function parseMinuteValue(rawHour: string, rawMinute?: string): number | null {
  const hour = Number(rawHour);
  const minute = rawMinute === undefined ? 0 : Number(rawMinute);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (minute < 0 || minute > 59) return null;
  if (hour < 0 || hour > 48) return null;
  if (hour === 48 && minute !== 0) return null;
  return hour * 60 + minute;
}

// Only unambiguous weekly schedules are evaluated. Holiday, seasonal, appointment,
// solar and free-text rules remain unknown, including otherwise valid prefixes.
function parseSchedule(value: string): Schedule | null {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > 500) return null;
  if (scheduleCache.has(normalized)) return scheduleCache.get(normalized)!;
  const rules: Rule[] = [];
  let hasExceptions = false;
  let valid = true;
  for (const part of normalized.split(';')) {
    const expression = part.trim().replace(/"[^"]*"/g, '').trim();
    if (!expression) continue;
    if (/^(?:PH|SH)\b/i.test(expression)) { hasExceptions = true; continue; }
    const day = '(?:Mo|Tu|We|Th|Fr|Sa|Su)';
    const daysPattern = `${day}(?:-${day})?(?:,${day}(?:-${day})?)*`;
    const full = expression.match(new RegExp(`^(?:(${daysPattern}) )?(24/7|off|closed|(?:\\d{1,2}(?::\\d{2})?-\\d{1,2}(?::\\d{2})?)(?:,\\s*\\d{1,2}(?::\\d{2})?-\\d{1,2}(?::\\d{2})?)*)$`, 'i'));
    if (!full) { valid = false; break; }
    const days = selectedDays(full[1]);
    if (!days) { valid = false; break; }
    const times = full[2].toLowerCase();
    const closed = times === 'off' || times === 'closed';
    const intervals: Interval[] = [];
    if (times === '24/7') intervals.push({ start: 0, end: 1440 });
    else if (!closed) for (const span of times.split(',')) {
      const match = span.trim().match(/^(\d{1,2})(?::(\d{2}))?-(\d{1,2})(?::(\d{2}))?$/);
      if (!match) { valid = false; break; }
      const start = parseMinuteValue(match[1], match[2]);
      let end = parseMinuteValue(match[3], match[4]);
      if (start === null || end === null || start > 1439) { valid = false; break; }
      if (end === start) { valid = false; break; }
      if (end < start) end += 1440;
      if (end - start > 1440) { valid = false; break; }
      intervals.push({ start, end });
    }
    if (!valid) break;
    rules.push({ days, intervals, closed });
  }
  let schedule: Schedule | null = null;
  if (valid && rules.length) {
    const boundaries = new Set([0]);
    for (const rule of rules) for (const interval of rule.intervals) {
      boundaries.add(interval.start);
      boundaries.add(interval.end % 1440);
    }
    const allDayEveryDay = weekdays.every((_, day) => [...boundaries].every(minute => openAt(rules, day, minute)));
    schedule = { rules, allDayEveryDay, hasExceptions };
  }
  if (scheduleCache.size >= 1000) scheduleCache.clear();
  scheduleCache.set(normalized, schedule);
  return schedule;
}

function openAt(rules: Rule[], day: number, minute: number): boolean {
  let open = false;
  for (const rule of rules) {
    const today = rule.days.includes(day);
    const yesterday = rule.days.includes((day + 6) % 7);
    if (today) {
      // A later normal rule replaces earlier opening hours for that weekday.
      open = !rule.closed && rule.intervals.some(({ start, end }) => minute >= start && minute < end);
    }
    if (!rule.closed && yesterday && rule.intervals.some(({ end }) => end > 1440 && minute < end - 1440)) open = true;
  }
  return open;
}

function localFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function stationZone(station: HoursStation): { timeZone: string | null; estimated: boolean } {
  if (station.timeZone) {
    try { localFormatter(station.timeZone); return { timeZone: station.timeZone, estimated: false }; }
    catch { return { timeZone: null, estimated: false }; }
  }
  const key = `${station.lat},${station.lon}`;
  if (zoneCache.has(key)) return { timeZone: zoneCache.get(key)!, estimated: true };
  let timeZone: string | null = null;
  try {
    timeZone = tzLookup(station.lat, station.lon);
    localFormatter(timeZone);
  } catch { timeZone = null; }
  if (zoneCache.size >= 1000) zoneCache.clear();
  zoneCache.set(key, timeZone);
  return { timeZone, estimated: true };
}

function estimatedHoursFallback(station: HoursStation) {
  const source = `${station.name || ''} ${station.network || ''}`.toLowerCase();
  const known24x7 = ['supercharger', 'tesla', 'electrify america', 'evgo', 'chargepoint', 'blink', 'bp pulse', 'shell recharge', 'ev connect', 'francis energy'];
  if (known24x7.some(keyword => source.includes(keyword))) {
    return {
      label: 'Likely 24/7 · estimated',
      explanation: 'This network is often 24/7, but published station hours were not listed in this map record. Confirm in the operator app before travel.',
    };
  }
  if (station.access === 'customers') {
    return {
      label: 'Business-hours likely · estimated',
      explanation: 'This charger is marked for customers and may follow host business hours, but no schedule was published in this listing.',
    };
  }
  if ((station.power ?? 0) >= 100) {
    return {
      label: 'Likely extended hours · estimated',
      explanation: 'High-power public chargers are often available for extended hours, but no official station schedule was listed.',
    };
  }
  return {
    label: 'Hours not listed',
    explanation: 'No opening hours in this map listing.',
  };
}

export function evaluateStationHours(station: HoursStation, at: Date): HoursInfo {
  const zone = stationZone(station);
  const base = { timeZone: zone.timeZone, timeZoneEstimated: zone.estimated };
  if (station.status === 'temporarily unavailable' || station.status === 'planned') {
    return { ...base, state: 'unavailable', is24Hours: false, label: station.status === 'planned' ? 'Planned station' : 'Reported unavailable', explanation: 'Excluded from opening-hours filters because of the mapped station condition.' };
  }
  const schedule = parseSchedule(station.hours);
  const noHours = !station.hours || station.hours === 'Hours not listed';
  if (!schedule) {
    if (noHours) {
      const estimated = estimatedHoursFallback(station);
      return { ...base, state: 'unknown', is24Hours: false, label: estimated.label, explanation: estimated.explanation };
    }
    return { ...base, state: 'unknown', is24Hours: false, label: 'Hours unconfirmed', explanation: 'This schedule includes unsupported expressions we cannot safely evaluate. Check the original listing.' };
  }
  if (schedule.allDayEveryDay) {
    return { ...base, state: 'open', is24Hours: true, label: '24/7 listed', explanation: schedule.hasExceptions ? 'The published schedule is 24/7 with extra exception rules (such as holidays). Charger operation and free ports are unverified.' : 'The published schedule covers every day, all day. Charger operation and free ports are unverified.' };
  }
  if (!zone.timeZone || !Number.isFinite(at.getTime())) {
    return { ...base, state: 'unknown', is24Hours: false, label: 'Hours unconfirmed', explanation: 'Station time zone could not be established safely.' };
  }
  const parts = Object.fromEntries(localFormatter(zone.timeZone).formatToParts(at).map(part => [part.type, part.value]));
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday);
  const open = openAt(schedule.rules, day, Number(parts.hour) * 60 + Number(parts.minute));
  return { ...base, state: open ? 'open' : 'closed', is24Hours: false, label: open ? 'Open now · listed hours' : 'Closed · listed hours', explanation: schedule.hasExceptions ? 'Based on listed local schedule with extra exception rules present (for example holiday notes). Charger operation and free ports are unverified.' : 'Based on the published schedule at the station’s local time. Charger operation and free ports are unverified.' };
}

export function matchesHoursFilter(info: HoursInfo, openNow: boolean, allDay: boolean): boolean {
  return (!openNow || info.state === 'open') && (!allDay || info.is24Hours);
}

export function readableHours(value: string): string {
  if (value === '24/7') return '24 hours, every day';
  if (!value || value === 'Hours not listed') return 'Hours not supplied';
  return value.replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su)\b/g, day => ({ Mo: 'Mon', Tu: 'Tue', We: 'Wed', Th: 'Thu', Fr: 'Fri', Sa: 'Sat', Su: 'Sun' }[day]!)).replace(/;/g, '; ');
}
