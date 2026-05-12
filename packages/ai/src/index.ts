import { registerCuaProviders } from "./providers.js";

export * from "@earendil-works/pi-ai";

export {
	getCuaModel,
	isCuaProvider,
	listCuaModels,
	providerForModel,
} from "./models.js";
export type { CuaModelInfo, CuaModelRef, CuaProvider } from "./models.js";

export {
	CUA_ACTION_TYPES,
	CUA_BATCH_TOOL_NAME,
	CUA_NAVIGATION_TOOL_NAME,
	createComputerToolDefinitions,
} from "./providers/common.js";
export type {
	ComputerToolCoordinateSystem,
	CreateComputerToolDefinitionsOptions,
	CuaAction,
	CuaActionBack,
	CuaActionClick,
	CuaActionCursorPosition,
	CuaActionDoubleClick,
	CuaActionDrag,
	CuaActionForward,
	CuaActionGoto,
	CuaActionKeypress,
	CuaActionMouseDown,
	CuaActionMouseUp,
	CuaActionMove,
	CuaActionScreenshot,
	CuaActionScroll,
	CuaActionType,
	CuaActionTypeText,
	CuaActionUrl,
	CuaActionWait,
	CuaBatchInput,
	CuaNavigationInput,
} from "./providers/common.js";

export * as anthropic from "./providers/anthropic/index.js";
export * as gemini from "./providers/gemini/index.js";
export * as openai from "./providers/openai/index.js";
export * as tzafon from "./providers/tzafon/index.js";
export * as yutori from "./providers/yutori/index.js";

registerCuaProviders();
