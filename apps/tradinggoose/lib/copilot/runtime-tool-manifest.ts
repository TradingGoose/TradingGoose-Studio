import {
	ToolArgSchemas,
	ToolIds,
	type ToolId,
} from "@/lib/copilot/registry";
import {
	GLOBAL_TOOL_MANIFEST_INSTRUCTIONS,
	TOOL_PROMPT_METADATA,
} from "@/lib/copilot/tool-prompt-metadata";
import {
	buildAutomaticSemanticValidators,
	type RuntimeToolManifestSemanticValidator,
} from "@/lib/copilot/runtime-tool-manifest-enrichment";
import { zodToJsonSchema } from "zod-to-json-schema";

export const COPILOT_RUNTIME_TOOL_MANIFEST_VERSION = "v1" as const;

export interface CopilotRuntimeToolManifestTool {
	name: string;
	description: string;
	rules?: string;
	instructions?: string[];
	parameters?: Record<string, unknown>;
	semanticValidators?: RuntimeToolManifestSemanticValidator[];
	kind?: string;
	entityKind?: string;
	mutatesState?: boolean;
	requiresCurrentState?: boolean;
	discoveryToolNames?: string[];
	verificationToolNames?: string[];
	injectWorkflowId?: boolean;
	requiredToolResults?: string[];
}

export interface CopilotRuntimeToolManifest {
	version: typeof COPILOT_RUNTIME_TOOL_MANIFEST_VERSION;
	instructions?: string[];
	tools: CopilotRuntimeToolManifestTool[];
}

const buildToolParameterSchema = (toolId: ToolId): Record<string, unknown> => {
	const schema = zodToJsonSchema(ToolArgSchemas[toolId], {
		$refStrategy: "none",
		target: "jsonSchema7",
	});

	if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
		return {
			type: "object",
			properties: {},
			additionalProperties: true,
		};
	}

	const { $schema, definitions, ...parameters } = schema as Record<
		string,
		unknown
	>;
	return parameters;
};

const TOOL_NAMES = ToolIds.options;

function getSemanticValidators(
	parameters: Record<string, unknown>,
): RuntimeToolManifestSemanticValidator[] | undefined {
	const semanticValidators = buildAutomaticSemanticValidators(parameters);

	if (semanticValidators.length === 0) {
		return undefined;
	}

	return semanticValidators;
}

export function getCopilotRuntimeToolManifest(): CopilotRuntimeToolManifest {
	return {
		version: COPILOT_RUNTIME_TOOL_MANIFEST_VERSION,
		instructions: GLOBAL_TOOL_MANIFEST_INSTRUCTIONS,
		tools: TOOL_NAMES.map((toolName) => {
			const parameters = buildToolParameterSchema(toolName);
			const semanticValidators = getSemanticValidators(parameters);

			return {
				name: toolName,
				...TOOL_PROMPT_METADATA[toolName],
				...(semanticValidators ? { semanticValidators } : {}),
				parameters,
			};
		}),
	};
}
