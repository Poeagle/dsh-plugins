import { z } from "zod";
//#region src/typert.host.ts
const PKG = "dsh-cost-meter";
const zUnknown = z.unknown();
const zString = z.string();
const jsonResult = (method) => ({
	mode: "strict",
	typeSymbol: `${PKG}#${method}#result`,
	schema: zUnknown
});
const strParam = (method, name) => ({
	name,
	wire: name,
	source: "json",
	codec: {
		mode: "strict",
		typeSymbol: `${PKG}#${method}#${name}`,
		schema: zString
	}
});
const inv = (method, parameters) => ({
	id: `${PKG}#costMeter/${method}`,
	service: "costMeter",
	namespace: "costMeter",
	method,
	invocation: { kind: "direct" },
	parameters,
	result: jsonResult(method)
});
const TYPERT = {
	package: PKG,
	face: "host",
	schemas: [],
	invocations: [
		inv("sessionCost", [strParam("sessionCost", "sessionId")]),
		inv("sessionCosts", []),
		inv("providerBalances", [])
	],
	model: {
		services: [],
		events: [],
		objects: []
	}
};
//#endregion
export { TYPERT };
