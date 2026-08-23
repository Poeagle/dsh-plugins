import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
//#region ../../../../../../opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cosmokit/lib/index.js
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
//#region ../../../../../../opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/schemastery/lib/index.mjs
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
const DEFAULT_PRICING = {
	currency: "CNY",
	unitTokens: 1e6,
	timezone: "Asia/Shanghai",
	default: {
		rates: {
			input: 1,
			cacheRead: .02,
			cacheWrite: 1,
			output: 2
		},
		periods: []
	},
	models: {}
};
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const RATE_KEYS = [
	"input",
	"cacheRead",
	"cacheWrite",
	"output"
];
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
function rateValue(...values) {
	return values.find((value) => value !== void 0) ?? 0;
}
function resolvePricing(config, provider, model, time) {
	const minute = localMinute(time, config.timezone);
	const key = routeKey(provider, model);
	const plan = key === null ? void 0 : config.models[key];
	const modelPeriod = activePeriod(plan?.periods, minute);
	const defaultPeriod = activePeriod(config.default.periods, minute);
	const rates = Object.fromEntries(RATE_KEYS.map((rate) => [rate, rateValue(modelPeriod?.rates[rate], plan?.rates?.[rate], defaultPeriod?.rates[rate], config.default.rates[rate])]));
	if (modelPeriod !== void 0) return {
		rates,
		source: "model-period",
		periodName: modelPeriod.name
	};
	if (plan?.rates !== void 0 && RATE_KEYS.some((rate) => plan.rates?.[rate] !== void 0)) return {
		rates,
		source: "model"
	};
	if (defaultPeriod !== void 0) return {
		rates,
		source: "default-period",
		periodName: defaultPeriod.name
	};
	return {
		rates,
		source: "default"
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
* A model list, including `[]`, replaces the default list. Among matching
* tiers (`contextTokens > afterTokens`), the highest threshold wins.
* @param config Live pricing, including optional default and model surcharge lists.
* @param provider Request provider id, or null when unknown.
* @param model Request model id, or null when unknown.
* @param contextTokens Prompt-side token count from `contextTokensOf()`.
* @returns The matching tier, or null when no surcharge applies.
*/
function resolveContextSurcharge(config, provider, model, contextTokens) {
	const key = routeKey(provider, model);
	const tiers = (key === null ? void 0 : config.models[key])?.contextSurcharges ?? config.default.contextSurcharges;
	if (tiers === void 0) return null;
	let matched;
	for (const tier of tiers) {
		if (contextTokens <= tier.afterTokens) continue;
		if (matched === void 0 || tier.afterTokens > matched.afterTokens) matched = tier;
	}
	return matched ?? null;
}
/**
* @param config Live pricing, including optional default and model surcharge lists.
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
* @param afterTokens Threshold that triggered the surcharge, or null when none applied.
* @param multiplier Request-wide cost multiplier.
* @returns A label such as `超过 200K ×2`, or null when the request is uncharged.
*/
function formatContextSurcharge(afterTokens, multiplier) {
	if (multiplier === void 0 || multiplier === null || multiplier === 1) return null;
	if (afterTokens === void 0 || afterTokens === null) return `×${multiplier}`;
	return `超过 ${formatTokenThreshold(afterTokens)} ×${multiplier}`;
}
function assertRates(rates, path, complete) {
	for (const key of RATE_KEYS) {
		const value = rates[key];
		if (value === void 0) {
			if (complete) throw new TypeError(`${path}.${key} is required`);
			continue;
		}
		if (!Number.isFinite(value) || value < 0) throw new TypeError(`${path}.${key} must be a non-negative finite number`);
	}
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
		assertRates(period.rates, `${itemPath}.rates`, false);
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
		if (!Number.isFinite(tier.multiplier) || tier.multiplier < 0) throw new TypeError(`${itemPath}.multiplier must be a non-negative finite number`);
	}
}
function validatePricing(config) {
	if (config.currency.trim() === "" || config.currency.length > 8) throw new TypeError("currency must contain 1-8 characters");
	if (!Number.isSafeInteger(config.unitTokens) || config.unitTokens < 1) throw new TypeError("unitTokens must be a positive safe integer");
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: config.timezone }).format(0);
	} catch {
		throw new TypeError(`timezone "${config.timezone}" is not an IANA time zone`);
	}
	assertRates(config.default.rates, "default.rates", true);
	assertPeriods(config.default.periods, "default.periods");
	assertContextSurcharges(config.default.contextSurcharges, "default.contextSurcharges");
	for (const [key, plan] of Object.entries(config.models)) {
		if (key.trim() === "" || !key.includes("/")) throw new TypeError(`model key "${key}" must be provider/model`);
		if (plan.rates !== void 0) assertRates(plan.rates, `models.${key}.rates`, false);
		assertPeriods(plan.periods, `models.${key}.periods`);
		assertContextSurcharges(plan.contextSurcharges, `models.${key}.contextSurcharges`);
	}
}
function num(value) {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
function firstNumber(...values) {
	for (const value of values) if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
	return 0;
}
function object(value) {
	return value !== null && typeof value === "object" ? value : {};
}
/** Normalize common provider usage responses into DSH's disjoint token buckets. */
function normalizeUsage(raw) {
	const promptDetails = object(raw.prompt_tokens_details);
	const inputDetails = object(raw.input_tokens_details);
	const cacheRead = firstNumber(raw.cacheReadTokens, raw.cache_read_input_tokens, raw.cache_read_tokens, promptDetails.cached_tokens, inputDetails.cached_tokens, raw.prompt_cache_hit_tokens);
	const cacheWrite = firstNumber(raw.cacheWriteTokens, raw.cache_write_input_tokens, raw.cache_write_tokens, raw.cache_creation_input_tokens, raw.cache_creation_tokens, promptDetails.cache_creation_input_tokens, inputDetails.cache_creation_input_tokens);
	const canonicalInput = raw.inputTokens;
	const anthropicInput = raw.input_tokens;
	const promptTotal = firstNumber(raw.prompt_tokens, raw.promptTokens);
	return {
		inputTokens: canonicalInput !== void 0 ? num(canonicalInput) : anthropicInput !== void 0 ? num(anthropicInput) : Math.max(0, promptTotal - cacheRead - cacheWrite),
		cacheReadTokens: cacheRead,
		cacheWriteTokens: cacheWrite,
		outputTokens: firstNumber(raw.outputTokens, raw.output_tokens, raw.completion_tokens)
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
	const out = emptyFold(config);
	let provider = null;
	let model = null;
	let last = null;
	let lastPricing = null;
	let lastHourKey = null;
	const detailMap = /* @__PURE__ */ new Map();
	const detailKey = (p, m, s, pn, multiplier, afterTokens) => `${p ?? ""}|${m ?? ""}|${s}|${pn ?? ""}|${multiplier}|${afterTokens ?? ""}`;
	const ensureDetail = (pricing, multiplier, afterTokens) => {
		const key = detailKey(provider, model, pricing.source, pricing.periodName ?? null, multiplier, afterTokens);
		let detail = detailMap.get(key);
		if (detail === void 0) {
			detail = {
				source: pricing.source,
				periodName: pricing.periodName ?? null,
				provider,
				model,
				rates: { ...pricing.rates },
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
	const hourBucketKey = (hKey, pricing, multiplier, afterTokens) => `${hKey}|${provider ?? ""}|${model ?? ""}|${pricing.source}|${pricing.periodName ?? ""}|${multiplier}|${afterTokens ?? ""}`;
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
			output: normalized.outputTokens
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
			contextMultiplier: bucket.contextMultiplier,
			contextAfterTokens: bucket.contextAfterTokens
		}];
	}).sort((a, b) => a.hour.localeCompare(b.hour) || (a.provider ?? "").localeCompare(b.provider ?? "") || (a.model ?? "").localeCompare(b.model ?? "") || a.contextMultiplier - b.contextMultiplier);
	return out;
}
//#endregion
//#region src/session-fold-cache.ts
/** In-process cache of each session's own fold, keyed by pricing and log fingerprints. */
function stableValue(value) {
	if (Array.isArray(value)) return value.map(stableValue);
	if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
	return value;
}
/** Deterministic fingerprint of the live pricing used to value a fold. */
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
		periodName: null
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
		contextMultiplier: value.contextMultiplier,
		contextAfterTokens: value.contextAfterTokens ?? null
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
//#endregion
//#region src/index.ts
const ratesSchema = Schema.object({
	input: Schema.number().min(0),
	cacheRead: Schema.number().min(0),
	cacheWrite: Schema.number().min(0),
	output: Schema.number().min(0)
});
const periodSchema = Schema.object({
	id: Schema.string().required(),
	name: Schema.string().required(),
	start: Schema.string().required(),
	end: Schema.string().required(),
	rates: ratesSchema
});
const contextSurchargeSchema = Schema.object({
	afterTokens: Schema.number().step(1).min(0),
	multiplier: Schema.number().min(0)
});
const planSchema = Schema.object({
	rates: ratesSchema,
	periods: Schema.array(periodSchema),
	contextSurcharges: Schema.union([Schema.array(contextSurchargeSchema), Schema.const(void 0)])
});
const Config = Schema.object({
	currency: Schema.string().default(DEFAULT_PRICING.currency),
	unitTokens: Schema.number().step(1).min(1).default(DEFAULT_PRICING.unitTokens),
	timezone: Schema.string().default(DEFAULT_PRICING.timezone),
	default: Schema.object({
		rates: Schema.object({
			input: Schema.number().min(0).default(DEFAULT_PRICING.default.rates.input),
			cacheRead: Schema.number().min(0).default(DEFAULT_PRICING.default.rates.cacheRead),
			cacheWrite: Schema.number().min(0).default(DEFAULT_PRICING.default.rates.cacheWrite),
			output: Schema.number().min(0).default(DEFAULT_PRICING.default.rates.output)
		}),
		periods: Schema.array(periodSchema),
		contextSurcharges: Schema.array(contextSurchargeSchema)
	}),
	models: Schema.dict(planSchema).default({})
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
	constructor(ctx) {
		super(ctx, "costMeter");
	}
	/** Compute one session's cost together with every descendant subagent session. */
	async sessionCost(sessionId) {
		if (typeof sessionId !== "string" || sessionId.length === 0) return null;
		const sessions = this.ctx.get("sessions");
		const query = this.ctx.get("sessionQuery");
		const config = this.ctx.settings.get(SETTINGS_NS) ?? DEFAULT_PRICING;
		const cost = await ownFoldFor(sessionId, config, sessions, query, this.folds);
		if (cost === void 0) return null;
		if (query === void 0) return cost;
		return mergeCosts(cost, await readSubagentTree(query, subagentChildren(await query.listSessions()), sessionId, config, /* @__PURE__ */ new Set([sessionId]), sessions, this.folds));
	}
	/** Fold every listed session independently for the all-session overview. */
	async sessionCosts() {
		const query = this.ctx.get("sessionQuery");
		const sessions = this.ctx.get("sessions");
		return collectSessionCosts(query, this.ctx.settings.get(SETTINGS_NS) ?? DEFAULT_PRICING, this.folds, sessions);
	}
};
//#endregion
export { routeKey as A, foldSession as C, resolveContextMultiplier as D, normalizeUsage as E, resolveContextSurcharge as O, contextTokensOf as S, formatTokenThreshold as T, toggleSessionTableSort as _, filterSessionRows as a, pricingFingerprint as b, localDateOfHour as c, queryHourlyOverview as d, querySessionRows as f, sumHourlySlices as g, sortSessionRows as h, filterHourlyEntries as i, validatePricing as j, resolvePricing as k, mapWithConcurrency as l, sessionTotalTokens as m, CostMeterService as n, flattenHourlyEntries as o, sessionRoutes as p, collectSessionCosts as r, groupHourlyEntries as s, Config as t, mergeListedSessionCost as u, SessionFoldCache as v, formatContextSurcharge as w, DEFAULT_PRICING as x, logFingerprint as y };
