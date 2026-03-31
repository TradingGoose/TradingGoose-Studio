export async function GET() {
  const llmsContent = `# TradingGoose - AI Agent Workflow Builder
TradingGoose is an open-source AI agent workflow builder. Developers at trail-blazing startups to Fortune 500 companies deploy agentic workflows on the TradingGoose platform.  
30,000+ developers are already using TradingGoose to build and deploy AI agent workflows.  
TradingGoose lets developers integrate with 100+ apps to streamline workflows with AI agents. TradingGoose is SOC2 and HIPAA compliant, ensuring enterprise-level security.

## Key Features
- Visual Workflow Builder: Drag-and-drop interface for creating AI agent workflows
- [Documentation](https://docs.tradinggoose.ai): Complete guide to building AI agents

## Use Cases
- AI Agent Workflow Automation
- RAG Agents
- RAG Systesm and Pipline
- Chatbot Workflows
- Document Processing Workflows
- Customer Service Chatbot Workflows
- Ecommerce Agent Workflows
- Marketing Agent Workflows
- Deep Research Workflows
- Marketing Agent Workflows
- Real Estate Agent Workflows
- Financial Planning Agent Workflows
- Legal Agent Workflows

## Getting Started
- [Quick Start Guide](https://docs.tradinggoose.ai/quickstart)
- [GitHub](https://github.com/TradingGoose/TradingGoose-Studio)

## Resources
- [GitHub](https://github.com/TradingGoose/TradingGoose-Studio)
`

  return new Response(llmsContent, {
    headers: {
      'Content-Type': 'text/plain',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
