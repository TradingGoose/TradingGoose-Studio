# Files

Copilot sends selected images as inline Mastra message parts. Their bytes and tool results are retained in native conversation history; there is no separate Copilot upload store or source-token protocol.

Workspace file reads and deletions use the canonical `workspace_file` row and current workspace permissions. General uploads, document parsing, and storage providers use Studio's storage service.
