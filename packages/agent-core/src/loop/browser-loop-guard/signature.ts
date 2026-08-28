/**
 * @file agent-loop-guard 浏览器版签名工具
 * @description 供 WebView 构建使用，避免 node:crypto / node:util。
 */

const MAX_SERIALIZATION_DEPTH = 100;

export function callSignature(toolName: string, args: unknown): string {
  if (typeof toolName !== "string") {
    throw new TypeError("toolName must be a string.");
  }
  return `${JSON.stringify(toolName)}::${stableStringify(args)}`;
}

const KNOWN_NATIVES = new Set([
  "Object",
  "Array",
  "Date",
  "RegExp",
  "Map",
  "Set",
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
  "ArrayBuffer",
  "DataView",
]);

function trySerializeURL(value: object): string | null {
  try {
    if (value instanceof URL) return value.toString();
  } catch {
    /* ignore */
  }
  return null;
}

function trySerializeURLSearchParams(value: object): string | null {
  try {
    if (value instanceof URLSearchParams) return value.toString();
  } catch {
    /* ignore */
  }
  return null;
}

function findToStringTagDescriptor(prototype: object | null) {
  let current = prototype;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(
      current,
      Symbol.toStringTag,
    );
    if (descriptor) return descriptor;
    current = Object.getPrototypeOf(current);
  }
  return null;
}

function isTypedArray(value: object): value is ArrayLike<number> & { length: number } {
  return ArrayBuffer.isView(value) && !(value instanceof DataView);
}

