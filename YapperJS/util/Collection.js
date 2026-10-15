'use strict';

class Collection extends Map {
  first(count) { return count === undefined ? this.values().next().value : [...this.values()].slice(0, count); }
  last(count) { const values = [...this.values()]; return count === undefined ? values.at(-1) : count === 0 ? [] : values.slice(-count); }
  find(predicate, thisArg) { for (const [key, value] of this) if (predicate.call(thisArg, value, key, this)) return value; }
  filter(predicate, thisArg) { const result = new Collection(); for (const [key, value] of this) if (predicate.call(thisArg, value, key, this)) result.set(key, value); return result; }
  map(predicate, thisArg) { return [...this].map(([key, value]) => predicate.call(thisArg, value, key, this)); }
  some(predicate, thisArg) { for (const [key, value] of this) if (predicate.call(thisArg, value, key, this)) return true; return false; }
  every(predicate, thisArg) { for (const [key, value] of this) if (!predicate.call(thisArg, value, key, this)) return false; return true; }
  reduce(predicate, ...initial) {
    let accumulator = initial[0], started = initial.length > 0;
    for (const [key, value] of this) { if (!started) { accumulator = value; started = true; } else accumulator = predicate(accumulator, value, key, this); }
    if (!started) throw new TypeError('Reduce of empty Collection with no initial value');
    return accumulator;
  }
  clone() { return new Collection(this); }
  toJSON() { return this.map(value => value?.toJSON?.() ?? value); }
}
module.exports = Collection;
