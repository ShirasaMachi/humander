// The DSH host supplies its validated tool and message constructors. The
// standalone WorkBuddy runner uses the same Runtime through a local adapter.
let dshTools, dshLlm;
try {
  dshTools = await import('@deepseek-ai/dsh-tools');
  dshLlm = await import('@deepseek-ai/dsh-llm');
} catch {
  // Neither package is required by the standalone WorkBuddy distribution.
}

export const defineTool = dshTools?.defineTool ?? (definition => definition);
export const createUserMessage = dshLlm?.createUserMessage ?? (input => ({ ...input, role: 'user' }));
