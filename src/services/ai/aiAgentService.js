import OpenAI from "openai";
import AIPermissionRepository from "../../repositories/aiPermissionRepository.js";
import { getToolsForPermissions } from "./toolRegistry.js";
import { buildSystemPrompt } from "./systemPrompt.js";

const permRepo = new AIPermissionRepository();
const MAX_ITERATIONS = 8;

// ctx = { negocioId, warehouseId, userName }
export default class AIAgentService {
  async chat(messages, ctx) {
    const { negocioId } = ctx;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const permissions    = await permRepo.getByNegocio(negocioId);
    const availableTools = getToolsForPermissions(permissions);

    const toolDefinitions = availableTools.map((t) => ({
      type: "function",
      function: t.definition,
    }));

    const toolMap = {};
    for (const t of availableTools) {
      toolMap[t.name] = t;
    }

    const systemMessage = { role: "system", content: buildSystemPrompt(availableTools) };
    const convMessages  = [systemMessage, ...messages];

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await openai.chat.completions.create({
        model:       "gpt-4o",
        messages:    convMessages,
        tools:       toolDefinitions.length > 0 ? toolDefinitions : undefined,
        tool_choice: toolDefinitions.length > 0 ? "auto"          : undefined,
        temperature: 0.3,
      });

      const choice = response.choices[0];

      if (choice.finish_reason === "stop" || !choice.message.tool_calls?.length) {
        return { role: "assistant", content: choice.message.content };
      }

      convMessages.push(choice.message);

      for (const toolCall of choice.message.tool_calls) {
        const toolName = toolCall.function.name;
        const tool     = toolMap[toolName];
        let result;

        if (!tool) {
          result = { error: `Herramienta "${toolName}" no disponible` };
        } else {
          try {
            const args = JSON.parse(toolCall.function.arguments);
            result = await tool.execute(args, ctx);
          } catch (err) {
            console.error(`[AIAgent] Error en herramienta ${toolName}:`, err.message);
            result = { error: `Error al ejecutar ${toolName}: ${err.message}` };
          }
        }

        convMessages.push({
          role:         "tool",
          tool_call_id: toolCall.id,
          content:      JSON.stringify(result),
        });
      }
    }

    return {
      role:    "assistant",
      content: "No pude completar la consulta. Por favor intentá de nuevo con más detalle.",
    };
  }
}
