import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
//#region ../../../../../opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cosmokit/lib/index.js
/** Return true when a value is `null` or `undefined`. */
function isNullable(value) {
	return value === null || value === void 0;
}
/** Return true for non-array object values. */
function isPlainObject(data) {
	return data && typeof data === "object" && !Array.isArray(data);
}
/** Filter object entries and return a new object. */
function filterKeys(object, filter) {
	return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
/** Map object values while preserving the original key set. */
function mapValues(object, transform) {
	return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
/** Pick selected keys from an object, optionally including `undefined` values. */
function pick(source, keys, forced) {
	if (!keys) return { ...source };
	const result = {};
	for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
	return result;
}
/** Test values using `instanceof` with a `toStringTag` fallback. */
function is(type, value) {
	if (arguments.length === 1) return (value) => is(type, value);
	return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
	return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
	return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
/** Binary source detection and base64/hex conversion helpers. */
var Binary;
(function(Binary) {
	Binary.is = isArrayBufferLike;
	Binary.isSource = isArrayBufferSource;
	function fromSource(source) {
		if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
		else return source;
	}
	Binary.fromSource = fromSource;
	function toBase64(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
		let binary = "";
		const bytes = new Uint8Array(source);
		for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
		return btoa(binary);
	}
	Binary.toBase64 = toBase64;
	function fromBase64(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
		return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
	}
	Binary.fromBase64 = fromBase64;
	function toHex(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
		return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
	}
	Binary.toHex = toHex;
	function fromHex(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
		const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
		const buffer = [];
		for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
		return Uint8Array.from(buffer).buffer;
	}
	Binary.fromHex = fromHex;
})(Binary || (Binary = {}));
Binary.fromBase64;
Binary.toBase64;
Binary.fromHex;
Binary.toHex;
/** Deep-clone common JavaScript values while preserving prototypes and cycles. */
function clone(source, refs = /* @__PURE__ */ new Map()) {
	if (!source || typeof source !== "object") return source;
	if (is("Date", source)) return new Date(source.valueOf());
	if (is("RegExp", source)) return new RegExp(source.source, source.flags);
	if (isArrayBufferLike(source)) return source.slice(0);
	if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
	const cached = refs.get(source);
	if (cached) return cached;
	if (Array.isArray(source)) {
		const result = [];
		refs.set(source, result);
		source.forEach((value, index) => {
			result[index] = Reflect.apply(clone, null, [value, refs]);
		});
		return result;
	}
	const result = Object.create(Object.getPrototypeOf(source));
	refs.set(source, result);
	for (const key of Reflect.ownKeys(source)) {
		const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
		if ("value" in descriptor) descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
		Reflect.defineProperty(result, key, descriptor);
	}
	return result;
}
/** Deeply compare arrays, dates, regexps, buffers, and plain object fields. */
function deepEqual(a, b, strict) {
	if (a === b) return true;
	if (!strict && isNullable(a) && isNullable(b)) return true;
	if (typeof a !== typeof b) return false;
	if (typeof a !== "object") return false;
	if (!a || !b) return false;
	function check(test, then) {
		return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : void 0;
	}
	return check(Array.isArray, (a, b) => a.length === b.length && a.every((item, index) => deepEqual(item, b[index]))) ?? check(is("Date"), (a, b) => a.valueOf() === b.valueOf()) ?? check(is("RegExp"), (a, b) => a.source === b.source && a.flags === b.flags) ?? check(isArrayBufferLike, (a, b) => {
		if (a.byteLength !== b.byteLength) return false;
		const viewA = new Uint8Array(a);
		const viewB = new Uint8Array(b);
		for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
		return true;
	}) ?? Object.keys({
		...a,
		...b
	}).every((key) => deepEqual(a[key], b[key], strict));
}
/** Time constants plus parsing and formatting helpers. */
var Time;
(function(Time) {
	Time.millisecond = 1;
	Time.second = 1e3;
	Time.minute = Time.second * 60;
	Time.hour = Time.minute * 60;
	Time.day = Time.hour * 24;
	Time.week = Time.day * 7;
	let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
	function setTimezoneOffset(offset) {
		timezoneOffset = offset;
	}
	Time.setTimezoneOffset = setTimezoneOffset;
	function getTimezoneOffset() {
		return timezoneOffset;
	}
	Time.getTimezoneOffset = getTimezoneOffset;
	function getDateNumber(date = /* @__PURE__ */ new Date(), offset) {
		if (typeof date === "number") date = new Date(date);
		if (offset === void 0) offset = timezoneOffset;
		return Math.floor((date.valueOf() / Time.minute - offset) / 1440);
	}
	Time.getDateNumber = getDateNumber;
	function fromDateNumber(value, offset) {
		const date = new Date(value * Time.day);
		if (offset === void 0) offset = timezoneOffset;
		return new Date(+date + offset * Time.minute);
	}
	Time.fromDateNumber = fromDateNumber;
	const numeric = /\d+(?:\.\d+)?/.source;
	const timeRegExp = new RegExp(`^${[
		"w(?:eek(?:s)?)?",
		"d(?:ay(?:s)?)?",
		"h(?:our(?:s)?)?",
		"m(?:in(?:ute)?(?:s)?)?",
		"s(?:ec(?:ond)?(?:s)?)?"
	].map((unit) => `(${numeric}${unit})?`).join("")}$`);
	function parseTime(source) {
		const capture = timeRegExp.exec(source);
		if (!capture) return 0;
		return (parseFloat(capture[1]) * Time.week || 0) + (parseFloat(capture[2]) * Time.day || 0) + (parseFloat(capture[3]) * Time.hour || 0) + (parseFloat(capture[4]) * Time.minute || 0) + (parseFloat(capture[5]) * Time.second || 0);
	}
	Time.parseTime = parseTime;
	function parseDate(date) {
		const parsed = parseTime(date);
		if (parsed) date = Date.now() + parsed;
		else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date}`;
		else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date}`;
		return date ? new Date(date) : /* @__PURE__ */ new Date();
	}
	Time.parseDate = parseDate;
	function format(ms) {
		const abs = Math.abs(ms);
		if (abs >= Time.day - Time.hour / 2) return Math.round(ms / Time.day) + "d";
		else if (abs >= Time.hour - Time.minute / 2) return Math.round(ms / Time.hour) + "h";
		else if (abs >= Time.minute - Time.second / 2) return Math.round(ms / Time.minute) + "m";
		else if (abs >= Time.second) return Math.round(ms / Time.second) + "s";
		return ms + "ms";
	}
	Time.format = format;
	function toDigits(source, length = 2) {
		return source.toString().padStart(length, "0");
	}
	Time.toDigits = toDigits;
	function template(template, time = /* @__PURE__ */ new Date()) {
		return template.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
	}
	Time.template = template;
})(Time || (Time = {}));
//#endregion
//#region ../../../../../opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/schemastery/lib/index.mjs
const kSchema = Symbol.for("schemastery");
const kValidationError = Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError = class extends TypeError {
	options;
	name = "ValidationError";
	constructor(message, options) {
		let prefix = "$";
		for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
		else if (typeof segment === "number") prefix += "[" + segment + "]";
		else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
		if (prefix.startsWith(".")) prefix = prefix.slice(1);
		super((prefix === "$" ? "" : `${prefix} `) + message);
		this.options = options;
	}
	static is(error) {
		return !!error?.[kValidationError];
	}
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
const Schema = function(options) {
	const schema = function(data, options = {}) {
		return Schema.resolve(data, schema, options)[0];
	};
	if (options.refs) {
		const refs = mapValues(options.refs, (options) => new Schema(options));
		const getRef = (uid) => refs[uid];
		for (const key in refs) {
			const options = refs[key];
			options.sKey = getRef(options.sKey);
			options.inner = getRef(options.inner);
			options.list = options.list && options.list.map(getRef);
			options.dict = options.dict && mapValues(options.dict, getRef);
		}
		return refs[options.uid];
	}
	Object.assign(schema, options);
	if (typeof schema.callback === "string") try {
		schema.callback = new Function("return " + schema.callback)();
	} catch {}
	Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
	Object.setPrototypeOf(schema, Schema.prototype);
	schema.meta ||= {};
	schema.toString = schema.toString.bind(schema);
	return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
	return {
		version: 1,
		vendor: "schemastery",
		validate: (value) => {
			try {
				return { value: Schema.resolve(value, this, {})[0] };
			} catch (error) {
				if (ValidationError.is(error)) return { issues: [{
					message: error.message,
					path: error.options.path
				}] };
				throw error;
			}
		}
	};
} });
Schema.ValidationError = ValidationError;
Schema.prototype.toJSON = function toJSON() {
	if (globalThis.__schemastery_refs__) {
		globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
		return this.uid;
	}
	globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
	globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
	const result = {
		uid: this.uid,
		refs: globalThis.__schemastery_refs__
	};
	globalThis.__schemastery_refs__ = void 0;
	return result;
};
Schema.prototype.set = function set(key, value) {
	this.dict[key] = value;
	return this;
};
Schema.prototype.push = function push(value) {
	this.list.push(value);
	return this;
};
function mergeDesc(original, messages) {
	const result = typeof original === "string" ? { "": original } : { ...original };
	for (const locale in messages) {
		const value = messages[locale];
		if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
		else if (typeof value === "string") result[locale] = value;
	}
	return result;
}
function getInner(value) {
	return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
	return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
	const schema = Schema(this);
	const desc = mergeDesc(schema.meta.description, messages);
	if (Object.keys(desc).length) schema.meta.description = desc;
	if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
		return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
	});
	if (schema.list) schema.list = schema.list.map((inner, index) => {
		return inner.i18n(mapValues(messages, (data = {}) => {
			if (Array.isArray(getInner(data))) return getInner(data)[index];
			if (Array.isArray(data)) return data[index];
			return extractKeys(data);
		}));
	});
	if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
		if (getInner(data)) return getInner(data);
		return extractKeys(data);
	}));
	if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
	return schema;
};
Schema.prototype.extra = function extra(key, value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
};
for (const key of [
	"required",
	"disabled",
	"collapse",
	"hidden",
	"loose"
]) Object.assign(Schema.prototype, { [key](value = true) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
Schema.prototype.deprecated = function deprecated() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "deprecated",
		type: "danger"
	});
	return schema;
};
Schema.prototype.experimental = function experimental() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "experimental",
		type: "warning"
	});
	return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
	const schema = Schema(this);
	const pattern = pick(regexp, ["source", "flags"]);
	schema.meta = {
		...schema.meta,
		pattern
	};
	return schema;
};
Schema.prototype.simplify = function simplify(value) {
	if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
	if (isNullable(value)) return value;
	if (this.type === "object" || this.type === "dict") {
		const result = {};
		for (const key in value) {
			const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
			if (this.type === "dict" || !isNullable(item)) result[key] = item;
		}
		if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
		return result;
	} else if (this.type === "array" || this.type === "tuple") {
		const result = [];
		value.forEach((value, index) => {
			const schema = this.type === "array" ? this.inner : this.list[index];
			const item = schema ? schema.simplify(value) : value;
			result.push(item);
		});
		return result;
	} else if (this.type === "intersect") {
		const result = {};
		for (const item of this.list) Object.assign(result, item.simplify(value));
		return result;
	} else if (this.type === "union") for (const schema of this.list) try {
		Schema.resolve(value, schema, {});
		return schema.simplify(value);
	} catch {}
	return value;
};
Schema.prototype.toString = function toString(inline) {
	return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role, extra) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		role,
		extra
	};
	return schema;
};
for (const key of [
	"default",
	"link",
	"comment",
	"description",
	"max",
	"min",
	"step"
]) Object.assign(Schema.prototype, { [key](value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
const resolvers = {};
Schema.extend = function extend(type, resolve) {
	resolvers[type] = resolve;
};
Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
	if (!schema) return [data];
	if (options.ignore?.(data, schema)) return [data];
	if (isNullable(data) && schema.type !== "lazy") {
		if (schema.meta.required) throw new ValidationError(`missing required value`, options);
		let current = schema;
		let fallback = schema.meta.default;
		while (current?.type === "intersect" && isNullable(fallback)) {
			current = current.list[0];
			fallback = current?.meta.default;
		}
		if (isNullable(fallback)) return [data];
		data = clone(fallback);
	}
	const callback = resolvers[schema.type];
	if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
	try {
		return callback(data, schema, options, strict);
	} catch (error) {
		if (!schema.meta.loose) throw error;
		return [schema.meta.default];
	}
};
Schema.from = function from(source) {
	if (isNullable(source)) return Schema.any();
	else if ([
		"string",
		"number",
		"boolean"
	].includes(typeof source)) return Schema.const(source).required();
	else if (source[kSchema]) return source;
	else if (typeof source === "function") switch (source) {
		case String: return Schema.string().required();
		case Number: return Schema.number().required();
		case Boolean: return Schema.boolean().required();
		case Function: return Schema.function().required();
		default: return Schema.is(source).required();
	}
	else throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
	const toJSON = () => {
		if (!schema.inner[kSchema]) {
			schema.inner = schema.builder();
			schema.inner.meta = {
				...schema.meta,
				...schema.inner.meta
			};
		}
		return schema.inner.toJSON();
	};
	const schema = new Schema({
		type: "lazy",
		builder,
		inner: { toJSON }
	});
	return schema;
};
Schema.natural = function natural() {
	return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
	return Schema.number().step(.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
	return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
		const date = new Date(value);
		if (isNaN(+date)) throw new ValidationError(`invalid date "${value}"`, options);
		return date;
	}, true)]);
};
Schema.regExp = function regExp(flag = "") {
	return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
		try {
			return new RegExp(value, flag);
		} catch (e) {
			throw new ValidationError(e.message, options);
		}
	}, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
	return Schema.union([
		Schema.is(ArrayBuffer),
		Schema.is(SharedArrayBuffer),
		Schema.transform(Schema.any(), (value, options) => {
			if (Binary.isSource(value)) return Binary.fromSource(value);
			throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
		}, true),
		...encoding ? [Schema.transform(Schema.string(), (value, options) => {
			try {
				return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
			} catch (e) {
				throw new ValidationError(e.message, options);
			}
		}, true)] : []
	]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
	if (!schema.inner[kSchema]) {
		schema.inner = schema.builder();
		schema.inner.meta = {
			...schema.meta,
			...schema.inner.meta
		};
	}
	return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
	return [data];
});
Schema.extend("never", (data, _, options) => {
	throw new ValidationError(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
	if (deepEqual(data, value)) return [value];
	throw new ValidationError(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
	const { max = Infinity, min = -Infinity } = meta;
	if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
	if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
	if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
	if (meta.pattern) {
		const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
		if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
	}
	checkWithinRange(data.length, meta, "string length", options);
	return [data];
});
function decimalShift(data, digits) {
	const str = data.toString();
	if (str.includes("e")) return data * Math.pow(10, digits);
	const index = str.indexOf(".");
	if (index === -1) return data * Math.pow(10, digits);
	const frac = str.slice(index + 1);
	const integer = str.slice(0, index);
	if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
	return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
	step = Math.abs(step);
	if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
	const index = step.toString().indexOf(".");
	const digits = step.toString().slice(index + 1).length;
	return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
	if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
	checkWithinRange(data, meta, "number", options);
	const { step } = meta;
	if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
	return [data];
});
Schema.extend("boolean", (data, _, options) => {
	if (typeof data === "boolean") return [data];
	throw new ValidationError(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
	let value = 0, keys = [];
	if (typeof data === "number") {
		value = data;
		for (const key in bits) if (data & bits[key]) keys.push(key);
	} else if (Array.isArray(data)) {
		keys = data;
		for (const key of keys) {
			if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
			if (key in bits) value |= bits[key];
		}
	} else throw new ValidationError(`expected number or array but got ${data}`, options);
	if (value === meta.default) return [value];
	return [value, keys];
});
Schema.extend("function", (data, _, options) => {
	if (typeof data === "function") return [data];
	throw new ValidationError(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
	if (typeof constructor === "function") {
		if (data instanceof constructor) return [data];
		throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
	} else {
		if (isNullable(data)) throw new ValidationError(`expected ${constructor} but got ${data}`, options);
		let prototype = Object.getPrototypeOf(data);
		while (prototype) {
			if (prototype.constructor?.name === constructor) return [data];
			prototype = Object.getPrototypeOf(prototype);
		}
		throw new ValidationError(`expected ${constructor} but got ${data}`, options);
	}
});
function property(data, key, schema, options) {
	try {
		const [value, adapted] = Schema.resolve(data[key], schema, {
			...options,
			path: [...options.path || [], key]
		});
		if (adapted !== void 0) data[key] = adapted;
		return value;
	} catch (e) {
		if (!options?.autofix) throw e;
		delete data[key];
		return schema.meta.default;
	}
}
Schema.extend("array", (data, { inner, meta }, options) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
	return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in data) {
		let rKey;
		try {
			rKey = Schema.resolve(key, sKey, options)[0];
		} catch (error) {
			if (strict) continue;
			throw error;
		}
		result[rKey] = property(data, key, inner, options);
		data[rKey] = data[key];
		if (key !== rKey) delete data[key];
	}
	return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	const result = list.map((inner, index) => property(data, index, inner, options));
	if (strict) return [result];
	result.push(...data.slice(list.length));
	return [result];
});
function merge(result, data) {
	for (const key in data) {
		if (key in result) continue;
		result[key] = data[key];
	}
}
Schema.extend("object", (data, { dict }, options, strict) => {
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in dict) {
		const value = property(data, key, dict[key], options);
		if (!isNullable(value) || key in data) result[key] = value;
	}
	if (!strict) merge(result, data);
	return [result];
});
Schema.extend("union", (data, { list, toString }, options, strict) => {
	const messages = [];
	for (const inner of list) try {
		return Schema.resolve(data, inner, options, strict);
	} catch (error) {
		messages.push(error);
	}
	throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString }, options, strict) => {
	if (!list.length) return [data];
	let result;
	for (const inner of list) {
		const value = Schema.resolve(data, inner, options, true)[0];
		if (isNullable(value)) continue;
		if (isNullable(result)) result = value;
		else if (typeof result !== typeof value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
		else if (typeof value === "object") merge(result ??= {}, value);
		else if (result !== value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
	}
	if (!strict && isPlainObject(data)) merge(result, data);
	return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
	const [result, adapted = data] = Schema.resolve(data, inner, options, true);
	if (preserve) return [callback(result)];
	else return [callback(result), callback(adapted)];
});
const formatters = {};
function defineMethod(name, keys, format) {
	formatters[name] = format;
	Object.assign(Schema, { [name](...args) {
		const schema = new Schema({ type: name });
		keys.forEach((key, index) => {
			switch (key) {
				case "sKey":
					schema.sKey = args[index] ?? Schema.string();
					break;
				case "inner":
					schema.inner = Schema.from(args[index]);
					break;
				case "list":
					schema.list = args[index].map(Schema.from);
					break;
				case "dict":
					schema.dict = mapValues(args[index], Schema.from);
					break;
				case "bits":
					schema.bits = {};
					for (const key in args[index]) {
						if (typeof args[index][key] !== "number") continue;
						schema.bits[key] = args[index][key];
					}
					break;
				case "callback": {
					const callback = schema.callback = args[index];
					callback["toJSON"] ||= () => callback.toString();
					break;
				}
				case "constructor": {
					const constructor = schema.constructor = args[index];
					if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
					break;
				}
				default: schema[key] = args[index];
			}
		});
		if (name === "object" || name === "dict") schema.meta.default = {};
		else if (name === "array" || name === "tuple") schema.meta.default = [];
		else if (name === "bitset") schema.meta.default = 0;
		return schema;
	} });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
	if (typeof constructor === "function") return constructor.name;
	else return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
	if (Object.keys(dict).length === 0) return "{}";
	return `{ ${Object.entries(dict).map(([key, inner]) => {
		return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
	}).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
	const result = list.map(({ toString: format }) => format()).join(" | ");
	return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
	return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
	"inner",
	"callback",
	"preserve"
], ({ inner }, isInner) => inner.toString(isInner));
//#endregion
//#region src/pricing.ts
const DEFAULT_GROUP = {
	id: "default",
	name: "默认",
	input: 1,
	output: 2,
	cacheReadMultiplier: .02,
	cacheWriteMultiplier: 1,
	periods: [],
	contextSurcharges: []
};
const DEFAULT_PRICING = {
	currency: "CNY",
	unitTokens: 1e6,
	timezone: "Asia/Shanghai",
	groups: [DEFAULT_GROUP],
	models: {},
	billingProbe: {
		enabled: false,
		intervalMinutes: 30,
		timeoutMs: 1e4,
		concurrency: 2
	}
};
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DEFAULT_GROUP_ID = "default";
function routeKey(provider, model) {
	return provider && model ? `${provider}/${model}` : null;
}
function minuteOfDay(value) {
	const [hour, minute] = value.split(":").map(Number);
	return hour * 60 + minute;
}
function localMinute(time, timezone) {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23"
	}).formatToParts(new Date(time));
	const hour = Number(parts.find((part) => part.type === "hour")?.value);
	const minute = Number(parts.find((part) => part.type === "minute")?.value);
	return hour * 60 + minute;
}
function includesMinute(period, minute) {
	const start = minuteOfDay(period.start);
	const end = minuteOfDay(period.end);
	return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}
function activePeriod(periods, minute) {
	return periods?.find((period) => includesMinute(period, minute));
}
function finiteOr(value, fallback) {
	return value !== void 0 && Number.isFinite(value) ? value : fallback;
}
/** One when the multiplier is omitted, empty, or non-finite. */
function multiplierOrOne(value) {
	return value !== void 0 && Number.isFinite(value) ? value : 1;
}
function findGroup(config, groupId) {
	const id = groupId !== void 0 && groupId.trim() !== "" ? groupId : DEFAULT_GROUP_ID;
	return config.groups.find((group) => group.id === id) ?? config.groups.find((group) => group.id === DEFAULT_GROUP_ID) ?? config.groups[0] ?? DEFAULT_GROUP;
}
function assignmentOf(config, provider, model) {
	const key = routeKey(provider, model);
	return key === null ? void 0 : config.models[key];
}
/** Latest automatic-probe timestamp on one model assignment, or null when none. */
function lastProbeAt(assignment) {
	if (assignment?.lastProbedAt !== void 0 && Number.isFinite(assignment.lastProbedAt) && assignment.lastProbedAt > 0) return assignment.lastProbedAt;
	const history = assignment?.discountMultiplierHistory ?? [];
	for (let index = history.length - 1; index >= 0; index -= 1) {
		const entry = history[index];
		if (entry.source === "manual") continue;
		if (entry.effectiveAt > 0 && (entry.source === "probe" || entry.source === void 0)) return entry.effectiveAt;
	}
	return null;
}
/** Dated discount-multiplier changes, newest last. Baseline `effectiveAt: 0` is omitted. */
function multiplierHistoryRows(assignment) {
	return (assignment?.discountMultiplierHistory ?? []).filter((entry) => Number.isFinite(entry.effectiveAt) && entry.effectiveAt > 0);
}
/** Latest probe or dated multiplier change, or null when none. */
function lastUpdatedAt(assignment) {
	const times = [lastProbeAt(assignment), multiplierHistoryRows(assignment).at(-1)?.effectiveAt].filter((value) => value !== void 0 && value !== null && value > 0);
	return times.length === 0 ? null : Math.max(...times);
}
/** Keep previous history and append a manual change when the discount multiplier moved. */
function assignmentWithManualMultiplier(previous, next, now) {
	const history = next.discountMultiplierHistory ?? previous.discountMultiplierHistory;
	const lastProbedAt = next.lastProbedAt ?? previous.lastProbedAt;
	if (next.discountMultiplier === void 0 || next.discountMultiplier === previous.discountMultiplier) return {
		...next,
		...history !== void 0 ? { discountMultiplierHistory: history } : {},
		...lastProbedAt !== void 0 ? { lastProbedAt } : {}
	};
	const last = [...history ?? []];
	if (last.length === 0) last.push({
		effectiveAt: 0,
		discountMultiplier: previous.discountMultiplier ?? 1
	});
	if (last[last.length - 1]?.discountMultiplier !== next.discountMultiplier) last.push({
		effectiveAt: Math.max(now, (last[last.length - 1]?.effectiveAt ?? -1) + 1),
		discountMultiplier: next.discountMultiplier,
		source: "manual"
	});
	return {
		...next,
		discountMultiplierHistory: last,
		...lastProbedAt !== void 0 ? { lastProbedAt } : {}
	};
}
/** Resolve the latest observed discount whose effective time is not after the request. */
function discountMultiplierAt(assignment, time) {
	const history = assignment?.discountMultiplierHistory ?? [];
	if (history.length === 0) return multiplierOrOne(assignment?.discountMultiplier);
	let multiplier = history[0].discountMultiplier;
	for (const entry of history) {
		if (entry.effectiveAt > time) break;
		multiplier = entry.discountMultiplier;
	}
	return multiplier;
}
function groupRates(group, periodMultiplier, discountMultiplier, modelMultiplier) {
	const scale = periodMultiplier * discountMultiplier * modelMultiplier;
	return {
		input: group.input * scale,
		cacheRead: group.input * group.cacheReadMultiplier * scale,
		cacheWrite: group.input * group.cacheWriteMultiplier * scale,
		output: group.output * scale
	};
}
function resolvePricing(config, provider, model, time) {
	config = normalizePricing(config);
	const minute = localMinute(time, config.timezone);
	const assignment = assignmentOf(config, provider, model);
	const group = findGroup(config, assignment?.groupId);
	const period = activePeriod(group.periods, minute);
	const periodMultiplier = multiplierOrOne(period?.multiplier);
	const discountMultiplier = discountMultiplierAt(assignment, time);
	const modelMultiplier = multiplierOrOne(assignment?.modelMultiplier);
	return {
		rates: groupRates(group, periodMultiplier, discountMultiplier, modelMultiplier),
		source: period !== void 0 ? "group-period" : "group",
		periodName: period?.name,
		groupId: group.id,
		groupName: group.name,
		periodMultiplier,
		discountMultiplier,
		modelMultiplier
	};
}
/**
* Prompt-side tokens that count as this request's context size.
* @param tokens Disjoint prompt buckets from one usage report.
* @returns `input + cacheRead + cacheWrite`. Output is excluded.
*/
function contextTokensOf(tokens) {
	return tokens.input + tokens.cacheRead + tokens.cacheWrite;
}
/**
* Resolve the request-wide cost multiplier for one context size.
* The assigned group's list is used. Among matching tiers
* (`contextTokens > afterTokens`), the highest threshold wins.
* @param config Live pricing, including group surcharge lists.
* @param provider Request provider id, or null when unknown.
* @param model Request model id, or null when unknown.
* @param contextTokens Prompt-side token count from `contextTokensOf()`.
* @returns The matching tier, or null when no surcharge applies.
*/
function resolveContextSurcharge(config, provider, model, contextTokens) {
	config = normalizePricing(config);
	const assignment = assignmentOf(config, provider, model);
	const tiers = findGroup(config, assignment?.groupId).contextSurcharges;
	if (tiers === void 0) return null;
	let matched;
	for (const tier of tiers) {
		if (contextTokens <= tier.afterTokens) continue;
		if (matched === void 0 || tier.afterTokens > matched.afterTokens) matched = tier;
	}
	return matched ?? null;
}
/**
* @param config Live pricing, including group surcharge lists.
* @param provider Request provider id, or null when unknown.
* @param model Request model id, or null when unknown.
* @param contextTokens Prompt-side token count from `contextTokensOf()`.
* @returns The matching multiplier, or 1 when no surcharge applies.
*/
function resolveContextMultiplier(config, provider, model, contextTokens) {
	return resolveContextSurcharge(config, provider, model, contextTokens)?.multiplier ?? 1;
}
/** Compact a token threshold for UI labels, e.g. 200000 → `200K`. */
function formatTokenThreshold(tokens) {
	if (Number.isSafeInteger(tokens) && tokens >= 1e6 && tokens % 1e6 === 0) return `${tokens / 1e6}M`;
	if (Number.isSafeInteger(tokens) && tokens >= 1e3 && tokens % 1e3 === 0) return `${tokens / 1e3}K`;
	return tokens.toLocaleString("zh-CN");
}
/**
* Whether this route bills `reasoningTokens` on top of `outputTokens`.
* @param config Live pricing.
* @param provider Request provider id, or null when unknown.
* @param model Request model id, or null when unknown.
* @returns The model plan flag, or undefined when the plan does not declare one.
*/
function resolveReasoningExtra(config, provider, model) {
	return assignmentOf(normalizePricing(config), provider, model)?.reasoningExtra;
}
/**
* Output tokens that should be billed at the output rate.
* @param outputTokens Visible / `completion_tokens` count from the usage report.
* @param reasoningTokens `reasoningTokens` or `completion_tokens_details.reasoning_tokens`.
* @param reasoningExtra Model-plan flag from `resolveReasoningExtra()`.
* @returns `output + reasoning` when they are disjoint; otherwise `output`.
*/
function billedOutputTokens(outputTokens, reasoningTokens, reasoningExtra) {
	if (reasoningTokens <= 0) return outputTokens;
	if (reasoningExtra === true) return outputTokens + reasoningTokens;
	if (reasoningExtra === false) return outputTokens;
	return reasoningTokens > outputTokens ? outputTokens + reasoningTokens : outputTokens;
}
function formatContextSurcharge(afterTokens, multiplier) {
	if (multiplier === void 0 || multiplier === null || multiplier === 1) return null;
	if (afterTokens === void 0 || afterTokens === null) return `×${multiplier}`;
	return `超过 ${formatTokenThreshold(afterTokens)} ×${multiplier}`;
}
function assertNonNegative(value, path) {
	if (!Number.isFinite(value) || value < 0) throw new TypeError(`${path} must be a non-negative finite number`);
}
function minuteSegments(period) {
	const start = minuteOfDay(period.start);
	const end = minuteOfDay(period.end);
	return start < end ? [[start, end]] : [[start, 1440], [0, end]];
}
function overlaps(left, right) {
	return minuteSegments(left).some(([leftStart, leftEnd]) => minuteSegments(right).some(([rightStart, rightEnd]) => Math.max(leftStart, rightStart) < Math.min(leftEnd, rightEnd)));
}
function assertPeriods(periods, path) {
	if (periods === void 0) return;
	const ids = /* @__PURE__ */ new Set();
	for (const [index, period] of periods.entries()) {
		const itemPath = `${path}[${index}]`;
		if (period.id.trim() === "" || ids.has(period.id)) throw new TypeError(`${itemPath}.id must be unique and non-empty`);
		ids.add(period.id);
		if (period.name.trim() === "") throw new TypeError(`${itemPath}.name is required`);
		if (!TIME_PATTERN.test(period.start) || !TIME_PATTERN.test(period.end) || period.start === period.end) throw new TypeError(`${itemPath} must use distinct HH:mm start and end times`);
		assertNonNegative(period.multiplier, `${itemPath}.multiplier`);
	}
	for (let left = 0; left < periods.length; left += 1) for (let right = left + 1; right < periods.length; right += 1) if (overlaps(periods[left], periods[right])) throw new TypeError(`${path} contains overlapping periods`);
}
function assertContextSurcharges(tiers, path) {
	if (tiers === void 0) return;
	const thresholds = /* @__PURE__ */ new Set();
	for (const [index, tier] of tiers.entries()) {
		const itemPath = `${path}[${index}]`;
		if (!Number.isSafeInteger(tier.afterTokens) || tier.afterTokens < 0) throw new TypeError(`${itemPath}.afterTokens must be a non-negative safe integer`);
		if (thresholds.has(tier.afterTokens)) throw new TypeError(`${path} contains duplicate afterTokens`);
		thresholds.add(tier.afterTokens);
		assertNonNegative(tier.multiplier, `${itemPath}.multiplier`);
	}
}
function slugify(value) {
	const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
	return slug === "" ? "group" : slug.slice(0, 40);
}
function uniqueId(base, used) {
	if (!used.has(base)) {
		used.add(base);
		return base;
	}
	let index = 2;
	while (used.has(`${base}-${index}`)) index += 1;
	const id = `${base}-${index}`;
	used.add(id);
	return id;
}
function periodMultiplierOf(period, base) {
	if (period.multiplier !== void 0 && Number.isFinite(period.multiplier)) return period.multiplier;
	const rates = period.rates;
	if (rates === void 0) return 1;
	if (rates.input !== void 0 && Number.isFinite(rates.input) && base.input > 0) return rates.input / base.input;
	if (rates.output !== void 0 && Number.isFinite(rates.output) && base.output > 0) return rates.output / base.output;
	const ratios = [];
	for (const key of ["cacheRead", "cacheWrite"]) {
		const value = rates[key];
		const denom = base[key];
		if (value === void 0 || !Number.isFinite(value) || denom <= 0) continue;
		ratios.push(value / denom);
	}
	if (ratios.length === 0) return 1;
	return ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
}
function normalizePeriods(periods, base) {
	if (periods === void 0) return [];
	return periods.map((period) => ({
		id: period.id,
		name: period.name,
		start: period.start,
		end: period.end,
		multiplier: periodMultiplierOf(period, base)
	}));
}
function tokenRatesOf(partial, fallback) {
	return {
		input: finiteOr(partial?.input, fallback.input),
		cacheRead: finiteOr(partial?.cacheRead, fallback.cacheRead),
		cacheWrite: finiteOr(partial?.cacheWrite, fallback.cacheWrite),
		output: finiteOr(partial?.output, fallback.output)
	};
}
function ratio(numerator, denominator) {
	if (denominator <= 0) return 0;
	return Number((numerator / denominator).toPrecision(12));
}
function groupFromRates(id, name, rates, periods, contextSurcharges) {
	const input = rates.input;
	return {
		id,
		name,
		input,
		output: rates.output,
		cacheReadMultiplier: ratio(rates.cacheRead, input),
		cacheWriteMultiplier: ratio(rates.cacheWrite, input),
		periods,
		contextSurcharges: contextSurcharges ?? []
	};
}
function sameGroup(left, right) {
	return left.input === right.input && left.output === right.output && left.cacheReadMultiplier === right.cacheReadMultiplier && left.cacheWriteMultiplier === right.cacheWriteMultiplier && JSON.stringify(left.periods ?? []) === JSON.stringify(right.periods ?? []) && JSON.stringify(left.contextSurcharges ?? []) === JSON.stringify(right.contextSurcharges ?? []);
}
function assignmentFromPlan(plan, groupId) {
	const assignment = { groupId };
	if (plan.discountMultiplier !== void 0) assignment.discountMultiplier = plan.discountMultiplier;
	if (plan.discountMultiplierHistory !== void 0) assignment.discountMultiplierHistory = [...plan.discountMultiplierHistory].sort((left, right) => left.effectiveAt - right.effectiveAt);
	if (plan.lastProbedAt !== void 0) assignment.lastProbedAt = plan.lastProbedAt;
	if (plan.modelMultiplier !== void 0) assignment.modelMultiplier = plan.modelMultiplier;
	if (plan.reasoningExtra !== void 0) assignment.reasoningExtra = plan.reasoningExtra;
	return assignment;
}
/**
* Accept the current group/assignment document and the previous
* default/models absolute-rate document. Always returns a group-based config.
*/
function normalizePricing(raw) {
	const input = raw !== null && typeof raw === "object" ? raw : {};
	const currency = typeof input.currency === "string" && input.currency.trim() !== "" ? input.currency : DEFAULT_PRICING.currency;
	const unitTokens = Number.isSafeInteger(input.unitTokens) && (input.unitTokens ?? 0) >= 1 ? input.unitTokens : DEFAULT_PRICING.unitTokens;
	const timezone = typeof input.timezone === "string" && input.timezone.trim() !== "" ? input.timezone : DEFAULT_PRICING.timezone;
	const rawProbe = input.billingProbe;
	const billingProbe = rawProbe !== null && typeof rawProbe === "object" ? {
		enabled: rawProbe.enabled === true,
		intervalMinutes: rawProbe.intervalMinutes ?? 30,
		timeoutMs: rawProbe.timeoutMs ?? 1e4,
		concurrency: rawProbe.concurrency ?? 2,
		providers: Array.isArray(rawProbe.providers) ? [...rawProbe.providers] : void 0
	} : DEFAULT_PRICING.billingProbe;
	if (Array.isArray(input.groups) && input.groups.length > 0) {
		const groups = input.groups.map((group) => ({
			...group,
			periods: (group.periods ?? []).map((period) => ({
				id: period.id,
				name: period.name,
				start: period.start,
				end: period.end,
				multiplier: multiplierOrOne(period.multiplier)
			})),
			contextSurcharges: group.contextSurcharges ?? []
		}));
		const models = {};
		for (const [key, plan] of Object.entries(input.models ?? {})) {
			if (plan === void 0) continue;
			models[key] = assignmentFromPlan(plan, plan.groupId ?? DEFAULT_GROUP_ID);
		}
		return {
			currency,
			unitTokens,
			timezone,
			groups,
			models,
			billingProbe
		};
	}
	const fallbackRates = DEFAULT_GROUP;
	const defaultRates = tokenRatesOf(input.default?.rates, {
		input: fallbackRates.input,
		cacheRead: fallbackRates.input * fallbackRates.cacheReadMultiplier,
		cacheWrite: fallbackRates.input * fallbackRates.cacheWriteMultiplier,
		output: fallbackRates.output
	});
	const defaultGroup = groupFromRates(DEFAULT_GROUP_ID, "默认", defaultRates, normalizePeriods(input.default?.periods, defaultRates), input.default?.contextSurcharges);
	const groups = [defaultGroup];
	const used = /* @__PURE__ */ new Set([DEFAULT_GROUP_ID]);
	const models = {};
	for (const [key, plan] of Object.entries(input.models ?? {})) {
		if (plan === void 0) continue;
		const rates = tokenRatesOf(plan.rates, defaultRates);
		const periods = plan.periods === void 0 || plan.periods.length === 0 ? defaultGroup.periods ?? [] : normalizePeriods(plan.periods, rates);
		const contextSurcharges = plan.contextSurcharges ?? defaultGroup.contextSurcharges;
		const candidate = groupFromRates(uniqueId(slugify(key), used), key, rates, periods, contextSurcharges);
		const existing = groups.find((group) => sameGroup(group, candidate));
		if (existing !== void 0) {
			used.delete(candidate.id);
			models[key] = assignmentFromPlan(plan, existing.id);
			continue;
		}
		groups.push(candidate);
		models[key] = assignmentFromPlan(plan, candidate.id);
	}
	return {
		currency,
		unitTokens,
		timezone,
		groups,
		models,
		billingProbe
	};
}
function assertGroup(group, path) {
	if (group.id.trim() === "") throw new TypeError(`${path}.id must be non-empty`);
	if (group.name.trim() === "") throw new TypeError(`${path}.name is required`);
	assertNonNegative(group.input, `${path}.input`);
	assertNonNegative(group.output, `${path}.output`);
	assertNonNegative(group.cacheReadMultiplier, `${path}.cacheReadMultiplier`);
	assertNonNegative(group.cacheWriteMultiplier, `${path}.cacheWriteMultiplier`);
	assertPeriods(group.periods, `${path}.periods`);
	assertContextSurcharges(group.contextSurcharges, `${path}.contextSurcharges`);
}
function validatePricing(config) {
	config = normalizePricing(config);
	if (config.currency.trim() === "" || config.currency.length > 8) throw new TypeError("currency must contain 1-8 characters");
	if (!Number.isSafeInteger(config.unitTokens) || config.unitTokens < 1) throw new TypeError("unitTokens must be a positive safe integer");
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: config.timezone }).format(0);
	} catch {
		throw new TypeError(`timezone "${config.timezone}" is not an IANA time zone`);
	}
	const probe = config.billingProbe;
	if (probe !== void 0) {
		if (typeof probe.enabled !== "boolean") throw new TypeError("billingProbe.enabled must be boolean");
		if (probe.intervalMinutes !== void 0 && (!Number.isSafeInteger(probe.intervalMinutes) || probe.intervalMinutes < 5 || probe.intervalMinutes > 1440)) throw new TypeError("billingProbe.intervalMinutes must be an integer from 5 to 1440");
		if (probe.timeoutMs !== void 0 && (!Number.isSafeInteger(probe.timeoutMs) || probe.timeoutMs < 1e3 || probe.timeoutMs > 6e4)) throw new TypeError("billingProbe.timeoutMs must be an integer from 1000 to 60000");
		if (probe.concurrency !== void 0 && (!Number.isSafeInteger(probe.concurrency) || probe.concurrency < 1 || probe.concurrency > 8)) throw new TypeError("billingProbe.concurrency must be an integer from 1 to 8");
		if (probe.providers !== void 0 && (!Array.isArray(probe.providers) || probe.providers.some((provider) => typeof provider !== "string" || provider.trim() === ""))) throw new TypeError("billingProbe.providers must contain non-empty strings");
	}
	if (!Array.isArray(config.groups) || config.groups.length === 0) throw new TypeError("groups must contain at least one pricing group");
	const ids = /* @__PURE__ */ new Set();
	for (const [index, group] of config.groups.entries()) {
		const path = `groups[${index}]`;
		if (ids.has(group.id)) throw new TypeError(`${path}.id "${group.id}" is not unique`);
		ids.add(group.id);
		assertGroup(group, path);
	}
	for (const [key, assignment] of Object.entries(config.models)) {
		if (key.trim() === "" || !key.includes("/")) throw new TypeError(`model key "${key}" must be provider/model`);
		if (assignment.groupId === void 0 || assignment.groupId.trim() === "" || !ids.has(assignment.groupId)) throw new TypeError(`models.${key}.groupId "${assignment.groupId}" does not match a pricing group`);
		if (assignment.discountMultiplier !== void 0) assertNonNegative(assignment.discountMultiplier, `models.${key}.discountMultiplier`);
		let previousEffectiveAt = -1;
		for (const [index, entry] of (assignment.discountMultiplierHistory ?? []).entries()) {
			if (!Number.isSafeInteger(entry.effectiveAt) || entry.effectiveAt < 0 || entry.effectiveAt <= previousEffectiveAt) throw new TypeError(`models.${key}.discountMultiplierHistory[${index}].effectiveAt must be strictly increasing epoch milliseconds`);
			assertNonNegative(entry.discountMultiplier, `models.${key}.discountMultiplierHistory[${index}].discountMultiplier`);
			if (entry.source !== void 0 && entry.source !== "probe" && entry.source !== "manual") throw new TypeError(`models.${key}.discountMultiplierHistory[${index}].source must be probe or manual`);
			previousEffectiveAt = entry.effectiveAt;
		}
		if (assignment.discountMultiplierHistory !== void 0 && !Array.isArray(assignment.discountMultiplierHistory)) throw new TypeError(`models.${key}.discountMultiplierHistory must be an array`);
		if (assignment.lastProbedAt !== void 0 && (!Number.isSafeInteger(assignment.lastProbedAt) || assignment.lastProbedAt < 0)) throw new TypeError(`models.${key}.lastProbedAt must be a non-negative epoch millisecond`);
		if (assignment.modelMultiplier !== void 0) assertNonNegative(assignment.modelMultiplier, `models.${key}.modelMultiplier`);
	}
}
function num(value) {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
function firstNumber(...values) {
	for (const value of values) if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
	return 0;
}
function object$1(value) {
	return value !== null && typeof value === "object" ? value : {};
}
/** Normalize common provider usage responses into DSH's disjoint token buckets. */
function normalizeUsage(raw) {
	const promptDetails = object$1(raw.prompt_tokens_details);
	const inputDetails = object$1(raw.input_tokens_details);
	const completionDetails = object$1(raw.completion_tokens_details);
	const cacheRead = firstNumber(raw.cacheReadTokens, raw.cache_read_input_tokens, raw.cache_read_tokens, promptDetails.cached_tokens, inputDetails.cached_tokens, raw.prompt_cache_hit_tokens);
	const cacheWrite = firstNumber(raw.cacheWriteTokens, raw.cache_write_input_tokens, raw.cache_write_tokens, raw.cache_creation_input_tokens, raw.cache_creation_tokens, promptDetails.cache_creation_input_tokens, inputDetails.cache_creation_input_tokens);
	const canonicalInput = raw.inputTokens;
	const anthropicInput = raw.input_tokens;
	const promptTotal = firstNumber(raw.prompt_tokens, raw.promptTokens);
	return {
		inputTokens: canonicalInput !== void 0 ? num(canonicalInput) : anthropicInput !== void 0 ? num(anthropicInput) : Math.max(0, promptTotal - cacheRead - cacheWrite),
		cacheReadTokens: cacheRead,
		cacheWriteTokens: cacheWrite,
		outputTokens: firstNumber(raw.outputTokens, raw.output_tokens, raw.completion_tokens),
		reasoningTokens: firstNumber(raw.reasoningTokens, raw.reasoning_tokens, completionDetails.reasoning_tokens)
	};
}
function emptyFold(config) {
	return {
		cost: 0,
		inputCost: 0,
		cacheReadCost: 0,
		cacheWriteCost: 0,
		outputCost: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		provider: null,
		model: null,
		route: null,
		currency: config.currency,
		unitTokens: config.unitTokens,
		pricingSource: null,
		pricingPeriod: null,
		groupId: null,
		groupName: null,
		details: [],
		hourly: [],
		subagents: []
	};
}
function hourKey(time) {
	const d = new Date(time);
	d.setMinutes(0, 0, 0);
	return d.toISOString();
}
function hourLabel(time) {
	const d = new Date(time);
	const h = String(d.getHours()).padStart(2, "0");
	return `${h}:00–${h}:59`;
}
/** Fold request routes and provider usage into a cumulative estimate. */
function foldSession(events, config = DEFAULT_PRICING) {
	config = normalizePricing(config);
	const out = emptyFold(config);
	let provider = null;
	let model = null;
	let last = null;
	let lastPricing = null;
	let lastHourKey = null;
	const detailMap = /* @__PURE__ */ new Map();
	const detailKey = (p, m, s, pn, groupId, discount, modelMul, multiplier, afterTokens) => `${p ?? ""}|${m ?? ""}|${s}|${pn ?? ""}|${groupId}|${discount}|${modelMul}|${multiplier}|${afterTokens ?? ""}`;
	const ensureDetail = (pricing, multiplier, afterTokens) => {
		const key = detailKey(provider, model, pricing.source, pricing.periodName ?? null, pricing.groupId, pricing.discountMultiplier, pricing.modelMultiplier, multiplier, afterTokens);
		let detail = detailMap.get(key);
		if (detail === void 0) {
			detail = {
				source: pricing.source,
				periodName: pricing.periodName ?? null,
				provider,
				model,
				groupId: pricing.groupId,
				groupName: pricing.groupName,
				rates: { ...pricing.rates },
				periodMultiplier: pricing.periodMultiplier,
				discountMultiplier: pricing.discountMultiplier,
				modelMultiplier: pricing.modelMultiplier,
				contextMultiplier: multiplier,
				contextAfterTokens: afterTokens,
				inputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				outputTokens: 0,
				inputCost: 0,
				cacheReadCost: 0,
				cacheWriteCost: 0,
				outputCost: 0,
				cost: 0
			};
			detailMap.set(key, detail);
		}
		return detail;
	};
	const hourMap = /* @__PURE__ */ new Map();
	const hourBucketKey = (hKey, pricing, multiplier, afterTokens) => `${hKey}|${provider ?? ""}|${model ?? ""}|${pricing.source}|${pricing.periodName ?? ""}|${pricing.groupId}|${pricing.discountMultiplier}|${pricing.modelMultiplier}|${multiplier}|${afterTokens ?? ""}`;
	const ensureHour = (hKey, pricing, multiplier, afterTokens) => {
		const key = hourBucketKey(hKey, pricing, multiplier, afterTokens);
		let bucket = hourMap.get(key);
		if (bucket === void 0) {
			bucket = {
				hour: hKey,
				hourLabel: hourLabel(new Date(hKey).getTime()),
				turns: /* @__PURE__ */ new Set(),
				steps: /* @__PURE__ */ new Set(),
				toolCalls: 0,
				model,
				provider,
				pricingSource: pricing.source,
				periodName: pricing.periodName ?? null,
				groupId: pricing.groupId,
				groupName: pricing.groupName,
				contextMultiplier: multiplier,
				contextAfterTokens: afterTokens,
				rates: { ...pricing.rates },
				inputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				outputTokens: 0,
				inputCost: 0,
				cacheReadCost: 0,
				cacheWriteCost: 0,
				outputCost: 0,
				cost: 0
			};
			hourMap.set(key, bucket);
		}
		return bucket;
	};
	for (const event of events) {
		if (event.type === "request/header") {
			const call = event.data.header?.config;
			if (typeof call?.provider === "string") provider = call.provider;
			if (typeof call?.model === "string") model = call.model;
			continue;
		}
		if (event.type === "tool/call") {
			const pricing = resolvePricing(config, provider, model, event.time);
			ensureHour(hourKey(event.time), pricing, 1, null).toolCalls += 1;
			continue;
		}
		let usage;
		if (event.type === "assistant/message") usage = event.data.usage;
		else if (event.type === "assistant/chunk" && event.data.chunk?.type === "usage") usage = event.data.chunk.usage;
		else continue;
		if (usage === void 0 || usage === null) continue;
		const pricing = resolvePricing(config, provider, model, event.time);
		const normalized = normalizeUsage(usage);
		const tokens = {
			input: normalized.inputTokens,
			cacheRead: normalized.cacheReadTokens,
			cacheWrite: normalized.cacheWriteTokens,
			output: billedOutputTokens(normalized.outputTokens, normalized.reasoningTokens, resolveReasoningExtra(config, provider, model))
		};
		const surcharge = resolveContextSurcharge(config, provider, model, contextTokensOf(tokens));
		const contextMultiplier = surcharge?.multiplier ?? 1;
		const contextAfterTokens = surcharge?.afterTokens ?? null;
		const costs = {
			input: tokens.input * pricing.rates.input / config.unitTokens * contextMultiplier,
			cacheRead: tokens.cacheRead * pricing.rates.cacheRead / config.unitTokens * contextMultiplier,
			cacheWrite: tokens.cacheWrite * pricing.rates.cacheWrite / config.unitTokens * contextMultiplier,
			output: tokens.output * pricing.rates.output / config.unitTokens * contextMultiplier
		};
		const hKey = hourKey(event.time);
		if (last !== null && last.turn === event.data.turn && last.step === event.data.step) {
			out.inputCost -= last.costs.input;
			out.cacheReadCost -= last.costs.cacheRead;
			out.cacheWriteCost -= last.costs.cacheWrite;
			out.outputCost -= last.costs.output;
			out.inputTokens -= last.tokens.input;
			out.cacheReadTokens -= last.tokens.cacheRead;
			out.cacheWriteTokens -= last.tokens.cacheWrite;
			out.outputTokens -= last.tokens.output;
			if (lastPricing !== null) {
				const prevDetail = ensureDetail(lastPricing, last.contextMultiplier, last.contextAfterTokens);
				prevDetail.inputTokens -= last.tokens.input;
				prevDetail.cacheReadTokens -= last.tokens.cacheRead;
				prevDetail.cacheWriteTokens -= last.tokens.cacheWrite;
				prevDetail.outputTokens -= last.tokens.output;
				prevDetail.inputCost -= last.costs.input;
				prevDetail.cacheReadCost -= last.costs.cacheRead;
				prevDetail.cacheWriteCost -= last.costs.cacheWrite;
				prevDetail.outputCost -= last.costs.output;
				prevDetail.cost = prevDetail.inputCost + prevDetail.cacheReadCost + prevDetail.cacheWriteCost + prevDetail.outputCost;
			}
			if (lastHourKey !== null) {
				const prevBucket = ensureHour(lastHourKey, lastPricing ?? pricing, last.contextMultiplier, last.contextAfterTokens);
				prevBucket.inputTokens -= last.tokens.input;
				prevBucket.cacheReadTokens -= last.tokens.cacheRead;
				prevBucket.cacheWriteTokens -= last.tokens.cacheWrite;
				prevBucket.outputTokens -= last.tokens.output;
				prevBucket.inputCost -= last.costs.input;
				prevBucket.cacheReadCost -= last.costs.cacheRead;
				prevBucket.cacheWriteCost -= last.costs.cacheWrite;
				prevBucket.outputCost -= last.costs.output;
				prevBucket.cost = prevBucket.inputCost + prevBucket.cacheReadCost + prevBucket.cacheWriteCost + prevBucket.outputCost;
			}
		}
		out.inputCost += costs.input;
		out.cacheReadCost += costs.cacheRead;
		out.cacheWriteCost += costs.cacheWrite;
		out.outputCost += costs.output;
		out.inputTokens += tokens.input;
		out.cacheReadTokens += tokens.cacheRead;
		out.cacheWriteTokens += tokens.cacheWrite;
		out.outputTokens += tokens.output;
		out.provider = provider;
		out.model = model;
		out.route = routeKey(provider, model);
		out.pricingSource = pricing.source;
		out.pricingPeriod = pricing.periodName ?? null;
		out.groupId = pricing.groupId;
		out.groupName = pricing.groupName;
		last = {
			turn: event.data.turn,
			step: event.data.step,
			costs,
			tokens,
			hourBucketKey: hourBucketKey(hKey, pricing, contextMultiplier, contextAfterTokens),
			contextMultiplier,
			contextAfterTokens
		};
		lastPricing = pricing;
		lastHourKey = hKey;
		const bucket = ensureHour(hKey, pricing, contextMultiplier, contextAfterTokens);
		if (event.data.turn !== void 0) bucket.turns.add(event.data.turn);
		if (event.data.turn !== void 0 && event.data.step !== void 0) bucket.steps.add(`${event.data.turn}/${event.data.step}`);
		bucket.inputTokens += tokens.input;
		bucket.cacheReadTokens += tokens.cacheRead;
		bucket.cacheWriteTokens += tokens.cacheWrite;
		bucket.outputTokens += tokens.output;
		bucket.inputCost += costs.input;
		bucket.cacheReadCost += costs.cacheRead;
		bucket.cacheWriteCost += costs.cacheWrite;
		bucket.outputCost += costs.output;
		bucket.cost = bucket.inputCost + bucket.cacheReadCost + bucket.cacheWriteCost + bucket.outputCost;
		const detail = ensureDetail(pricing, contextMultiplier, contextAfterTokens);
		detail.inputTokens += tokens.input;
		detail.cacheReadTokens += tokens.cacheRead;
		detail.cacheWriteTokens += tokens.cacheWrite;
		detail.outputTokens += tokens.output;
		detail.inputCost += costs.input;
		detail.cacheReadCost += costs.cacheRead;
		detail.cacheWriteCost += costs.cacheWrite;
		detail.outputCost += costs.output;
		detail.cost = detail.inputCost + detail.cacheReadCost + detail.cacheWriteCost + detail.outputCost;
	}
	out.cost = out.inputCost + out.cacheReadCost + out.cacheWriteCost + out.outputCost;
	out.details = [...detailMap.values()].filter((detail) => detail.inputTokens !== 0 || detail.cacheReadTokens !== 0 || detail.cacheWriteTokens !== 0 || detail.outputTokens !== 0 || detail.cost !== 0);
	out.hourly = [...hourMap.values()].flatMap((bucket) => {
		const totalTokens = bucket.inputTokens + bucket.cacheReadTokens + bucket.cacheWriteTokens + bucket.outputTokens;
		if (totalTokens === 0 && bucket.cost === 0 && bucket.toolCalls === 0) return [];
		return [{
			hour: bucket.hour,
			hourLabel: bucket.hourLabel,
			turns: bucket.turns.size,
			steps: bucket.steps.size,
			toolCalls: bucket.toolCalls,
			inputTokens: bucket.inputTokens,
			cacheReadTokens: bucket.cacheReadTokens,
			cacheWriteTokens: bucket.cacheWriteTokens,
			outputTokens: bucket.outputTokens,
			inputCost: bucket.inputCost,
			cacheReadCost: bucket.cacheReadCost,
			cacheWriteCost: bucket.cacheWriteCost,
			outputCost: bucket.outputCost,
			cost: bucket.cost,
			cacheRate: totalTokens > 0 ? (bucket.cacheReadTokens + bucket.cacheWriteTokens) / totalTokens : 0,
			model: bucket.model,
			provider: bucket.provider,
			pricingSource: bucket.pricingSource,
			periodName: bucket.periodName,
			groupId: bucket.groupId,
			groupName: bucket.groupName,
			contextMultiplier: bucket.contextMultiplier,
			contextAfterTokens: bucket.contextAfterTokens,
			rates: bucket.rates
		}];
	}).sort((a, b) => a.hour.localeCompare(b.hour) || (a.provider ?? "").localeCompare(b.provider ?? "") || (a.model ?? "").localeCompare(b.model ?? "") || a.contextMultiplier - b.contextMultiplier);
	return out;
}
//#endregion
//#region src/session-fold-cache.ts
/** In-process cache of each session's own fold, keyed by pricing and log fingerprints. */
function stableValue(value) {
	if (Array.isArray(value)) return value.map(stableValue);
	if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().filter((key) => key !== "lastProbedAt").map((key) => [key, stableValue(value[key])]));
	return value;
}
/** Deterministic fingerprint of the live pricing used to value a fold. Probe timestamps do not change billed rates. */
function pricingFingerprint(config) {
	return JSON.stringify(stableValue(config));
}
function usageMix(event) {
	const usage = event.data.usage ?? (event.data.chunk?.type === "usage" ? event.data.chunk.usage : void 0);
	if (usage === void 0) return 0;
	let mix = 0;
	for (const value of Object.values(usage)) if (typeof value === "number" && Number.isFinite(value)) mix = Math.imul(mix, 33) + (value | 0) >>> 0;
	return mix;
}
/**
* Cheap identity of one session log. Length, a rolling mix of type/time/usage,
* and the last event distinguish appends and last-writer-wins usage
* replacements without hashing the whole payload.
*/
function logFingerprint(events) {
	let mix = events.length >>> 0;
	for (const event of events) {
		mix = Math.imul(mix, 33) + event.type.length >>> 0;
		mix = Math.imul(mix, 33) + (event.time | 0) >>> 0;
		const turn = event.data.turn;
		const step = event.data.step;
		if (typeof turn === "number") mix = Math.imul(mix, 33) + (turn | 0) >>> 0;
		if (typeof step === "number") mix = Math.imul(mix, 33) + (step | 0) >>> 0;
		mix = Math.imul(mix, 33) + usageMix(event) >>> 0;
	}
	const last = events[events.length - 1];
	return `${events.length}:${mix}:${last?.type ?? ""}:${last?.time ?? 0}:${last?.data.turn ?? ""}:${last?.data.step ?? ""}:${usageMix(last ?? {
		type: "",
		time: 0,
		data: {}
	})}`;
}
/**
* Reuse a session's own fold when the pricing config and log fingerprint match.
* A pricing change drops every entry. Deleted ids are dropped by `retain()`.
*/
var SessionFoldCache = class {
	compute;
	entries = /* @__PURE__ */ new Map();
	pricing = "";
	stats = {
		hits: 0,
		misses: 0
	};
	constructor(compute = foldSession) {
		this.compute = compute;
	}
	get size() {
		return this.entries.size;
	}
	alignPricing(config) {
		const pricing = pricingFingerprint(config);
		if (this.pricing !== "" && this.pricing !== pricing) this.entries.clear();
		this.pricing = pricing;
		return pricing;
	}
	/**
	* Return a previously stored own-fold when the live pricing still matches.
	* Callers that already know the session is not live may skip a durable reread.
	* @param sessionId Durable session id.
	* @param config Live pricing. A different fingerprint clears the cache first.
	* @returns The cached own-fold, or undefined on a miss.
	*/
	peek(sessionId, config) {
		const pricing = this.alignPricing(config);
		const hit = this.entries.get(sessionId);
		if (hit === void 0 || hit.pricing !== pricing) return void 0;
		this.stats.hits += 1;
		return hit.cost;
	}
	/**
	* Return the cached own-fold or compute and store a new one.
	* @param sessionId Durable session id.
	* @param events Complete log used for the fingerprint and, on a miss, the fold.
	* @param config Live pricing. A different fingerprint clears the cache first.
	* @returns The session's own fold, never a parent-merged total.
	*/
	fold(sessionId, events, config) {
		const pricing = this.alignPricing(config);
		const log = logFingerprint(events);
		const hit = this.entries.get(sessionId);
		if (hit !== void 0 && hit.pricing === pricing && hit.log === log) {
			this.stats.hits += 1;
			return hit.cost;
		}
		this.stats.misses += 1;
		const cost = this.compute(events, config);
		this.entries.set(sessionId, {
			pricing,
			log,
			cost
		});
		return cost;
	}
	/** Drop entries whose session is no longer in the listed corpus. */
	retain(sessionIds) {
		const keep = new Set(sessionIds);
		for (const id of this.entries.keys()) if (!keep.has(id)) this.entries.delete(id);
	}
};
//#endregion
//#region src/session-table.ts
/** Pure session-overview query helpers shared by the host tests and the dock UI. */
/** Combine one listed session with its independently folded cost. */
function mergeListedSessionCost(item, cost) {
	return {
		sessionId: item.sessionId,
		parentSession: item.parentSessionId ?? null,
		origin: item.origin ?? null,
		cost
	};
}
function routeLabel(provider, model) {
	if (provider && model) return `${provider}/${model}`;
	return model ?? provider ?? null;
}
/** Distinct provider/model routes observed on one session fold. */
function sessionRoutes(row) {
	const routes = /* @__PURE__ */ new Set();
	if (row.cost.route) routes.add(row.cost.route);
	for (const hourly of row.cost.hourly ?? []) {
		const key = routeLabel(hourly.provider, hourly.model);
		if (key) routes.add(key);
	}
	for (const detail of row.cost.details ?? []) {
		const key = routeLabel(detail.provider, detail.model);
		if (key) routes.add(key);
	}
	return [...routes];
}
function sessionTotalTokens(row) {
	return row.cost.inputTokens + row.cost.cacheReadTokens + row.cost.cacheWriteTokens + row.cost.outputTokens;
}
/** Keep rows that match every populated filter field. */
function filterSessionRows(rows, filter) {
	const sessionId = filter.sessionId.trim().toLowerCase();
	const parent = filter.parentSession.trim().toLowerCase();
	return rows.filter((row) => {
		if (sessionId && !row.sessionId.toLowerCase().includes(sessionId)) return false;
		if (filter.origin && (row.origin ?? "") !== filter.origin) return false;
		if (parent && !(row.parentSession ?? "").toLowerCase().includes(parent)) return false;
		if (filter.route && !sessionRoutes(row).includes(filter.route)) return false;
		if (filter.minCost !== void 0 && row.cost.cost < filter.minCost) return false;
		if (filter.maxCost !== void 0 && row.cost.cost > filter.maxCost) return false;
		return true;
	});
}
function compareSessionRows(left, right, key) {
	switch (key) {
		case "sessionId": return left.sessionId.localeCompare(right.sessionId);
		case "origin": return (left.origin ?? "").localeCompare(right.origin ?? "");
		case "parentSession": return (left.parentSession ?? "").localeCompare(right.parentSession ?? "");
		case "cost": return left.cost.cost - right.cost.cost;
		case "inputTokens": return left.cost.inputTokens - right.cost.inputTokens;
		case "cacheReadTokens": return left.cost.cacheReadTokens - right.cost.cacheReadTokens;
		case "outputTokens": return left.cost.outputTokens - right.cost.outputTokens;
		case "totalTokens": return sessionTotalTokens(left) - sessionTotalTokens(right);
	}
}
/** Stable sort: equal values keep sessionId order. */
function sortSessionRows(rows, sort) {
	const direction = sort.dir === "asc" ? 1 : -1;
	return [...rows].sort((left, right) => {
		const compared = compareSessionRows(left, right, sort.key);
		return compared === 0 ? left.sessionId.localeCompare(right.sessionId) : compared * direction;
	});
}
function querySessionRows(rows, filter, sort) {
	return sortSessionRows(filterSessionRows(rows, filter), sort);
}
function toggleSessionTableSort(current, key) {
	if (current.key === key) return {
		key,
		dir: current.dir === "asc" ? "desc" : "asc"
	};
	return {
		key,
		dir: key === "sessionId" || key === "origin" || key === "parentSession" ? "asc" : "desc"
	};
}
/** Map items with a bounded number of in-flight promises, preserving input order. */
async function mapWithConcurrency(items, concurrency, mapper) {
	const limit = Math.max(1, Math.min(items.length, Math.floor(concurrency) || 1));
	const results = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const index = next;
			next += 1;
			results[index] = await mapper(items[index], index);
		}
	};
	await Promise.all(Array.from({ length: limit }, () => worker()));
	return results;
}
function emptyHourlySlice(hour = "", hourLabel = "") {
	return {
		hour,
		hourLabel,
		turns: 0,
		steps: 0,
		toolCalls: 0,
		inputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		outputTokens: 0,
		inputCost: 0,
		cacheReadCost: 0,
		cacheWriteCost: 0,
		outputCost: 0,
		cost: 0,
		cacheRate: 0,
		model: null,
		provider: null,
		periodName: null,
		groupId: null,
		groupName: null
	};
}
/** Local calendar date of an hourly ISO bucket. */
function localDateOfHour(hour) {
	const date = new Date(hour);
	if (Number.isNaN(date.getTime())) return "";
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function hourlyRoute(entry) {
	return routeLabel(entry.provider, entry.model);
}
function asHourlySlice(value) {
	if (typeof value.hour !== "string" || value.hour === "") return null;
	return {
		hour: value.hour,
		hourLabel: value.hourLabel ?? value.hour,
		turns: value.turns ?? 0,
		steps: value.steps ?? 0,
		toolCalls: value.toolCalls ?? 0,
		inputTokens: value.inputTokens ?? 0,
		cacheReadTokens: value.cacheReadTokens ?? 0,
		cacheWriteTokens: value.cacheWriteTokens ?? 0,
		outputTokens: value.outputTokens ?? 0,
		inputCost: value.inputCost ?? 0,
		cacheReadCost: value.cacheReadCost ?? 0,
		cacheWriteCost: value.cacheWriteCost ?? 0,
		outputCost: value.outputCost ?? 0,
		cost: value.cost ?? 0,
		cacheRate: value.cacheRate ?? 0,
		model: value.model ?? null,
		provider: value.provider ?? null,
		periodName: value.periodName ?? null,
		groupId: value.groupId ?? null,
		groupName: value.groupName ?? null,
		contextMultiplier: value.contextMultiplier,
		contextAfterTokens: value.contextAfterTokens ?? null,
		rates: value.rates ?? null
	};
}
/** Flatten each session's own hourly buckets; parent rows do not include child sessions. */
function flattenHourlyEntries(rows) {
	const entries = [];
	for (const row of rows) for (const hourly of row.cost.hourly ?? []) {
		const entry = asHourlySlice(hourly);
		if (entry === null) continue;
		entries.push({
			sessionId: row.sessionId,
			origin: row.origin,
			parentSession: row.parentSession,
			entry
		});
	}
	return entries;
}
function filterHourlyEntries(entries, filter) {
	const sessionId = filter.sessionId.trim().toLowerCase();
	return entries.filter((item) => {
		if (filter.date && localDateOfHour(item.entry.hour) !== filter.date) return false;
		if (filter.hour && item.entry.hour !== filter.hour && item.entry.hourLabel !== filter.hour) return false;
		if (sessionId && !item.sessionId.toLowerCase().includes(sessionId)) return false;
		if (filter.origin && (item.origin ?? "") !== filter.origin) return false;
		const route = hourlyRoute(item.entry);
		if (filter.route && route !== filter.route) return false;
		return true;
	});
}
function sumHourlySlices(rows, hour = "", hourLabel = "") {
	const out = emptyHourlySlice(hour, hourLabel);
	for (const row of rows) {
		out.turns += row.turns;
		out.steps += row.steps;
		out.toolCalls += row.toolCalls;
		out.inputTokens += row.inputTokens;
		out.cacheReadTokens += row.cacheReadTokens;
		out.cacheWriteTokens += row.cacheWriteTokens;
		out.outputTokens += row.outputTokens;
		out.inputCost += row.inputCost;
		out.cacheReadCost += row.cacheReadCost;
		out.cacheWriteCost += row.cacheWriteCost;
		out.outputCost += row.outputCost;
		out.cost += row.cost;
	}
	const totalTokens = out.inputTokens + out.cacheReadTokens + out.cacheWriteTokens + out.outputTokens;
	out.cacheRate = totalTokens > 0 ? (out.cacheReadTokens + out.cacheWriteTokens) / totalTokens : 0;
	return out;
}
/** Group flattened hourly entries by time bucket, newest hour last. */
function groupHourlyEntries(entries) {
	const groups = /* @__PURE__ */ new Map();
	for (const item of entries) {
		const existing = groups.get(item.entry.hour);
		if (existing === void 0) {
			groups.set(item.entry.hour, {
				hour: item.entry.hour,
				hourLabel: item.entry.hourLabel,
				sessions: [item],
				totals: emptyHourlySlice(item.entry.hour, item.entry.hourLabel)
			});
			continue;
		}
		existing.sessions.push(item);
	}
	return [...groups.values()].sort((left, right) => left.hour.localeCompare(right.hour)).map((group) => ({
		...group,
		totals: sumHourlySlices(group.sessions.map((item) => item.entry), group.hour, group.hourLabel)
	}));
}
function queryHourlyOverview(rows, filter) {
	return groupHourlyEntries(filterHourlyEntries(flattenHourlyEntries(rows), filter));
}
/** Local calendar date of an epoch millisecond, or the current time when omitted. */
function localTodayDate(now = Date.now()) {
	return localDateOfHour(new Date(now).toISOString());
}
/** Group hourly overview buckets by local date, oldest day first. */
function groupDailyOverview(groups) {
	const days = /* @__PURE__ */ new Map();
	for (const group of groups) {
		const date = localDateOfHour(group.hour);
		const existing = days.get(date);
		if (existing === void 0) days.set(date, [group]);
		else existing.push(group);
	}
	return [...days.entries()].sort((left, right) => left[0].localeCompare(right[0])).map(([date, hours]) => ({
		date,
		hours,
		totals: sumHourlySlices(hours.map((hour) => hour.totals), date, date)
	}));
}
function queryDailyOverview(rows, filter) {
	return groupDailyOverview(queryHourlyOverview(rows, filter));
}
/** Sum independently folded hourly cost, optionally restricted to one local date. */
function overviewCost(rows, date = "") {
	return sumHourlySlices(queryHourlyOverview(rows, {
		date,
		hour: "",
		sessionId: "",
		origin: "",
		route: ""
	}).flatMap((group) => group.sessions.map((item) => item.entry))).cost;
}
/**
* Collapse one or more hourly slices to a single surcharge label.
* Mixed multipliers, including a mix of charged and uncharged requests,
* return null so the UI does not claim the whole group was doubled.
*/
function sharedContextSurcharge(rows) {
	const first = rows[0];
	if (first === void 0) return null;
	const multiplier = first.contextMultiplier ?? 1;
	const afterTokens = first.contextAfterTokens ?? null;
	for (const row of rows) {
		if ((row.contextMultiplier ?? 1) !== multiplier) return null;
		if ((row.contextAfterTokens ?? null) !== afterTokens) return null;
	}
	return {
		afterTokens,
		multiplier
	};
}
const NUMERIC_DISPLAY_COLUMNS = /* @__PURE__ */ new Set([
	"activity",
	"input",
	"cache",
	"output",
	"usage"
]);
function surchargeText(entry) {
	return formatContextSurcharge(entry.contextAfterTokens, entry.contextMultiplier) ?? "";
}
function cellText(row, key) {
	const value = row[key];
	if (value === null || value === void 0) return "";
	return String(value);
}
function rowTotalTokens(row) {
	return row.inputTokens + row.cacheTokens + row.outputTokens;
}
function metricTokens(row, key) {
	if (key === "input") return row.inputTokens;
	if (key === "cache") return row.cacheTokens;
	if (key === "output") return row.outputTokens;
	return rowTotalTokens(row);
}
function metricCost(row, key) {
	if (key === "input") return row.inputCost;
	if (key === "cache") return row.cacheCost;
	if (key === "output") return row.outputCost;
	return row.cost;
}
function averageUnitPrice(cost, tokens, unitTokens) {
	if (!(tokens > 0) || !Number.isFinite(cost) || !Number.isFinite(unitTokens) || unitTokens <= 0) return null;
	return cost / tokens * unitTokens;
}
function formatUsageCell(tokens, cost, unitTokens, _symbol) {
	const tokenText = String(tokens);
	const costText = formatMoneyAmount(cost);
	const avg = averageUnitPrice(cost, tokens, unitTokens);
	return avg === null ? `${tokenText}(${costText})` : `${tokenText}(${costText}/${formatMoneyAmount(avg)})`;
}
function activityText(row) {
	return `${row.turns} 轮 / ${row.steps} 步 / ${row.toolCalls} 工具`;
}
function displayCellText(row, key, unitTokens = 1e6, symbol = "") {
	if (key === "activity") return activityText(row);
	if (key === "input" || key === "cache" || key === "output" || key === "usage") return formatUsageCell(metricTokens(row, key), metricCost(row, key), unitTokens, symbol);
	return cellText(row, key);
}
function displaySortValue(row, key) {
	if (key === "activity") return row.turns;
	if (key === "input") return row.inputCost;
	if (key === "cache") return row.cacheCost;
	if (key === "output") return row.outputCost;
	if (key === "usage") return row.cost;
	return cellText(row, key);
}
/** One table row per independent hourly bucket. Time view labels by date+hour; model view labels by route. */
function flattenCostTableRows(entries, view) {
	return entries.map((item, index) => {
		const route = hourlyRoute(item.entry) ?? "-";
		const date = localDateOfHour(item.entry.hour);
		return {
			id: `${item.sessionId}:${item.entry.hour}:${route}:${item.entry.contextMultiplier ?? 1}:${index}`,
			dimension: view === "model" ? route : `${date} ${item.entry.hourLabel}`,
			date,
			hour: item.entry.hour,
			hourLabel: item.entry.hourLabel,
			sessionId: item.sessionId,
			origin: item.origin ?? "",
			route,
			periodName: item.entry.periodName ?? "",
			surcharge: surchargeText(item.entry),
			turns: item.entry.turns,
			steps: item.entry.steps,
			toolCalls: item.entry.toolCalls,
			inputTokens: item.entry.inputTokens,
			inputCost: item.entry.inputCost,
			cacheTokens: item.entry.cacheReadTokens + item.entry.cacheWriteTokens,
			cacheCost: item.entry.cacheReadCost + item.entry.cacheWriteCost,
			outputTokens: item.entry.outputTokens,
			outputCost: item.entry.outputCost,
			cacheRate: item.entry.cacheRate,
			cost: item.entry.cost,
			inputRate: item.entry.rates?.input ?? null,
			cacheReadRate: item.entry.rates?.cacheRead ?? null,
			cacheWriteRate: item.entry.rates?.cacheWrite ?? null,
			outputRate: item.entry.rates?.output ?? null
		};
	});
}
function formatUnitTokensLabel(unitTokens) {
	if (unitTokens === 1e6) return "每 100 万 Token";
	if (unitTokens === 1e3) return "每 1 千 Token";
	return `每 ${unitTokens.toLocaleString("zh-CN")} Token`;
}
function formatMoneyAmount(value) {
	if (!Number.isFinite(value)) return "0.00";
	const abs = Math.abs(value);
	if (abs > 0 && abs < .01) return value.toFixed(4);
	const two = value.toFixed(2);
	if (Math.abs(value - Number(two)) < 1e-9) return two;
	return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}
const RATE_LABEL = {
	input: "输入基础价",
	cacheRead: "缓存读基础价",
	cacheWrite: "缓存写基础价",
	output: "输出基础价"
};
function formatRatedCost(amount, rate, kind, unitTokens, symbol) {
	const money = `${symbol}${formatMoneyAmount(amount)}`;
	if (rate === null || rate === void 0 || !Number.isFinite(rate)) return money;
	return `${money}（${RATE_LABEL[kind]} ${symbol}${formatMoneyAmount(rate)} / ${formatUnitTokensLabel(unitTokens)}）`;
}
function formatCacheRatedCost(amount, cacheReadRate, cacheWriteRate, unitTokens, symbol) {
	const money = `${symbol}${formatMoneyAmount(amount)}`;
	const unit = formatUnitTokensLabel(unitTokens);
	const read = cacheReadRate !== null && cacheReadRate !== void 0 && Number.isFinite(cacheReadRate) ? `缓存读基础价 ${symbol}${formatMoneyAmount(cacheReadRate)} / ${unit}` : "";
	const write = cacheWriteRate !== null && cacheWriteRate !== void 0 && Number.isFinite(cacheWriteRate) ? `缓存写基础价 ${symbol}${formatMoneyAmount(cacheWriteRate)} / ${unit}` : "";
	if (read !== "" && write !== "" && cacheReadRate === cacheWriteRate) return `${money}（缓存基础价 ${symbol}${formatMoneyAmount(cacheReadRate)} / ${unit}）`;
	if (read !== "" && write !== "") return `${money}（${read}；${write}）`;
	if (read !== "") return `${money}（${read}）`;
	if (write !== "") return `${money}（${write}）`;
	return money;
}
const PARENT_OPTIONAL_COLUMNS = [
	"route",
	"activity",
	"input",
	"cache",
	"output"
];
const CHILD_OPTIONAL_COLUMNS = [
	"sessionId",
	"origin",
	"route",
	"surcharge",
	"periodName",
	"activity",
	"input",
	"cache",
	"output"
];
function optionalCostTableColumns(level = "parent") {
	return level === "child" ? CHILD_OPTIONAL_COLUMNS : PARENT_OPTIONAL_COLUMNS;
}
function defaultVisibleCostColumns(view, level = "parent") {
	return (level === "child" ? CHILD_OPTIONAL_COLUMNS : PARENT_OPTIONAL_COLUMNS).filter((key) => (level === "parent" && view === "model" ? key !== "route" : true) && (level === "child" && view === "model" ? key !== "route" : true));
}
function resolveVisibleCostColumns(view, selected, level = "parent") {
	const allowed = new Set(optionalCostTableColumns(level));
	return [
		"dimension",
		...selected.filter((key) => allowed.has(key) && (view !== "model" || key !== "route")),
		"usage"
	];
}
function filterCostTableRows(rows, filter, unitTokens = 1e6, symbol = "") {
	return rows.filter((row) => {
		for (const [key, raw] of Object.entries(filter)) {
			if (raw === void 0) continue;
			const needle = raw.trim().toLowerCase();
			if (needle === "") continue;
			if (!displayCellText(row, key, unitTokens, symbol).toLowerCase().includes(needle)) return false;
		}
		return true;
	});
}
function sortCostTableRows(rows, sort) {
	const direction = sort.dir === "asc" ? 1 : -1;
	return [...rows].sort((left, right) => {
		const leftValue = displaySortValue(left, sort.key);
		const rightValue = displaySortValue(right, sort.key);
		const compared = typeof leftValue === "number" && typeof rightValue === "number" ? leftValue - rightValue : String(leftValue).localeCompare(String(rightValue), "zh-CN");
		return compared === 0 ? left.id.localeCompare(right.id) : compared * direction;
	});
}
function queryCostTable(entries, view, filter, sort) {
	return sortCostTableRows(filterCostTableRows(flattenCostTableRows(entries, view), filter), sort);
}
function uniqueText(values) {
	const unique = [...new Set(values.filter((value) => value !== ""))];
	return unique.length === 1 ? unique[0] : "";
}
function uniqueRate(values) {
	const unique = [...new Set(values.filter((value) => value !== null))];
	return unique.length === 1 ? unique[0] : null;
}
function summarizeCostGroup(id, dimension, children) {
	const totals = costTableTotals(children);
	return {
		id,
		dimension,
		date: uniqueText(children.map((row) => row.date)),
		hour: uniqueText(children.map((row) => row.hour)),
		hourLabel: uniqueText(children.map((row) => row.hourLabel)),
		sessionId: uniqueText(children.map((row) => row.sessionId)),
		origin: uniqueText(children.map((row) => row.origin)),
		route: uniqueText(children.map((row) => row.route)),
		periodName: uniqueText(children.map((row) => row.periodName)),
		surcharge: uniqueText(children.map((row) => row.surcharge)),
		...totals,
		inputRate: uniqueRate(children.map((row) => row.inputRate)),
		cacheReadRate: uniqueRate(children.map((row) => row.cacheReadRate)),
		cacheWriteRate: uniqueRate(children.map((row) => row.cacheWriteRate)),
		outputRate: uniqueRate(children.map((row) => row.outputRate))
	};
}
/** Collapse filtered hourly rows into one date or model summary with expandable children. */
function groupCostTableRows(rows, view) {
	const buckets = /* @__PURE__ */ new Map();
	for (const row of rows) {
		const key = view === "model" ? row.route : row.date;
		const list = buckets.get(key);
		if (list === void 0) buckets.set(key, [row]);
		else list.push(row);
	}
	return [...buckets.entries()].map(([key, children]) => {
		const dimension = key === "" ? "-" : key;
		const id = `${view}:${dimension}`;
		return {
			id,
			summary: summarizeCostGroup(id, dimension, children),
			children: children.map((child) => ({
				...child,
				dimension: view === "model" ? `${child.date} ${child.hourLabel}` : child.hourLabel
			}))
		};
	});
}
function defaultChildCostTableSort(_view) {
	return {
		key: "dimension",
		dir: "asc"
	};
}
/** Filter hourly details, then group and sort summaries for the expandable table. */
function queryCostTableGroups(entries, view, filter, sort, childFilter = {}, childSort = defaultChildCostTableSort(view), unitTokens = 1e6, symbol = "") {
	const groups = groupCostTableRows(filterCostTableRows(flattenCostTableRows(entries, view), filter, unitTokens, symbol), view);
	const order = new Map(groups.map((group) => [group.summary.id, group]));
	return sortCostTableRows(groups.map((group) => group.summary), sort).flatMap((summary) => {
		const group = order.get(summary.id);
		if (group === void 0) return [];
		const children = sortCostTableRows(filterCostTableRows(group.children, childFilter, unitTokens, symbol), childSort);
		return [{
			...group,
			children
		}];
	});
}
function costTableColumnValues(rows, key, unitTokens = 1e6, symbol = "") {
	return [...new Set(rows.map((row) => displayCellText(row, key, unitTokens, symbol)).filter((value) => value !== ""))].sort((left, right) => left.localeCompare(right, "zh-CN"));
}
function toggleCostTableSort(current, key) {
	if (current.key === key) return {
		key,
		dir: current.dir === "asc" ? "desc" : "asc"
	};
	return {
		key,
		dir: NUMERIC_DISPLAY_COLUMNS.has(key) ? "desc" : "asc"
	};
}
function defaultCostTableSort(view) {
	return {
		key: "dimension",
		dir: view === "model" ? "asc" : "desc"
	};
}
function isNumericCostTableColumn(key) {
	return NUMERIC_DISPLAY_COLUMNS.has(key);
}
function costTableTotals(rows) {
	const out = {
		turns: 0,
		steps: 0,
		toolCalls: 0,
		inputTokens: 0,
		inputCost: 0,
		cacheTokens: 0,
		cacheCost: 0,
		outputTokens: 0,
		outputCost: 0,
		cacheRate: 0,
		cost: 0
	};
	for (const row of rows) {
		out.turns += row.turns;
		out.steps += row.steps;
		out.toolCalls += row.toolCalls;
		out.inputTokens += row.inputTokens;
		out.inputCost += row.inputCost;
		out.cacheTokens += row.cacheTokens;
		out.cacheCost += row.cacheCost;
		out.outputTokens += row.outputTokens;
		out.outputCost += row.outputCost;
		out.cost += row.cost;
	}
	const totalTokens = out.inputTokens + out.cacheTokens + out.outputTokens;
	out.cacheRate = totalTokens > 0 ? out.cacheTokens / totalTokens : 0;
	return out;
}
//#endregion
//#region src/provider-balance.ts
/** Live per-provider wallet/quota remaining from Sub2API-compatible `/v1/usage`. */
const REQUEST_TIMEOUT_MS$1 = 1e4;
const MAX_RESPONSE_BYTES$1 = 65536;
const DEFAULT_CONCURRENCY = 4;
/** Build a `/v1/{leaf}` endpoint without duplicating `/v1`. */
function v1URL(baseURL, leaf) {
	const url = new URL(baseURL);
	const path = url.pathname.replace(/\/+$/, "");
	url.pathname = `${path.endsWith("/v1") ? path : `${path}/v1`}/${leaf}`.replace(/\/{2,}/g, "/");
	return url.toString();
}
/** Build the key-scoped usage endpoint without duplicating `/v1`. */
function usageURL(baseURL) {
	return v1URL(baseURL, "usage");
}
/** Build the provider-level models endpoint without duplicating `/v1`. */
function modelsURL(baseURL) {
	return v1URL(baseURL, "models");
}
/** True when the provider API is down and that same credential still has remaining funds. */
function shouldRemoveUnavailableProvider(available, remaining) {
	return available === false && remaining !== null && remaining > 0;
}
/** Pricing routes owned by one provider id. */
function routesForProvider(models, provider) {
	const prefix = `${provider}/`;
	return Object.keys(models).filter((key) => key.startsWith(prefix));
}
/** Origin used to collapse providers that share a gateway host. */
function gatewayOrigin(baseURL) {
	try {
		const url = new URL(baseURL);
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		return url.origin;
	} catch {
		return null;
	}
}
function finiteNumber(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function firstFinite(...values) {
	for (const value of values) {
		const parsed = finiteNumber(value);
		if (parsed !== void 0) return parsed;
	}
}
/**
* Read remaining funds from a Sub2API `/v1/usage` body.
* Wallet mode exposes `balance`; quota and subscription modes expose `remaining`.
*/
function parseProviderBalance(value) {
	if (value === null || typeof value !== "object") throw new Error("invalid usage response");
	const body = value;
	const quota = body.quota !== null && typeof body.quota === "object" ? body.quota : void 0;
	const remaining = firstFinite(body.balance, body.remaining, quota?.remaining);
	if (remaining === void 0) throw new Error("usage response has no remaining balance");
	return {
		remaining,
		unit: typeof body.unit === "string" && body.unit !== "" ? body.unit : typeof quota?.unit === "string" && quota.unit !== "" ? quota.unit : "USD",
		mode: typeof body.mode === "string" ? body.mode : null
	};
}
/** One target per provider id that has a base URL and credential. */
function listProviderBalanceTargets(providers) {
	const out = [];
	for (const [id, source] of Object.entries(providers ?? {})) {
		if (id.trim() === "" || source.baseURL === void 0 || source.apiKeyEnv === void 0 || source.apiKeyEnv === "") continue;
		if (gatewayOrigin(source.baseURL) === null) continue;
		const name = typeof source.displayName === "string" && source.displayName.trim() !== "" ? source.displayName.trim() : id;
		out.push({
			provider: id,
			name,
			baseURL: source.baseURL,
			apiKeyEnv: source.apiKeyEnv
		});
	}
	return out.sort((a, b) => a.provider.localeCompare(b.provider));
}
/** Collapse configured providers onto one probe group per gateway origin. */
function groupProviderBalanceTargetsByOrigin(targets) {
	const groups = /* @__PURE__ */ new Map();
	for (const target of targets) {
		const origin = gatewayOrigin(target.baseURL);
		if (origin === null) continue;
		const list = groups.get(origin);
		if (list === void 0) groups.set(origin, [target]);
		else list.push(target);
	}
	return [...groups.entries()].sort((left, right) => left[0].localeCompare(right[0])).map(([origin, grouped]) => ({
		origin,
		targets: grouped
	}));
}
async function readBoundedJson$1(response) {
	const reader = response.body?.getReader();
	if (reader === void 0) return response.json();
	const chunks = [];
	let total = 0;
	while (true) {
		const next = await reader.read();
		if (next.done) break;
		total += next.value.byteLength;
		if (total > MAX_RESPONSE_BYTES$1) {
			await reader.cancel();
			throw new Error("usage response exceeds 64 KiB");
		}
		chunks.push(next.value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return JSON.parse(new TextDecoder().decode(bytes));
}
/** Remaining balance for one provider credential. Failures keep `remaining: null`. */
async function probeProviderBalance(target, credentials, fetchImpl = fetch, now = Date.now) {
	const observedAt = now();
	const failed = (error) => ({
		provider: target.provider,
		name: target.name,
		origin: gatewayOrigin(target.baseURL) ?? target.baseURL,
		remaining: null,
		unit: "USD",
		mode: null,
		error,
		observedAt
	});
	const credential = await credentials?.resolve(target.apiKeyEnv);
	if (credential === void 0 || credential.value === "") return failed(`credential ${target.apiKeyEnv} is unavailable`);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS$1);
	try {
		const response = await fetchImpl(usageURL(target.baseURL), {
			method: "GET",
			headers: {
				accept: "application/json",
				authorization: `Bearer ${credential.value}`
			},
			redirect: "error",
			signal: controller.signal
		});
		if (!response.ok) return failed(`HTTP ${response.status}`);
		const parsed = parseProviderBalance(await readBoundedJson$1(response));
		const origin = gatewayOrigin(target.baseURL) ?? target.baseURL;
		return {
			provider: target.provider,
			name: new URL(origin).host,
			origin,
			remaining: parsed.remaining,
			unit: parsed.unit,
			mode: parsed.mode,
			observedAt: now()
		};
	} catch (error) {
		return failed(error instanceof Error ? error.message : String(error));
	} finally {
		clearTimeout(timeout);
	}
}
/** Provider-level `/v1/models` availability for one credential. */
async function probeProviderAvailability(target, credentials, fetchImpl = fetch) {
	const credential = await credentials?.resolve(target.apiKeyEnv);
	if (credential === void 0 || credential.value === "") return {
		provider: target.provider,
		available: false,
		error: `credential ${target.apiKeyEnv} is unavailable`
	};
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS$1);
	try {
		const response = await fetchImpl(modelsURL(target.baseURL), {
			method: "GET",
			headers: {
				accept: "application/json",
				authorization: `Bearer ${credential.value}`
			},
			redirect: "error",
			signal: controller.signal
		});
		if (response.ok) return {
			provider: target.provider,
			available: true
		};
		return {
			provider: target.provider,
			available: false,
			error: `HTTP ${response.status}`
		};
	} catch (error) {
		return {
			provider: target.provider,
			available: false,
			error: error instanceof Error ? error.message : String(error)
		};
	} finally {
		clearTimeout(timeout);
	}
}
function succeeded(row) {
	return row.remaining !== null && row.error === void 0;
}
function gatewayHost(origin) {
	try {
		return new URL(origin).host;
	} catch {
		return origin;
	}
}
/** True when `origin` is an http(s) wallet URL that can be opened. */
function walletHref(origin) {
	if (origin === void 0 || origin === "") return void 0;
	try {
		const url = new URL(origin);
		if (url.protocol !== "http:" && url.protocol !== "https:") return void 0;
		return url.origin;
	} catch {
		return;
	}
}
/**
* One chip per gateway origin. Failed probes and rows without an openable
* origin are dropped so a chip never appears without a host and href.
*/
function collapseBalanceChips(rows) {
	const order = [];
	const byOrigin = /* @__PURE__ */ new Map();
	for (const row of rows) {
		if (!succeeded(row)) continue;
		const origin = walletHref(row.origin);
		if (origin === void 0 || byOrigin.has(origin)) continue;
		order.push(origin);
		byOrigin.set(origin, {
			...row,
			origin,
			name: gatewayHost(origin)
		});
	}
	return order.map((origin) => byOrigin.get(origin));
}
/** Fetch remaining balance once per gateway origin. Failed origins are omitted. */
async function collectProviderBalances(input) {
	const groups = groupProviderBalanceTargetsByOrigin(listProviderBalanceTargets(input.providers));
	if (groups.length === 0) return [];
	const fetchImpl = input.fetchImpl ?? fetch;
	const now = input.now ?? Date.now;
	const rows = await mapWithConcurrency(groups, input.concurrency ?? DEFAULT_CONCURRENCY, async (group) => {
		for (const target of group.targets) {
			const row = await probeProviderBalance(target, input.credentials, fetchImpl, now);
			if (succeeded(row)) return {
				...row,
				origin: group.origin,
				name: new URL(group.origin).host
			};
		}
		return null;
	});
	const out = [];
	for (const row of rows) if (row !== null) out.push(row);
	return out;
}
//#endregion
//#region src/usage-tap.ts
/**
* Read `reasoning_tokens` from an OpenAI-compat usage object.
* Wanzhao grok keeps this disjoint from `completion_tokens`.
* @param usage Wire `usage` object, or undefined when the chunk has none.
* @returns A positive reasoning count, or 0 when the field is absent.
*/
function reasoningFromWireUsage(usage) {
	if (usage === null || typeof usage !== "object") return 0;
	const raw = usage;
	const completionDetails = object(raw.completion_tokens_details);
	const outputDetails = object(raw.output_tokens_details);
	for (const value of [
		raw.reasoning_tokens,
		completionDetails.reasoning_tokens,
		outputDetails.reasoning_tokens
	]) if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
	return 0;
}
/**
* Record reasoning from one wire usage object onto the in-flight tap slot.
* @param slot Request-local slot created around one `llm.stream` call.
* @param usage Wire `usage` object.
*/
function applyWireUsage(slot, usage) {
	const reasoning = reasoningFromWireUsage(usage);
	if (reasoning > 0) slot.reasoningTokens = reasoning;
}
/**
* Scan an SSE buffer for `data:` frames that carry `usage`.
* Incomplete trailing JSON is ignored until more bytes arrive.
* @param buffer Decoded SSE text received so far.
* @param slot Request-local slot to update.
*/
function scanSseBuffer(buffer, slot) {
	for (const line of buffer.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("data:")) continue;
		const data = trimmed.slice(5).trim();
		if (data === "" || data === "[DONE]") continue;
		try {
			const payload = JSON.parse(data);
			if (payload.usage !== void 0) applyWireUsage(slot, payload.usage);
		} catch {}
	}
}
/**
* Attach captured reasoning onto a harness usage chunk if the adapter omitted it.
* @param chunk One value yielded by `llm.stream`.
* @param reasoningTokens Captured gateway reasoning count.
* @returns The original chunk, or a shallow copy with `usage.reasoningTokens`.
*/
function attachReasoningToChunk(chunk, reasoningTokens) {
	if (reasoningTokens === void 0 || reasoningTokens <= 0) return chunk;
	if (chunk === null || typeof chunk !== "object") return chunk;
	const typed = chunk;
	if (typed.type !== "usage" || typed.usage === null || typeof typed.usage !== "object") return chunk;
	const usage = typed.usage;
	if (typeof usage.reasoningTokens === "number" && usage.reasoningTokens > 0) return chunk;
	return {
		...typed,
		usage: {
			...usage,
			reasoningTokens
		}
	};
}
/**
* @param input `fetch` input (URL string, URL, or Request).
* @returns Whether this request is an OpenAI-compat completion/response call.
*/
function shouldTapRequest(input) {
	const url = requestUrl(input);
	return url.includes("/chat/completions") || url.includes("/responses");
}
/**
* Pass upstream bytes through unchanged while parsing usage on the same chunks.
* Reasoning is written to `slot` before the official client sees those bytes.
* @param response Upstream `fetch` response. The body is consumed via a wrapper.
* @param slot Request-local slot to update.
* @returns A response with identical status, headers, and body bytes.
*/
function tapFetchResponse(response, slot) {
	if (response.body === null) return response;
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const stream = new ReadableStream({
		async pull(controller) {
			const { done, value } = await reader.read();
			if (done) {
				buffer += decoder.decode();
				ingestBuffer(buffer, slot);
				controller.close();
				return;
			}
			buffer += decoder.decode(value, { stream: true });
			ingestBuffer(buffer, slot);
			controller.enqueue(value);
		},
		cancel(reason) {
			return reader.cancel(reason);
		}
	});
	return new Response(stream, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers
	});
}
/**
* Wrap `globalThis.fetch` so in-flight `llm.stream` calls can see gateway usage.
* Responses outside an active tap slot, or to other URLs, pass through untouched.
* @param slots Active stream slots. Async generators drop AsyncLocalStorage
*   across `await`, so the fetch tap reads this stack, not ALS alone.
* @returns Disposer that restores the previous `fetch`.
*/
function installFetchTap(slots) {
	const original = globalThis.fetch;
	if (typeof original !== "function") return () => {};
	const tapped = async (input, init) => {
		const response = await original(input, init);
		const store = slots.at(-1);
		if (store === void 0 || !shouldTapRequest(input)) return response;
		return tapFetchResponse(response, store);
	};
	globalThis.fetch = tapped;
	return () => {
		if (globalThis.fetch === tapped) globalThis.fetch = original;
	};
}
function popSlot(slots, store) {
	const index = slots.lastIndexOf(store);
	if (index >= 0) slots.splice(index, 1);
}
/**
* Wrap `llm.stream` so each call has a tap slot and usage chunks carry reasoning.
* The slot stays on the stack until the iterator settles so `fetch` inside an
* async generator still sees it. AsyncLocalStorage does not survive that hop.
* @param stream Original `llm.stream` bound to the service.
* @param slots Active stream slots read by the fetch tap.
* @returns A replacement `stream` with the same call signature.
*/
function wrapLlmStream(stream, slots) {
	return (options) => {
		const store = {};
		slots.push(store);
		let released = false;
		const release = () => {
			if (released) return;
			released = true;
			popSlot(slots, store);
		};
		let inner;
		try {
			inner = stream(options);
		} catch (error) {
			release();
			throw error;
		}
		return { [Symbol.asyncIterator]() {
			const iterator = inner[Symbol.asyncIterator]();
			return {
				next: async () => {
					try {
						const result = await iterator.next();
						if (result.done) {
							release();
							return result;
						}
						return {
							done: false,
							value: attachReasoningToChunk(result.value, store.reasoningTokens)
						};
					} catch (error) {
						release();
						throw error;
					}
				},
				return: async (value) => {
					try {
						return await (iterator.return?.(value) ?? Promise.resolve({
							done: true,
							value
						}));
					} finally {
						release();
					}
				},
				throw: async (error) => {
					try {
						return await (iterator.throw?.(error) ?? Promise.reject(error));
					} finally {
						release();
					}
				}
			};
		} };
	};
}
/**
* Wrap `llm.prepareCall` so the one-shot stream the agent loop actually
* iterates also carries the fetch-tap slot. `preparedCall.stream` bypasses
* `llm.stream`; wrapping only the latter leaves grok reasoning off the log.
* @param prepareCall Original `llm.prepareCall` bound to the service.
* @param slots Active stream slots read by the fetch tap.
* @returns A replacement `prepareCall` that taps the returned stream.
*/
function wrapPrepareCall(prepareCall, slots) {
	return async (config, signal) => {
		const prepared = await prepareCall(config, signal);
		if (prepared === null || typeof prepared !== "object" || typeof prepared.stream !== "function") return prepared;
		return {
			...prepared,
			stream: wrapLlmStream(prepared.stream.bind(prepared), slots)
		};
	};
}
/**
* Install the fetch tap and wrap `ctx.llm.stream` plus `ctx.llm.prepareCall`.
* The agent loop dispatches through `preparedCall.stream`; title and
* compaction still use `llm.stream`. Both must enter the same tap slot.
* @param ctx Host context. `llm` is optional so tests without it still load.
* @returns Disposer that unwraps fetch, `llm.stream`, and `llm.prepareCall`.
*/
function installUsageTap(ctx) {
	const slots = [];
	const restoreFetch = installFetchTap(slots);
	let restoreLlm = () => {};
	ctx.inject(["llm"], (inner) => {
		const llm = inner.llm;
		if (llm === void 0) return;
		const restorers = [];
		if (typeof llm.stream === "function") {
			const original = llm.stream;
			llm.stream = wrapLlmStream(original.bind(llm), slots);
			restorers.push(() => {
				llm.stream = original;
			});
		}
		if (typeof llm.prepareCall === "function") {
			const original = llm.prepareCall;
			llm.prepareCall = wrapPrepareCall(original.bind(llm), slots);
			restorers.push(() => {
				llm.prepareCall = original;
			});
		}
		restoreLlm = () => {
			for (const restore of restorers) restore();
		};
	});
	return () => {
		restoreLlm();
		restoreFetch();
	};
}
function object(value) {
	return value !== null && typeof value === "object" ? value : {};
}
function requestUrl(input) {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.href;
	if (input !== null && typeof input === "object" && "url" in input) return String(input.url);
	return "";
}
function ingestBuffer(buffer, slot) {
	scanSseBuffer(buffer, slot);
	const trimmed = buffer.trim();
	if (!trimmed.startsWith("{")) return;
	try {
		applyWireUsage(slot, JSON.parse(trimmed).usage);
	} catch {}
}
//#endregion
//#region src/upstream-billing-probe.ts
const REQUEST_TIMEOUT_MS = 1e4;
const MAX_RESPONSE_BYTES = 65536;
const MAX_SYNC_MULTIPLIER = 100;
const BASELINE_EFFECTIVE_AT = 0;
/** Build the Sub2API key-billing endpoint without duplicating `/v1`. */
function billingProbeURL(baseURL) {
	const url = new URL(baseURL);
	const path = url.pathname.replace(/\/+$/, "");
	url.pathname = `${path.endsWith("/v1") ? path : `${path}/v1`}/sub2api/billing`.replace(/\/{2,}/g, "/");
	return url.toString();
}
function finiteNonNegative(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
/** Validate the declared key-level base multiplier returned by a Sub2API upstream. */
function parseBillingMultiplier(value) {
	if (value === null || typeof value !== "object") throw new Error("invalid billing response");
	const body = value;
	if (body.object !== "sub2api.key_billing" || body.schema_version !== 1 || body.billing_scope !== "token") throw new Error("unsupported billing response schema");
	if (!finiteNonNegative(body.group_rate_multiplier) || !finiteNonNegative(body.resolved_rate_multiplier) || typeof body.peak_rate_enabled !== "boolean" || !finiteNonNegative(body.effective_rate_multiplier)) throw new Error("incomplete billing response");
	const expected = body.user_rate_multiplier === void 0 ? body.group_rate_multiplier : body.user_rate_multiplier;
	if (!finiteNonNegative(expected) || Math.abs(body.resolved_rate_multiplier - expected) > Math.max(1, expected) * 1e-9) throw new Error("inconsistent resolved billing multiplier");
	if (body.resolved_rate_multiplier <= 0 || body.resolved_rate_multiplier > MAX_SYNC_MULTIPLIER) throw new Error(`declared multiplier must be greater than 0 and at most ${MAX_SYNC_MULTIPLIER}`);
	const observedAt = typeof body.observed_at === "string" ? Date.parse(body.observed_at) : NaN;
	return {
		multiplier: body.resolved_rate_multiplier,
		observedAt: Number.isFinite(observedAt) ? observedAt : void 0
	};
}
/** Record the latest successful probe time; change the live multiplier only when it differs. */
function assignmentWithObservedMultiplier(assignment, multiplier, observedAt) {
	const history = [...assignment.discountMultiplierHistory ?? []];
	if (history.length === 0) history.push({
		effectiveAt: BASELINE_EFFECTIVE_AT,
		discountMultiplier: multiplierOrOne(assignment.discountMultiplier)
	});
	const changed = (history[history.length - 1]?.discountMultiplier ?? multiplierOrOne(assignment.discountMultiplier)) !== multiplier;
	if (changed) history.push({
		effectiveAt: Math.max(observedAt, (history[history.length - 1]?.effectiveAt ?? -1) + 1),
		discountMultiplier: multiplier,
		source: "probe"
	});
	return {
		...assignment,
		discountMultiplier: changed ? multiplier : assignment.discountMultiplier,
		discountMultiplierHistory: history,
		lastProbedAt: Math.max(observedAt, assignment.lastProbedAt ?? 0)
	};
}
async function readBoundedJson(response) {
	const reader = response.body?.getReader();
	if (reader === void 0) return response.json();
	const chunks = [];
	let total = 0;
	while (true) {
		const next = await reader.read();
		if (next.done) break;
		total += next.value.byteLength;
		if (total > MAX_RESPONSE_BYTES) {
			await reader.cancel();
			throw new Error("billing response exceeds 64 KiB");
		}
		chunks.push(next.value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return JSON.parse(new TextDecoder().decode(bytes));
}
/** Successful and unsupported endpoints wait `intervalMinutes`; failed probes retry on the next tick. */
function nextBillingProbeDue(now, intervalMinutes, status) {
	if (status === "ok" || status === "unsupported") return now + Math.max(1, intervalMinutes) * 6e4;
	return now + 6e4;
}
async function probe(baseURL, apiKeyEnv, credentials) {
	const credential = await credentials?.resolve(apiKeyEnv);
	if (credential === void 0 || credential.value === "") return {
		status: "failed",
		error: `credential ${apiKeyEnv} is unavailable`
	};
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(billingProbeURL(baseURL), {
			method: "GET",
			headers: {
				accept: "application/json",
				authorization: `Bearer ${credential.value}`
			},
			redirect: "error",
			signal: controller.signal
		});
		if (response.status === 404 || response.status === 405) return {
			status: "unsupported",
			error: `HTTP ${response.status}`
		};
		if (!response.ok) return {
			status: "failed",
			error: `HTTP ${response.status}`
		};
		const parsed = parseBillingMultiplier(await readBoundedJson(response));
		return {
			status: "ok",
			multiplier: parsed.multiplier,
			observedAt: parsed.observedAt
		};
	} catch (error) {
		return {
			status: "failed",
			error: error instanceof Error ? error.message : String(error)
		};
	} finally {
		clearTimeout(timeout);
	}
}
/** Install one process-local runner; settings persist multiplier history across restarts. */
function installUpstreamBillingProbes(ctx, scope) {
	const due = /* @__PURE__ */ new Map();
	let disposed = false;
	let timer;
	let running = false;
	const schedule = (delay = 1e3) => {
		if (!disposed) {
			if (timer !== void 0) clearTimeout(timer);
			timer = setTimeout(() => {
				run();
			}, delay);
		}
	};
	const run = async () => {
		if (disposed || running) return;
		running = true;
		try {
			const billing = normalizePricing(scope.get()).billingProbe;
			if (billing?.enabled !== true) return;
			const credentials = ctx.get("credentials");
			const settings = ctx.get("settings");
			const providers = (settings?.get("llm-pi-ai"))?.providers ?? {};
			const now = Date.now();
			const allowed = billing.providers === void 0 ? void 0 : new Set(billing.providers);
			const results = await mapWithConcurrency(listProviderBalanceTargets(providers).filter((target) => allowed === void 0 || allowed.has(target.provider)).filter((target) => (due.get(target.provider) ?? 0) <= now), billing.concurrency ?? 2, async (target) => {
				const [availability, usage, result] = await Promise.all([
					probeProviderAvailability(target, credentials),
					probeProviderBalance(target, credentials),
					probe(target.baseURL, target.apiKeyEnv, credentials)
				]);
				return {
					target,
					availability,
					usage,
					result
				};
			});
			if (disposed) return;
			const patched = {};
			const latest = normalizePricing(scope.get());
			const removedProviders = [];
			for (const item of results) {
				if (item === null) continue;
				due.set(item.target.provider, nextBillingProbeDue(Date.now(), billing.intervalMinutes ?? 30, item.result.status));
				if (shouldRemoveUnavailableProvider(item.availability.available, item.usage.remaining)) {
					removedProviders.push(item.target.provider);
					ctx.logger?.warn?.("cost-meter removing unavailable provider %s with remaining %s", item.target.provider, String(item.usage.remaining));
					continue;
				}
				if (item.result.status !== "ok" || item.result.multiplier === void 0) {
					ctx.logger?.warn?.("cost-meter billing probe %s: %s", item.target.provider, item.result.error ?? item.result.status);
					continue;
				}
				for (const [route, assignment] of Object.entries(latest.models)) if (route.startsWith(`${item.target.provider}/`)) patched[route] = assignmentWithObservedMultiplier(assignment, item.result.multiplier, item.result.observedAt ?? Date.now());
			}
			if (removedProviders.length > 0 && settings?.mutate !== void 0) {
				const unique = [...new Set(removedProviders)];
				for (const provider of unique) for (const route of Object.keys(patched)) if (route.startsWith(`${provider}/`)) delete patched[route];
				const current = normalizePricing(scope.get());
				const modelOps = unique.flatMap((provider) => routesForProvider(current.models, provider).map((route) => ({
					op: "unset",
					path: ["models", route]
				})));
				if (modelOps.length > 0) await settings.mutate("cost-meter", modelOps);
				await settings.mutate("llm-pi-ai", unique.map((provider) => ({
					op: "unset",
					path: ["providers", provider]
				})));
			}
			if (Object.keys(patched).length > 0) await scope.update({ models: patched });
		} finally {
			running = false;
			schedule(6e4);
		}
	};
	const unwatch = scope.watch(() => schedule(6e4));
	schedule();
	return () => {
		disposed = true;
		unwatch();
		if (timer !== void 0) clearTimeout(timer);
	};
}
//#endregion
//#region src/index.ts
/**
* Settings schema admits both the current group document and the previous
* default/models document, then stores the normalized group form.
*/
const Config = Schema.transform(Schema.any(), (value) => {
	const normalized = normalizePricing(value ?? {});
	validatePricing(normalized);
	return normalized;
});
const SETTINGS_NS = "cost-meter";
function subagentChildren(records) {
	const children = /* @__PURE__ */ new Map();
	for (const record of records) {
		const parent = record.header.parentSession;
		if (parent === void 0 || record.header.origin !== "subagent") continue;
		const ids = children.get(parent);
		if (ids === void 0) children.set(parent, [record.header.id]);
		else ids.push(record.header.id);
	}
	return children;
}
function resolveEvents(sessionId, sessions, query) {
	const live = sessions?.get(sessionId)?.events;
	if (live !== void 0) return live;
	if (query === void 0) return void 0;
	return query.readSession(sessionId).then((snapshot) => snapshot.events);
}
async function foldOwnSession(sessionId, events, config, store) {
	return store === void 0 ? foldSession(events, config) : store.fold(sessionId, events, config);
}
async function ownFoldFor(sessionId, config, sessions, query, store) {
	const live = sessions?.get(sessionId)?.events;
	if (live === void 0 && store?.peek !== void 0) {
		const cached = store.peek(sessionId, config);
		if (cached !== void 0) return cached;
	}
	const events = live ?? await resolveEvents(sessionId, void 0, query);
	if (events === void 0) return void 0;
	return foldOwnSession(sessionId, events, config, store);
}
async function readSubagentTree(query, children, sessionId, config, seen, sessions, store) {
	const ids = children.get(sessionId) ?? [];
	const rows = [];
	for (const id of ids) {
		if (seen.has(id)) continue;
		seen.add(id);
		const cost = await ownFoldFor(id, config, sessions, query, store);
		if (cost === void 0) continue;
		rows.push({
			...cost,
			sessionId: id,
			children: await readSubagentTree(query, children, id, config, seen, sessions, store)
		});
	}
	return rows;
}
function mergeCostInto(target, cost) {
	target.cost += cost.cost;
	target.inputCost += cost.inputCost;
	target.cacheReadCost += cost.cacheReadCost;
	target.cacheWriteCost += cost.cacheWriteCost;
	target.outputCost += cost.outputCost;
	target.inputTokens += cost.inputTokens;
	target.cacheReadTokens += cost.cacheReadTokens;
	target.cacheWriteTokens += cost.cacheWriteTokens;
	target.outputTokens += cost.outputTokens;
	target.details.push(...cost.details);
}
/**
* Fold every listed session independently.
* @param query Durable session listing/read face, or undefined when the host has none.
* @param config Live pricing used for every session.
* @param store Optional own-fold cache. Hits reuse the previous fold for an unchanged log and pricing.
* @param sessions Optional live session map. Live events take precedence over a durable read.
* @returns Listed sessions in original order, skipping duplicate ids and unreadable logs. A listing failure returns [].
*/
async function collectSessionCosts(query, config, store, sessions) {
	if (query === void 0) return [];
	let records;
	try {
		records = await query.listSessions();
	} catch {
		return [];
	}
	const seen = /* @__PURE__ */ new Set();
	const rows = [];
	for (const record of records) {
		const sessionId = record.header.id;
		if (sessionId === "" || seen.has(sessionId)) continue;
		seen.add(sessionId);
		let cost;
		try {
			cost = await ownFoldFor(sessionId, config, sessions, query, store);
		} catch {
			continue;
		}
		if (cost === void 0) continue;
		rows.push({
			sessionId,
			parentSession: record.header.parentSession ?? null,
			origin: record.header.origin ?? null,
			cost
		});
	}
	store?.retain?.(seen);
	return rows;
}
function mergeCosts(primary, subagents) {
	const out = structuredClone(primary);
	out.subagents = structuredClone([...subagents]);
	const visit = (rows) => {
		for (const row of rows) {
			mergeCostInto(out, row);
			visit(row.children);
		}
	};
	visit(subagents);
	return out;
}
/** Typert Remote service exposing the cumulative cost of one session. */
var CostMeterService = class extends TypertRemoteService {
	static Config = Config;
	static inject = ["settings"];
	folds = new SessionFoldCache();
	inflightCosts = /* @__PURE__ */ new Map();
	inflightOverview;
	constructor(ctx) {
		super(ctx, "costMeter");
		ctx.effect(() => installUsageTap(ctx));
	}
	/** Compute one session's cost together with every descendant subagent session. */
	async sessionCost(sessionId) {
		if (typeof sessionId !== "string" || sessionId.length === 0) return null;
		const pending = this.inflightCosts.get(sessionId);
		if (pending !== void 0) return pending;
		const work = this.computeSessionCost(sessionId).finally(() => {
			if (this.inflightCosts.get(sessionId) === work) this.inflightCosts.delete(sessionId);
		});
		this.inflightCosts.set(sessionId, work);
		return work;
	}
	/** Fold every listed session independently for the all-session overview. */
	async sessionCosts() {
		if (this.inflightOverview !== void 0) return this.inflightOverview;
		const work = this.computeSessionCosts().finally(() => {
			if (this.inflightOverview === work) this.inflightOverview = void 0;
		});
		this.inflightOverview = work;
		return work;
	}
	async computeSessionCost(sessionId) {
		const sessions = this.ctx.get("sessions");
		const query = this.ctx.get("sessionQuery");
		const config = normalizePricing(this.ctx.settings.get(SETTINGS_NS) ?? DEFAULT_PRICING);
		const cost = await ownFoldFor(sessionId, config, sessions, query, this.folds);
		if (cost === void 0) return null;
		if (query === void 0) return cost;
		return mergeCosts(cost, await readSubagentTree(query, subagentChildren(await query.listSessions()), sessionId, config, /* @__PURE__ */ new Set([sessionId]), sessions, this.folds));
	}
	async computeSessionCosts() {
		const query = this.ctx.get("sessionQuery");
		const sessions = this.ctx.get("sessions");
		return collectSessionCosts(query, normalizePricing(this.ctx.settings.get(SETTINGS_NS) ?? DEFAULT_PRICING), this.folds, sessions);
	}
	/** Remaining balance once per gateway origin; failed origins are omitted. */
	async providerBalances() {
		const settings = this.ctx.get("settings");
		const credentials = this.ctx.get("credentials");
		const providers = (settings?.get("llm-pi-ai"))?.providers;
		return collectProviderBalances({
			providers,
			credentials
		});
	}
};
//#endregion
export { localDateOfHour as $, walletHref as A, discountMultiplierAt as At, filterHourlyEntries as B, resolveContextSurcharge as Bt, modelsURL as C, logFingerprint as Ct, routesForProvider as D, assignmentWithManualMultiplier as Dt, probeProviderBalance as E, DEFAULT_PRICING as Et, defaultChildCostTableSort as F, lastUpdatedAt as Ft, formatMoneyAmount as G, flattenCostTableRows as H, resolveReasoningExtra as Ht, defaultCostTableSort as I, multiplierHistoryRows as It, formatUsageCell as J, formatRatedCost as K, defaultVisibleCostColumns as L, normalizePricing as Lt, averageUnitPrice as M, formatContextSurcharge as Mt, costTableColumnValues as N, formatTokenThreshold as Nt, shouldRemoveUnavailableProvider as O, billedOutputTokens as Ot, costTableTotals as P, lastProbeAt as Pt, isNumericCostTableColumn as Q, displayCellText as R, normalizeUsage as Rt, listProviderBalanceTargets as S, SessionFoldCache as St, probeProviderAvailability as T, DEFAULT_GROUP as Tt, flattenHourlyEntries as U, routeKey as Ut, filterSessionRows as V, resolvePricing as Vt, formatCacheRatedCost as W, validatePricing as Wt, groupDailyOverview as X, groupCostTableRows as Y, groupHourlyEntries as Z, wrapPrepareCall as _, sortCostTableRows as _t, billingProbeURL as a, optionalCostTableColumns as at, gatewayOrigin as b, toggleCostTableSort as bt, parseBillingMultiplier as c, queryCostTableGroups as ct, installUsageTap as d, querySessionRows as dt, localTodayDate as et, reasoningFromWireUsage as f, resolveVisibleCostColumns as ft, wrapLlmStream as g, sharedContextSurcharge as gt, tapFetchResponse as h, sessionTotalTokens as ht, assignmentWithObservedMultiplier as i, metricTokens as it, activityText as j, foldSession as jt, usageURL as k, contextTokensOf as kt, applyWireUsage as l, queryDailyOverview as lt, shouldTapRequest as m, sessionRoutes as mt, CostMeterService as n, mergeListedSessionCost as nt, installUpstreamBillingProbes as o, overviewCost as ot, scanSseBuffer as p, rowTotalTokens as pt, formatUnitTokensLabel as q, collectSessionCosts as r, metricCost as rt, nextBillingProbeDue as s, queryCostTable as st, Config as t, mapWithConcurrency as tt, attachReasoningToChunk as u, queryHourlyOverview as ut, collapseBalanceChips as v, sortSessionRows as vt, parseProviderBalance as w, pricingFingerprint as wt, groupProviderBalanceTargetsByOrigin as x, toggleSessionTableSort as xt, collectProviderBalances as y, sumHourlySlices as yt, filterCostTableRows as z, resolveContextMultiplier as zt };
