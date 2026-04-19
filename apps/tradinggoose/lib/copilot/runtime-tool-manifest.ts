import {
	ToolArgSchemas,
	ToolIds,
	type ToolId,
} from "@/lib/copilot/registry";
import { TOOL_PROMPT_METADATA } from "@/lib/copilot/tool-prompt-metadata";
import {
	buildAutomaticSemanticValidators,
	type RuntimeToolManifestSemanticValidator,
} from "@/lib/copilot/runtime-tool-manifest-enrichment";
import type { EmbeddedDocumentValidator } from "@/lib/copilot/workflow-subblock-semantic-contracts";
import { zodToJsonSchema } from "zod-to-json-schema";

export const COPILOT_RUNTIME_TOOL_MANIFEST_VERSION = "v1" as const;

export interface CopilotRuntimeToolManifestTool {
	name: string;
	description: string;
	parameters?: Record<string, unknown>;
	semanticValidators?: RuntimeToolManifestSemanticValidator[];
	kind?: string;
	entityKind?: string;
	surfaceKind?: string;
}

export interface CopilotRuntimeToolManifest {
	version: typeof COPILOT_RUNTIME_TOOL_MANIFEST_VERSION;
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
	options?: {
		workflowEmbeddedValidators?: EmbeddedDocumentValidator[];
	},
): RuntimeToolManifestSemanticValidator[] | undefined {
	const semanticValidators = buildAutomaticSemanticValidators(parameters, options);

	if (semanticValidators.length === 0) {
		return undefined;
	}

	return semanticValidators;
}

export async function getCopilotRuntimeToolManifest(): Promise<CopilotRuntimeToolManifest> {
	const { buildWorkflowEmbeddedDocumentValidators } = await import(
		"@/lib/copilot/workflow-subblock-semantic-contracts"
	);
	const workflowEmbeddedValidators = await buildWorkflowEmbeddedDocumentValidators();

	return {
		version: COPILOT_RUNTIME_TOOL_MANIFEST_VERSION,
		tools: TOOL_NAMES.map((toolName) => {
			const parameters = buildToolParameterSchema(toolName);
			const semanticValidators = getSemanticValidators(parameters, {
				workflowEmbeddedValidators,
			});

			return {
				name: toolName,
				...TOOL_PROMPT_METADATA[toolName],
				...(semanticValidators ? { semanticValidators } : {}),
				parameters,
			};
		}),
	};
}