export function stableStringify(value: unknown): string {
  const seen = new WeakMap<object, number>();
  let nextId = 1;

  function encode(current: unknown, path: string, depth: number): string {
    if (depth > MAX_SERIALIZATION_DEPTH) {
      throw new TypeError(
        `Value at ${path} exceeds the maximum supported nesting depth of ${MAX_SERIALIZATION_DEPTH}.`,
      );
    }

    if (current === null) return "null";

    switch (typeof current) {
      case "undefined":
        return '{"$type":"undefined"}';
      case "string":
      case "boolean":
        return JSON.stringify(current);
      case "number":
        if (Number.isNaN(current)) return '{"$type":"number","value":"NaN"}';
        if (current === Infinity) return '{"$type":"number","value":"Infinity"}';
        if (current === -Infinity)
          return '{"$type":"number","value":"-Infinity"}';
        if (Object.is(current, -0)) return '{"$type":"number","value":"-0"}';
        return JSON.stringify(current);
      case "bigint":
        return `{"$type":"bigint","value":${JSON.stringify(current.toString())}}`;
      case "function":
      case "symbol":
        throw new TypeError(`Unsupported ${typeof current} value at ${path}.`);
      case "object":
        break;
      default:
        throw new TypeError(`Unsupported value at ${path}.`);
    }

    const obj = current as object;
    const existingId = seen.get(obj);
    if (existingId !== undefined) return `{"$ref":${existingId}}`;

    const id = nextId++;
    seen.set(obj, id);

    const prototype = Object.getPrototypeOf(obj);
    let constructorName = "Object";

    if (prototype !== null && prototype !== Object.prototype) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "constructor");
      if (
        !descriptor ||
        !("value" in descriptor) ||
        typeof descriptor.value !== "function"
      ) {
        throw new TypeError(`Unsupported object prototype at ${path}.`);
      }
      constructorName = descriptor.value.name;
    }

    if (!constructorName) {
      throw new TypeError(`Unsupported object value at ${path}.`);
    }

    const ownKeys = Reflect.ownKeys(obj);
    const stringKeys = ownKeys.filter((key) => typeof key === "string");

    function validateDataProperties(
      target: object,
      keys: string[],
      currentPath: string,
    ) {
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(target, key);
        if (!descriptor || !("value" in descriptor)) {
          throw new TypeError(
            `Unsupported accessor property at ${currentPath}.${key}.`,
          );
        }
      }
    }

    const urlValue = trySerializeURL(obj);
    if (urlValue !== null) {
      validateDataProperties(obj, stringKeys, path);
      return `{"$id":${id},"$type":"URL","value":${JSON.stringify(urlValue)},"properties":${encodeProperties(obj, stringKeys, path, depth)}}`;
    }

    const paramsValue = trySerializeURLSearchParams(obj);
    if (paramsValue !== null) {
      validateDataProperties(obj, stringKeys, path);
      return `{"$id":${id},"$type":"URLSearchParams","value":${JSON.stringify(paramsValue)},"properties":${encodeProperties(obj, stringKeys, path, depth)}}`;
    }

    validateDataProperties(obj, stringKeys, path);

    if (current instanceof Date) {
      if (Number.isNaN(current.getTime())) {
        throw new TypeError(`Invalid Date value at ${path}.`);
      }
      return `{"$id":${id},"$type":"Date","value":${JSON.stringify(current.toISOString())},"properties":${encodeProperties(obj, stringKeys, path, depth)}}`;
    }

    if (current instanceof RegExp) {
      const extraKeys = stringKeys.filter((key) => key !== "lastIndex");
      return `{"$id":${id},"$type":"RegExp","source":${JSON.stringify(current.source)},"flags":${JSON.stringify(current.flags)},"lastIndex":${current.lastIndex},"properties":${encodeProperties(obj, extraKeys, path, depth)}}`;
    }

    if (current instanceof Map || current instanceof Set) {
      throw new TypeError(`Unsupported ${constructorName} value at ${path}.`);
    }

    if (current instanceof DataView) {
      throw new TypeError(`Unsupported DataView value at ${path}.`);
    }

    if (isTypedArray(obj)) {
      const values = Array.from(obj, (item, index) =>
        encode(item, `${path}[${index}]`, depth + 1),
      );
      const indexes = new Set(
        Array.from({ length: obj.length }, (_, index) => String(index)),
      );
      const extraKeys = stringKeys.filter((key) => !indexes.has(key));
      return `{"$id":${id},"$type":${JSON.stringify(constructorName)},"values":[${values.join(",")}],"properties":${encodeProperties(obj, extraKeys, path, depth)}}`;
    }

    if (current instanceof ArrayBuffer) {
      return `{"$id":${id},"$type":"ArrayBuffer","values":${JSON.stringify(Array.from(new Uint8Array(current)))},"properties":${encodeProperties(obj, stringKeys, path, depth)}}`;
    }

    if (Array.isArray(current)) {
      const values = Array.from({ length: current.length }, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
        return descriptor
          ? encode(descriptor.value, `${path}[${index}]`, depth + 1)
          : '{"$type":"array-hole"}';
      });
      const indexes = new Set(
        Array.from({ length: current.length }, (_, index) => String(index)),
      );
      const extraKeys = stringKeys.filter(
        (key) => key !== "length" && !indexes.has(key),
      );
      return `{"$id":${id},"$type":"Array","values":[${values.join(",")}],"properties":${encodeProperties(obj, extraKeys, path, depth)}}`;
    }

    const tagDescriptor = findToStringTagDescriptor(prototype);
    if (tagDescriptor) {
      if (!("value" in tagDescriptor)) {
        throw new TypeError(
          `Unsupported Symbol.toStringTag accessor at ${path}.`,
        );
      }
      throw new TypeError(
        `Unsupported built-in ${String(tagDescriptor.value)} at ${path}.`,
      );
    }

    if (ownKeys.some((key) => typeof key === "symbol")) {
      throw new TypeError(`Unsupported symbol-keyed property at ${path}.`);
    }

    const ctor = prototype
      ? Object.getOwnPropertyDescriptor(prototype, "constructor")?.value
      : Object;
    if (typeof ctor === "function") {
      const ctorStr = Function.prototype.toString.call(ctor);
      if (ctorStr.includes("[native code]") && !KNOWN_NATIVES.has(constructorName)) {
        throw new TypeError(
          `Unsupported native built-in ${constructorName} at ${path}.`,
        );
      }
    }

    const entries = [...stringKeys].sort().map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(obj, key)!;
      return `${JSON.stringify(key)}:{"enumerable":${descriptor.enumerable},"value":${encode(descriptor.value, `${path}.${key}`, depth + 1)}}`;
    });
    return `{"$id":${id},"$type":${JSON.stringify(constructorName)},"values":{${entries.join(",")}}}`;
  }

  function encodeProperties(
    object: object,
    keys: string[],
    path: string,
    depth: number,
  ) {
    const entries = [...keys].sort().map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(object, key)!;
      return `${JSON.stringify(key)}:{"enumerable":${descriptor.enumerable},"value":${encode(descriptor.value, `${path}.${key}`, depth + 1)}}`;
    });
    return `{${entries.join(",")}}`;
  }

  return encode(value, "$", 0);
}

/** 同步 FNV-1a 变体，用于超长签名截断（浏览器无 sync SHA-256） */
export function hashSignature(str: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 = (h2 + c) | 0;
  }
  return `${(h1 >>> 0).toString(16).padStart(8, "0")}${(h2 >>> 0).toString(16).padStart(8, "0")}`;
}
