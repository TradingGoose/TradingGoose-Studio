import { CodeIcon } from '@/components/icons/icons'
import type { BlockConfig } from '@/blocks/types'
import type { CodeExecutionOutput } from '@/tools/function/types'

export const FunctionBlock: BlockConfig<CodeExecutionOutput> = {
  type: 'function',
  name: 'Function',
  description: 'Run custom logic',
  longDescription:
    'This is a core workflow block. Execute custom TypeScript code within your workflow. Code transpiles to JavaScript at runtime and executes on E2B when enabled, otherwise local VM.',
  bestPractices: `
  - Write TypeScript statements only (no function wrapper).
  - If you need external imports, enable E2B at the environment level.
  - Can reference workflow variables using <blockName.output> syntax as usual within code. Avoid XML/HTML tags.
  `,
  docsLink: 'https://docs.sim.ai/blocks/function',
  category: 'blocks',
  bgColor: '#FF402F',
  icon: CodeIcon,
  subBlocks: [
    {
      id: 'code',
      type: 'code',
      layout: 'full',
      language: 'typescript',
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert TypeScript programmer.
Generate ONLY the raw body of a TypeScript function based on the user's request. Never wrap in markdown formatting.
The code should be executable within an 'async function(params, environmentVariables) {...}' context and transpiled at runtime.
- 'params' (object): Contains input parameters derived from the JSON schema. Access these directly using the parameter name wrapped in angle brackets, e.g., '<paramName>'. Do NOT use 'params.paramName'.
- 'environmentVariables' (object): Contains environment variables. Reference these using the double curly brace syntax: '{{ENV_VAR_NAME}}'. Do NOT use 'environmentVariables.VAR_NAME' or env.

Current code context: {context}

IMPORTANT FORMATTING RULES:
1. Reference Environment Variables: Use the exact syntax {{VARIABLE_NAME}}. Do NOT wrap it in quotes (e.g., use 'apiKey = {{SERVICE_API_KEY}}' not 'apiKey = "{{SERVICE_API_KEY}}"'). Our system replaces these placeholders before execution.
2. Reference Input Parameters/Workflow Variables: Use the exact syntax <variable_name>. Do NOT wrap it in quotes (e.g., use 'userId = <userId>;' not 'userId = "<userId>";'). This includes parameters defined in the block's schema and outputs from previous blocks.
3. Function Body ONLY: Do NOT include the function signature (e.g., 'async function myFunction() {' or the surrounding '}').
4. TypeScript: Use valid TypeScript syntax and types when useful.
5. Imports: Avoid imports unless E2B is enabled in the deployment environment.
6. Output: Ensure the code returns a value if the function is expected to produce output. Use 'return'.
7. Clarity: Write clean, readable code.
8. No Explanations: Do NOT include markdown formatting, comments explaining the rules, or any text other than the raw TypeScript code for the function body.

Example Scenario:
User Prompt: "Fetch user data from an API. Use the User ID passed in as 'userId' and an API Key stored as the 'SERVICE_API_KEY' environment variable."

Generated Code:
const userId: string = <block.content>;
const apiKey: string = {{SERVICE_API_KEY}};
const url = \`https://api.example.com/users/\${userId}\`;

try {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: \`Bearer \${apiKey}\`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(\`API request failed with status \${response.status}: \${await response.text()}\`);
  }

  const data = await response.json();
  console.log('User data fetched successfully.');
  return data;
} catch (error) {
  console.error(\`Error fetching user data: \${error.message}\`);
  throw error;
}`,
        placeholder: 'Describe the function you want to create...',
        generationType: 'typescript-function-body',
      },
    },
  ],
  tools: {
    access: ['function_execute'],
  },
  inputs: {
    code: { type: 'string', description: 'TypeScript code to execute' },
    timeout: { type: 'number', description: 'Execution timeout' },
  },
  outputs: {
    result: { type: 'json', description: 'Return value from the executed TypeScript function' },
    stdout: {
      type: 'string',
      description: 'Console log output and debug messages from function execution',
    },
  },
}
